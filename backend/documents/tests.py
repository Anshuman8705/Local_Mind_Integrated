import shutil
import tempfile
from io import BytesIO
from unittest.mock import patch

from django.core.files.uploadedfile import SimpleUploadedFile
from django.test import TestCase, override_settings

from audit.models import AuditLog
from core.testing import assign, client_for, enroll, make_admin, make_faculty, make_student, make_subject
from learning.models import Chapter, Module

from .models import Document, DocumentStatus
from .services.outline import ai_outline, persist_outline, source_hierarchy_outline
from .services.parser import extract_sections_from_markdown

MEDIA = tempfile.mkdtemp(prefix="lm-media-")

SAMPLE_MD = """# Operating Systems
Intro paragraph about operating systems.

## Process Management
Processes are programs in execution.

### Scheduling
Round robin and priority scheduling.

## Memory Management
Paging and segmentation.

# Networks
## Transport Layer
TCP and UDP.
"""

PDF_BYTES = b"%PDF-1.4\n%fake\n"


def fake_parse(document):
    import os
    sections = extract_sections_from_markdown(SAMPLE_MD)
    from .services.parser import _extract_headings
    path = ""
    if document is not None:
        folder = os.path.join(MEDIA, "processed", str(document.id))
        os.makedirs(folder, exist_ok=True)
        path = os.path.join(folder, "document.md")
        with open(path, "w", encoding="utf-8") as fh:
            fh.write(SAMPLE_MD)
    return {"markdown": SAMPLE_MD, "markdown_path": path, "headings": _extract_headings(sections),
            "sections": sections, "parse_mode": "test"}


def pdf_upload(name="book.pdf", content=PDF_BYTES):
    return SimpleUploadedFile(name, content, content_type="application/pdf")


