"""DocumentService: upload, processing claim, review edits, publication."""
import logging
import threading
from datetime import timedelta
from pathlib import Path

from django.conf import settings
from django.db import transaction
from django.utils import timezone

from academics.models import SubjectStatus, faculty_manages_subject
from audit import services as audit
from core.exceptions import Conflict, Forbidden, ValidationFailed
from learning.models import Chapter, Module, ModuleAvailability

from ..models import Document, DocumentStatus, EDITABLE_STATUSES, REPROCESSABLE_STATUSES
from . import outline as outline_service
from .parser import NoExtractableContent, load_processed_sections, parse_document, release_document_models

logger = logging.getLogger("localmind.documents")

# One document is parsed at a time per process: Docling's layout model plus
# OCR already take most of a laptop's spare RAM, and the embedded LLM needs
# the rest for the outline call that follows.
_processing_lock = threading.Lock()

MAGIC = {".pdf": (b"%PDF",), ".docx": (b"PK\x03\x04",), ".doc": (b"\xd0\xcf\x11\xe0",)}


def _require_manage(actor, subject):
    if not faculty_manages_subject(actor, subject):
        raise Forbidden("You do not manage this subject.", code="SUBJECT_NOT_ASSIGNED")


def validate_upload(uploaded_file):
    cfg = settings.LOCALMIND
    ext = Path(uploaded_file.name or "").suffix.lower()
    if ext not in cfg["ALLOWED_UPLOAD_EXTENSIONS"]:
        raise ValidationFailed("Supported files are PDF (.pdf), Word (.docx) and legacy Word (.doc).", code="UNSUPPORTED_FILE_TYPE")
    if uploaded_file.size == 0:
        raise ValidationFailed("The uploaded file is empty.", code="EMPTY_FILE")
    if uploaded_file.size > cfg["MAX_UPLOAD_MB"] * 1024 * 1024:
        raise ValidationFailed(f"File is larger than {cfg['MAX_UPLOAD_MB']} MB.", code="FILE_TOO_LARGE")
    head = uploaded_file.read(8)
    uploaded_file.seek(0)
    if not any(head.startswith(m) for m in MAGIC[ext]):
        raise ValidationFailed("File content does not match its extension.", code="FILE_CONTENT_MISMATCH")
    return ext


@transaction.atomic
def upload_document(actor, subject, uploaded_file, title="", request=None):
    _require_manage(actor, subject)
    if subject.status != SubjectStatus.ACTIVE:
        raise Conflict("Books can only be uploaded to active subjects.", code="SUBJECT_INACTIVE")
    ext = validate_upload(uploaded_file)
    document = Document(
        subject=subject, uploaded_by=actor,
        original_name=Path(uploaded_file.name).name[:300],
        title=(title or Path(uploaded_file.name).stem)[:300],
        file_type=ext.lstrip("."), file_size=uploaded_file.size,
    )
    document.file = uploaded_file  # upload_to uses document.id, which exists already
    document.save()
    audit.record(actor, "document.uploaded", document, {"subject": subject.code, "file": document.original_name}, request)
    return document


# ---------- processing ----------

def _processing_is_stale(document):
    """A document still 'processing' long after it started belongs to a worker
    that was recycled mid-run; nothing will ever finish it, so it may be reclaimed."""
    minutes = settings.LOCALMIND.get("PROCESSING_STALE_MINUTES", 30)
    started = document.processing_started_at or document.updated_at
    return started < timezone.now() - timedelta(minutes=minutes)


def claim_for_processing(document):
    """Atomically move to PROCESSING; returns False if someone else already did
    and is still within the stale window."""
    with transaction.atomic():
        locked = Document.objects.select_for_update().get(pk=document.pk)
        if locked.status == DocumentStatus.PROCESSING:
            if not _processing_is_stale(locked):
                return False
            logger.warning("Reclaiming document %s: processing started at %s and never finished", locked.pk, locked.processing_started_at)
        elif locked.status not in REPROCESSABLE_STATUSES:
            raise Conflict(f"A document in state '{locked.status}' cannot be processed.", code="INVALID_STATE")
        locked.status = DocumentStatus.PROCESSING
        locked.error_message = ""
        locked.processing_started_at = timezone.now()
        locked.save(update_fields=["status", "error_message", "processing_started_at", "updated_at"])
    return True