@override_settings(MEDIA_ROOT=MEDIA)
class ParserAndOutlineTests(TestCase):
    @classmethod
    def tearDownClass(cls):
        shutil.rmtree(MEDIA, ignore_errors=True)
        super().tearDownClass()

    def test_sections_are_indexed_and_bounded_by_sibling_or_ancestor(self):
        sections = extract_sections_from_markdown(SAMPLE_MD)
        titles = [(s["index"], s["level"], s["title"]) for s in sections]
        self.assertEqual(titles[0], (0, 1, "Operating Systems"))
        self.assertIn("Scheduling", sections[1]["source_text"])   # H2 keeps its H3 content
        self.assertNotIn("Memory Management", sections[1]["source_text"])
        self.assertNotIn("Networks", sections[0]["source_text"])

    def test_inline_heading_marker_is_recovered(self):
        sections = extract_sections_from_markdown("# Alpha\nsome text. ## Beta\nmore")
        self.assertEqual([s["title"] for s in sections], ["Alpha", "Beta"])

    def test_source_hierarchy_outline(self):
        sections = extract_sections_from_markdown(SAMPLE_MD)
        outline = source_hierarchy_outline("book.pdf", sections)
        self.assertEqual([c["title"] for c in outline["chapters"]], ["Operating Systems", "Networks"])
        self.assertEqual([m["title"] for m in outline["chapters"][0]["modules"]], ["Process Management", "Memory Management"])
        self.assertEqual(outline["chapters"][0]["modules"][0]["source_heading_index"], 1)

    def _doc(self):
        subject = make_subject()
        return Document.objects.create(subject=subject, original_name="book.pdf", title="book", file_type="pdf")

    @patch("documents.services.outline.gateway")
    def test_ai_outline_with_invalid_index_is_discarded(self, gw):
        from ai.gateway import AIResult
        gw.return_value.generate.return_value = AIResult(ok=True, data={"document_title": "X", "chapters": [
            {"title": "Made up", "source_heading_index": 99, "modules": []}]})
        headings = fake_parse(None)["headings"]
        self.assertIsNone(ai_outline(self._doc(), headings))

    @patch("documents.services.outline.gateway")
    def test_ai_outline_keeps_source_index_mapping(self, gw):
        from ai.gateway import AIResult
        gw.return_value.generate.return_value = AIResult(ok=True, data={"document_title": "OS Course", "chapters": [
            {"title": "Fundamentals", "source_heading_index": 0,
             "modules": [{"title": "Processes", "source_heading_index": 1}, {"title": "Memory", "source_heading_index": 3}]}]})
        parsed = fake_parse(None)
        doc = self._doc()
        outline = ai_outline(doc, parsed["headings"])
        self.assertEqual(outline["chapters"][0]["modules"][1]["source_heading_index"], 3)
        persist_outline(doc, outline, parsed["sections"])
        module = Module.objects.get(chapter__document=doc, title="Memory")
        self.assertIn("Paging", module.source_text)
        self.assertFalse(module.source_missing)

    def test_persist_outline_marks_unmapped_module_as_missing_source(self):
        doc = self._doc()
        parsed = fake_parse(None)
        outline = {"document_title": "T", "chapters": [{"title": "C", "source_heading_index": 0,
                   "modules": [{"title": "Ghost", "source_heading_index": None}]}]}
        persist_outline(doc, outline, parsed["sections"])
        ghost = Module.objects.get(title="Ghost")
        self.assertTrue(ghost.source_missing)
        self.assertEqual(ghost.source_text, "")

    def test_persist_outline_reconciles_existing_ids(self):
        doc = self._doc()
        parsed = fake_parse(None)
        persist_outline(doc, source_hierarchy_outline("b.pdf", parsed["sections"]), parsed["sections"])
        chapter = doc.chapters.get(order=1)
        module = chapter.modules.get(order=1)
        new_outline = {"document_title": "Renamed", "chapters": [
            {"id": str(chapter.id), "title": "Renamed Chapter", "source_heading_index": 0,
             "modules": [{"id": str(module.id), "title": "Renamed Module", "source_heading_index": 1},
                         {"title": "Brand new", "source_heading_index": 3}]}]}
        persist_outline(doc, new_outline, parsed["sections"], user_edited=True)
        module.refresh_from_db()
        self.assertEqual(module.title, "Renamed Module")
        self.assertEqual(module.chapter_id, chapter.id)
        self.assertFalse(Chapter.objects.filter(document=doc, title="Networks").exists())
        self.assertEqual(Module.objects.filter(chapter__document=doc).count(), 2)