def run_processing(document_id):
    """The unit of work a background worker executes. Safe to call from a
    thread, a process, or (later) a Celery task.

    Order matters for memory: parse (Docling/OCR models resident), release
    those models, then ask the embedded LLM for an outline. The LLM instance
    itself is shared per process and is never unloaded here.
    """
    document = Document.objects.get(pk=document_id)
    try:
        with _processing_lock:
            try:
                parsed = parse_document(document)
            finally:
                release_document_models()
        outline, source = outline_service.build_proposed_outline(document, parsed["sections"], parsed["headings"])
        with transaction.atomic():
            outline_service.persist_outline(document, outline, parsed["sections"], user_edited=False)
            document.processed_markdown_path = parsed["markdown_path"]
            document.extracted_headings = parsed["headings"]
            document.outline_source = source
            document.parse_mode = parsed["parse_mode"]
            document.status = DocumentStatus.UNDER_REVIEW
            document.processed_at = timezone.now()
            document.error_message = ""
            document.save()
        audit.record(None, "document.processed", document, {"outline_source": source, "chapters": len(outline["chapters"])})
        logger.info("Processed document %s (%s)", document_id, source)
    except NoExtractableContent as exc:
        # Expected outcome for blank or unreadable files: a clear message, no traceback.
        logger.warning("Processing of document %s produced no content: %s", document_id, exc)
        Document.objects.filter(pk=document_id).update(
            status=DocumentStatus.ERROR, error_message=str(exc)[:2000], updated_at=timezone.now(),
        )
        audit.record(None, "document.processing_failed", document, {"error": str(exc)[:300], "code": exc.code})
    except Exception as exc:
        logger.exception("Processing failed for document %s", document_id)
        Document.objects.filter(pk=document_id).update(
            status=DocumentStatus.ERROR, error_message=(str(exc) or "Document processing failed.")[:2000],
            updated_at=timezone.now(),
        )
        audit.record(None, "document.processing_failed", document, {"error": str(exc)[:300]})


def _launch(document_id):
    def target():
        from django.db import connection
        try:
            run_processing(document_id)
        finally:
            connection.close()
    threading.Thread(target=target, name=f"process-{document_id}", daemon=True).start()


def start_processing(actor, document, request=None):
    _require_manage(actor, document.subject)
    if not claim_for_processing(document):
        raise Conflict("This document is already being processed.", code="ALREADY_PROCESSING")
    audit.record(actor, "document.processing_started", document, {}, request)
    if settings.TESTING or getattr(settings, "PROCESS_DOCUMENTS_INLINE", False):
        run_processing(document.id)
    else:
        _launch(document.id)
    document.refresh_from_db()
    return document


# ---------- review & editing ----------

def _bump_version(document, actor):
    document.content_version += 1
    document.last_edited_by = actor
    document.last_edited_at = timezone.now()
    document.save(update_fields=["content_version", "last_edited_by", "last_edited_at", "updated_at"])


@transaction.atomic
def replace_outline(actor, document, outline, request=None):
    _require_manage(actor, document.subject)
    if document.status not in EDITABLE_STATUSES:
        raise Conflict(f"The outline cannot be edited while the document is '{document.status}'.", code="INVALID_STATE")
    if document.status == DocumentStatus.PUBLISHED:
        raise Conflict("Unpublish the document before restructuring its outline.", code="PUBLISHED_STRUCTURE_LOCKED")
    sections = load_processed_sections(document)
    outline_service.persist_outline(document, outline, sections, user_edited=True)
    document.outline_source = "edited"
    if document.status == DocumentStatus.READY:
        document.status = DocumentStatus.UNDER_REVIEW
    document.save(update_fields=["outline_source", "status", "updated_at"])
    _bump_version(document, actor)
    audit.record(actor, "document.outline_edited", document, {"version": document.content_version}, request)
    return document


@transaction.atomic
def edit_chapter(actor, chapter, title=None, source_text=None, request=None):
    document = chapter.document
    _require_manage(actor, document.subject)
    if document.status not in EDITABLE_STATUSES:
        raise Conflict("Content cannot be edited in this state.", code="INVALID_STATE")
    changes = {}
    if title is not None and outline_service.clean_title(title):
        changes["title"] = [chapter.title, outline_service.clean_title(title)]
        chapter.title = outline_service.clean_title(title)
    if source_text is not None:
        changes["source_text"] = True
        chapter.source_text = source_text
    if changes:
        chapter.is_user_edited = True
        chapter.save()
        _bump_version(document, actor)
        audit.record(actor, "chapter.edited", chapter, changes, request)
    return chapter


@transaction.atomic
def edit_module(actor, module, title=None, source_text=None, request=None):
    document = module.chapter.document
    _require_manage(actor, document.subject)
    if document.status not in EDITABLE_STATUSES:
        raise Conflict("Content cannot be edited in this state.", code="INVALID_STATE")
    changes = {}
    if title is not None and outline_service.clean_title(title):
        changes["title"] = [module.title, outline_service.clean_title(title)]
        module.title = outline_service.clean_title(title)
    if source_text is not None:
        changes["source_text"] = True
        module.source_text = source_text
        module.source_missing = not source_text.strip()
    if changes:
        module.is_user_edited = True
        module.save()
        _bump_version(document, actor)
        audit.record(actor, "module.edited", module, changes, request)
    return module


@transaction.atomic
def mark_ready(actor, document, request=None):
    _require_manage(actor, document.subject)
    if document.status != DocumentStatus.UNDER_REVIEW:
        raise Conflict("Only documents under review can be marked ready.", code="INVALID_STATE")
    _validate_publishable(document)
    document.status = DocumentStatus.READY
    document.reviewed_by = actor
    document.reviewed_at = timezone.now()
    document.save(update_fields=["status", "reviewed_by", "reviewed_at", "updated_at"])
    audit.record(actor, "document.reviewed", document, {}, request)
    return document


def _validate_publishable(document):
    if not document.chapters.exists():
        raise Conflict("Cannot publish a document with no chapters.", code="EMPTY_OUTLINE")
    if not Module.objects.filter(chapter__document=document).exists():
        raise Conflict("Cannot publish a document with no modules.", code="NO_MODULES")
    missing = outline_service.missing_source_modules(document)
    if missing:
        raise Conflict("Every module must have source text before publishing.", code="MODULES_MISSING_SOURCE",
                       details={"modules": [{"id": str(m["id"]), "title": m["title"], "chapter": m["chapter__title"]} for m in missing]})


@transaction.atomic
def publish(actor, document, request=None):
    _require_manage(actor, document.subject)
    if actor.role == "faculty" and not settings.LOCALMIND["FACULTY_CAN_PUBLISH"]:
        raise Forbidden("Publishing is restricted to administrators.", code="PUBLISH_ADMIN_ONLY")
    if document.status not in (DocumentStatus.UNDER_REVIEW, DocumentStatus.READY, DocumentStatus.UNPUBLISHED):
        raise Conflict(f"A document in state '{document.status}' cannot be published.", code="INVALID_STATE")
    _validate_publishable(document)
    now = timezone.now()
    if document.reviewed_at is None:
        document.reviewed_by, document.reviewed_at = actor, now
    document.status = DocumentStatus.PUBLISHED
    document.published_by, document.published_at, document.unpublished_at = actor, now, None
    document.save()
    audit.record(actor, "document.published", document, {"version": document.content_version}, request)
    # Publishing is what makes a book visible to students, so open every module
    # that has source text. Faculty can still lock modules or chapters afterwards
    # to pace the course; a re-publish of a book that already has open modules
    # leaves their locks alone.
    if not Module.objects.filter(chapter__document=document, availability=ModuleAvailability.OPEN).exists():
        from learning import services as learning
        learning.open_modules_for_publish(actor, list(Module.objects.filter(chapter__document=document)), "document.published", target=document, request=request)
    return document


@transaction.atomic
def unpublish(actor, document, request=None):
    _require_manage(actor, document.subject)
    if document.status != DocumentStatus.PUBLISHED:
        raise Conflict("Only published documents can be unpublished.", code="INVALID_STATE")
    document.status = DocumentStatus.UNPUBLISHED
    document.unpublished_at = timezone.now()
    document.save(update_fields=["status", "unpublished_at", "updated_at"])
    audit.record(actor, "document.unpublished", document, {}, request)
    return document


@transaction.atomic
def archive(actor, document, request=None):
    _require_manage(actor, document.subject)
    if document.status == DocumentStatus.ARCHIVED:
        raise Conflict("Already archived.", code="INVALID_STATE")
    if document.status == DocumentStatus.PROCESSING:
        raise Conflict("Wait for processing to finish before archiving.", code="INVALID_STATE")
    document.status = DocumentStatus.ARCHIVED
    document.archived_at = timezone.now()
    document.save(update_fields=["status", "archived_at", "updated_at"])
    audit.record(actor, "document.archived", document, {}, request)
    return document


# ---------- module availability ----------

@transaction.atomic
def set_module_availability(actor, module, availability, request=None):
    document = module.chapter.document
    _require_manage(actor, document.subject)
    if availability not in ModuleAvailability.values:
        raise ValidationFailed(details={"availability": "Must be 'open' or 'locked'."})
    if availability == ModuleAvailability.OPEN and module.source_missing:
        raise Conflict("A module without source text cannot be opened.", code="MODULE_SOURCE_MISSING")
    if module.availability == availability:
        return module
    module.availability = availability
    if availability == ModuleAvailability.OPEN:
        module.opened_by, module.opened_at = actor, timezone.now()
    module.save(update_fields=["availability", "opened_by", "opened_at", "updated_at"])
    audit.record(actor, f"module.{'opened' if availability == 'open' else 'locked'}", module, {"document": str(document.id)}, request)
    return module


@transaction.atomic
def set_chapter_availability(actor, chapter, availability, request=None):
    modules = list(chapter.modules.all())
    for module in modules:
        if availability == ModuleAvailability.OPEN and module.source_missing:
            continue
        set_module_availability(actor, module, availability, request)
    return modules