@override_settings(MEDIA_ROOT=MEDIA)
@patch("documents.services.documents.parse_document", side_effect=fake_parse)
class DocumentLifecycleTests(TestCase):
    def setUp(self):
        self.admin = make_admin()
        self.faculty = make_faculty()
        self.other_faculty = make_faculty()
        self.student = make_student()
        self.subject = make_subject(code="OS")
        self.other_subject = make_subject(code="DB")
        assign(self.faculty, self.subject)
        assign(self.other_faculty, self.other_subject)
        enroll(self.student, self.subject)

    def upload(self, client=None, subject=None, **kw):
        client = client or client_for(self.faculty)
        return client.post("/api/faculty/documents/", {"subject_id": str((subject or self.subject).id), "file": pdf_upload(**kw)}, format="multipart")

    def test_student_cannot_upload(self, _):
        res = client_for(self.student).post("/api/faculty/documents/", {"subject_id": str(self.subject.id), "file": pdf_upload()}, format="multipart")
        self.assertEqual(res.status_code, 403)
        res = client_for(self.student).post("/api/admin/documents/", {"subject_id": str(self.subject.id), "file": pdf_upload()}, format="multipart")
        self.assertEqual(res.status_code, 403)

    def test_faculty_cannot_upload_to_unassigned_subject(self, _):
        res = self.upload(subject=self.other_subject)
        self.assertEqual(res.status_code, 404)

    def test_upload_validates_type_and_content(self, _):
        self.assertEqual(self.upload(name="notes.txt", content=b"hello").status_code, 400)
        res = self.upload(name="fake.pdf", content=b"not a pdf at all")
        self.assertEqual(res.status_code, 400)
        self.assertEqual(res.data["error"]["code"], "FILE_CONTENT_MISMATCH")

    def test_upload_stores_under_document_id_not_client_name(self, _):
        res = self.upload(name="../../evil.pdf")
        self.assertEqual(res.status_code, 201, res.content)
        doc = Document.objects.get(pk=res.data["id"])
        self.assertTrue(doc.file.name.startswith(f"documents/{doc.id}/original"))
        self.assertEqual(doc.uploaded_by, self.faculty)
        self.assertEqual(doc.status, DocumentStatus.UPLOADED)

    def _processed_doc(self):
        client = client_for(self.faculty)
        doc_id = self.upload(client).data["id"]
        res = client.post(f"/api/faculty/documents/{doc_id}/process/")
        self.assertEqual(res.status_code, 200, res.content)
        return client, Document.objects.get(pk=doc_id)

    def test_processing_creates_mapped_structure_and_review_state(self, _):
        client, doc = self._processed_doc()
        self.assertEqual(doc.status, DocumentStatus.UNDER_REVIEW)
        self.assertEqual(doc.outline_source, "source_hierarchy")  # AI disabled in tests
        self.assertEqual(doc.chapters.count(), 2)
        module = Module.objects.get(chapter__document=doc, title="Process Management")
        self.assertEqual(module.source_heading_index, 1)
        self.assertIn("Processes are programs", module.source_text)
        self.assertEqual(module.availability, "locked")
        self.assertTrue(AuditLog.objects.filter(action="document.processed", target_id=str(doc.id)).exists())

    def test_double_processing_is_rejected(self, _):
        client = client_for(self.faculty)
        doc_id = self.upload(client).data["id"]
        Document.objects.filter(pk=doc_id).update(status=DocumentStatus.PROCESSING)
        res = client.post(f"/api/faculty/documents/{doc_id}/process/")
        self.assertEqual(res.status_code, 409)
        self.assertEqual(res.data["error"]["code"], "ALREADY_PROCESSING")

    def test_processing_failure_sets_error_state(self, parse):
        parse.side_effect = ValueError("Unreadable PDF")
        client = client_for(self.faculty)
        doc_id = self.upload(client).data["id"]
        res = client.post(f"/api/faculty/documents/{doc_id}/process/")
        self.assertEqual(res.status_code, 422)
        self.assertEqual(res.data["error"]["code"], "PROCESSING_FAILED")
        doc = Document.objects.get(pk=doc_id)
        self.assertEqual(doc.status, DocumentStatus.ERROR)
        self.assertIn("Unreadable", doc.error_message)

    def test_publish_blocked_until_every_module_has_source(self, _):
        client, doc = self._processed_doc()
        module = Module.objects.filter(chapter__document=doc).first()
        module.source_text, module.source_missing = "", True
        module.save()
        res = client.post(f"/api/faculty/documents/{doc.id}/publish/")
        self.assertEqual(res.status_code, 409)
        self.assertEqual(res.data["error"]["code"], "MODULES_MISSING_SOURCE")
        self.assertEqual(res.data["error"]["details"]["modules"][0]["id"], str(module.id))
        fixed = client.patch(f"/api/faculty/modules/{module.id}/", {"source_text": "Restored text."}, format="json")
        self.assertEqual(fixed.status_code, 200)
        self.assertFalse(fixed.data["source_missing"])
        res = client.post(f"/api/faculty/documents/{doc.id}/publish/")
        self.assertEqual(res.status_code, 200, res.content)
        self.assertEqual(res.data["status"], "published")
        self.assertEqual(res.data["content_version"], 2)

    def test_review_edit_bumps_version_and_audits(self, _):
        client, doc = self._processed_doc()
        chapter = doc.chapters.first()
        res = client.patch(f"/api/faculty/chapters/{chapter.id}/", {"title": "  Renamed  "}, format="json")
        self.assertEqual(res.data["title"], "Renamed")
        self.assertTrue(res.data["is_user_edited"])
        self.assertTrue(AuditLog.objects.filter(action="chapter.edited").exists())

    def test_outline_put_preserves_ids_and_blocks_when_published(self, _):
        client, doc = self._processed_doc()
        outline = client.get(f"/api/faculty/documents/{doc.id}/outline/").data
        keep = outline["chapters"][0]
        res = client.put(f"/api/faculty/documents/{doc.id}/outline/", {"document_title": "New", "chapters": [
            {"id": keep["id"], "title": "Only chapter", "source_heading_index": keep["source_heading_index"],
             "modules": [{"id": keep["modules"][0]["id"], "title": keep["modules"][0]["title"], "source_heading_index": keep["modules"][0]["source_heading_index"]}]}]}, format="json")
        self.assertEqual(res.status_code, 200, res.content)
        self.assertEqual(res.data["chapter_count"], 1)
        self.assertEqual(res.data["outline_source"], "edited")
        pub = client.post(f"/api/faculty/documents/{doc.id}/publish/")
        self.assertEqual(pub.status_code, 200, pub.content)
        res = client.put(f"/api/faculty/documents/{doc.id}/outline/", {"chapters": [{"title": "x", "modules": []}]}, format="json")
        self.assertEqual(res.status_code, 409)

    def test_other_faculty_cannot_see_or_touch_document(self, _):
        client, doc = self._processed_doc()
        other = client_for(self.other_faculty)
        self.assertEqual(other.get(f"/api/faculty/documents/{doc.id}/").status_code, 404)
        self.assertEqual(other.post(f"/api/faculty/documents/{doc.id}/publish/").status_code, 404)
        module = Module.objects.filter(chapter__document=doc).first()
        self.assertEqual(other.post(f"/api/faculty/modules/{module.id}/availability/", {"availability": "open"}, format="json").status_code, 404)
        self.assertEqual(len(other.get("/api/faculty/documents/").data["results"]), 0)

    def test_admin_sees_all_documents(self, _):
        client, doc = self._processed_doc()
        res = client_for(self.admin).get("/api/admin/documents/")
        self.assertEqual(len(res.data["results"]), 1)
        self.assertEqual(client_for(self.admin).post(f"/api/admin/documents/{doc.id}/publish/").status_code, 200)

    @override_settings(LOCALMIND={**__import__("django.conf").conf.settings.LOCALMIND, "FACULTY_CAN_PUBLISH": False})
    def test_publish_can_be_restricted_to_admin(self, _):
        client, doc = self._processed_doc()
        res = client.post(f"/api/faculty/documents/{doc.id}/publish/")
        self.assertEqual(res.status_code, 403)
        self.assertEqual(res.data["error"]["code"], "PUBLISH_ADMIN_ONLY")

    def test_unpublish_and_archive(self, _):
        client, doc = self._processed_doc()
        client.post(f"/api/faculty/documents/{doc.id}/publish/")
        self.assertEqual(client.post(f"/api/faculty/documents/{doc.id}/unpublish/").data["status"], "unpublished")
        self.assertEqual(client.post(f"/api/faculty/documents/{doc.id}/archive/").data["status"], "archived")
        self.assertEqual(client.post(f"/api/faculty/documents/{doc.id}/process/").status_code, 409)


@override_settings(MEDIA_ROOT=MEDIA)
class StudentAccessTests(TestCase):
    def setUp(self):
        patcher = patch("documents.services.documents.parse_document", side_effect=fake_parse)
        patcher.start()
        self.addCleanup(patcher.stop)
        self.faculty = make_faculty()
        self.student = make_student()
        self.outsider = make_student()
        self.subject = make_subject(code="OS")
        assign(self.faculty, self.subject)
        enroll(self.student, self.subject)
        self.fc = client_for(self.faculty)
        doc_id = self.fc.post("/api/faculty/documents/", {"subject_id": str(self.subject.id), "file": pdf_upload()}, format="multipart").data["id"]
        self.fc.post(f"/api/faculty/documents/{doc_id}/process/")
        self.doc = Document.objects.get(pk=doc_id)
        self.module = Module.objects.get(chapter__document=self.doc, title="Process Management")

    def test_unpublished_document_invisible_to_student(self):
        sc = client_for(self.student)
        self.assertEqual(sc.get(f"/api/student/subjects/{self.subject.id}/documents/").data, [])
        self.assertEqual(sc.get(f"/api/student/documents/{self.doc.id}/").status_code, 404)
        self.assertEqual(sc.get(f"/api/student/modules/{self.module.id}/").status_code, 404)

    def test_locked_module_returns_module_locked(self):
        self.fc.post(f"/api/faculty/documents/{self.doc.id}/publish/")
        sc = client_for(self.student)
        listing = sc.get(f"/api/student/documents/{self.doc.id}/").data
        self.assertEqual(listing["chapters"][0]["modules"][0]["availability"], "locked")
        self.assertNotIn("source_text", listing["chapters"][0]["modules"][0])
        res = sc.get(f"/api/student/modules/{self.module.id}/")
        self.assertEqual(res.status_code, 403)
        self.assertEqual(res.data["error"]["code"], "MODULE_LOCKED")

    def test_open_module_readable_and_marks_in_progress(self):
        self.fc.post(f"/api/faculty/documents/{self.doc.id}/publish/")
        opened = self.fc.post(f"/api/faculty/modules/{self.module.id}/availability/", {"availability": "open"}, format="json")
        self.assertEqual(opened.data["availability"], "open")
        sc = client_for(self.student)
        res = sc.get(f"/api/student/modules/{self.module.id}/")
        self.assertEqual(res.status_code, 200, res.content)
        self.assertIn("Processes are programs", res.data["source_text"])
        self.assertEqual(res.data["progress"]["status"], "in_progress")
        doc_view = sc.get(f"/api/student/documents/{self.doc.id}/").data
        self.assertEqual(doc_view["chapters"][0]["status"], "in_progress")
        subj_docs = sc.get(f"/api/student/subjects/{self.subject.id}/documents/").data
        self.assertEqual(subj_docs[0]["open_module_count"], 1)

    def test_chapter_level_open_and_lock(self):
        self.fc.post(f"/api/faculty/documents/{self.doc.id}/publish/")
        chapter = self.doc.chapters.first()
        res = self.fc.post(f"/api/faculty/chapters/{chapter.id}/availability/", {"availability": "open"}, format="json")
        self.assertTrue(all(m["availability"] == "open" for m in res.data))
        self.fc.post(f"/api/faculty/modules/{self.module.id}/availability/", {"availability": "locked"}, format="json")
        self.assertEqual(client_for(self.student).get(f"/api/student/modules/{self.module.id}/").status_code, 403)

    def test_student_cannot_change_availability(self):
        res = client_for(self.student).post(f"/api/faculty/modules/{self.module.id}/availability/", {"availability": "open"}, format="json")
        self.assertEqual(res.status_code, 403)

    def test_unenrolled_student_sees_nothing(self):
        self.fc.post(f"/api/faculty/documents/{self.doc.id}/publish/")
        self.fc.post(f"/api/faculty/modules/{self.module.id}/availability/", {"availability": "open"}, format="json")
        oc = client_for(self.outsider)
        self.assertEqual(oc.get(f"/api/student/modules/{self.module.id}/").status_code, 404)
        self.assertEqual(oc.get(f"/api/student/subjects/{self.subject.id}/documents/").status_code, 404)

    def test_discontinued_enrollment_removes_access(self):
        self.fc.post(f"/api/faculty/documents/{self.doc.id}/publish/")
        self.fc.post(f"/api/faculty/modules/{self.module.id}/availability/", {"availability": "open"}, format="json")
        self.fc.post(f"/api/faculty/subjects/{self.subject.id}/students/{self.student.id}/discontinue/")
        self.assertEqual(client_for(self.student).get(f"/api/student/modules/{self.module.id}/").status_code, 404)
