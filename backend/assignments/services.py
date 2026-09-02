from django.conf import settings
from django.db import transaction
from django.db.models import Q
from django.utils import timezone

from academics.models import Subject, faculty_manages_subject
from ai.gateway import gateway, trim_source
from audit import services as audit
from core.exceptions import Conflict, Forbidden, NotFound, ValidationFailed
from learning import services as learning
from learning.models import Chapter, Module

from .models import Assignment, AssignmentStatus, AssignmentSubmission, SubmissionStatus

GEN_SCHEMA = {"type": "object", "properties": {
    "title": {"type": "string"}, "description": {"type": "string"}, "instructions": {"type": "string"},
    "rubric": {"type": "array", "minItems": 2, "maxItems": 6, "items": {"type": "object", "properties": {
        "criterion": {"type": "string"}, "points": {"type": "integer"}}, "required": ["criterion", "points"]}}},
    "required": ["title", "description", "instructions", "rubric"]}


def manageable(user):
    return Assignment.objects.filter(subject__in=Subject.objects.visible_to(user)).select_related("subject", "module", "chapter", "created_by")


def student_visible(student):
    now = timezone.now()
    open_modules = learning.student_module_queryset(student).filter(availability="open")
    return (Assignment.objects.filter(status=AssignmentStatus.PUBLISHED)
            .filter(Q(module__in=open_modules) | Q(module__isnull=True, chapter__modules__in=open_modules)
                    | Q(module__isnull=True, chapter__isnull=True, subject__in=Subject.objects.visible_to(student)))
            .exclude(available_from__gt=now).select_related("subject", "module", "chapter").distinct())


def _require_manage(actor, subject):
    if not faculty_manages_subject(actor, subject):
        raise Forbidden("You do not manage this subject.", code="SUBJECT_NOT_ASSIGNED")


def _target(actor, subject_id=None, module_id=None, chapter_id=None):
    subjects = Subject.objects.visible_to(actor)
    if module_id:
        try:
            m = Module.objects.select_related("chapter__document__subject").get(pk=module_id, chapter__document__subject__in=subjects)
        except (Module.DoesNotExist, ValueError):
            raise NotFound("Module not found.")
        return m.chapter.document.subject, m.chapter, m, m.source_text, m.title
    if chapter_id:
        try:
            c = Chapter.objects.select_related("document__subject").prefetch_related("modules").get(pk=chapter_id, document__subject__in=subjects)
        except (Chapter.DoesNotExist, ValueError):
            raise NotFound("Chapter not found.")
        return c.document.subject, c, None, "\n\n".join(m.source_text for m in c.modules.all()), c.title
    if subject_id:
        try:
            s = subjects.get(pk=subject_id)
        except (Subject.DoesNotExist, ValueError):
            raise NotFound("Subject not found.")
        return s, None, None, "", s.name
    raise ValidationFailed("subject_id, chapter_id or module_id is required.", code="TARGET_REQUIRED")


def _normalize_rubric(rubric, max_score):
    rubric = rubric or []
    out = []
    for r in rubric:
        crit = str(r.get("criterion") or "").strip()
        try:
            pts = int(r.get("points"))
        except (TypeError, ValueError):
            raise ValidationFailed(details={"rubric": "points must be integers"})
        if not crit or pts < 0:
            raise ValidationFailed(details={"rubric": "each criterion needs text and non-negative points"})
        out.append({"criterion": crit, "points": pts})
    if out and sum(r["points"] for r in out) != max_score:
        raise ValidationFailed(details={"rubric": f"rubric points must total max_score ({max_score})"})
    return out


@transaction.atomic
def create(actor, *, subject_id=None, module_id=None, chapter_id=None, request=None, **fields):
    subject, chapter, module, _, _ = _target(actor, subject_id, module_id, chapter_id)
    _require_manage(actor, subject)
    max_score = fields.get("max_score") or 100
    a = Assignment.objects.create(subject=subject, chapter=chapter, module=module, created_by=actor,
                                  title=fields["title"][:300], description=fields.get("description", ""),
                                  instructions=fields.get("instructions", ""), max_score=max_score,
                                  rubric=_normalize_rubric(fields.get("rubric"), max_score),
                                  **{k: v for k, v in fields.items() if k in ("available_from", "due_at", "allow_late", "allow_resubmission")})
    audit.record(actor, "assignment.created", a, {}, request)
    return a


@transaction.atomic
def generate(actor, *, module_id=None, chapter_id=None, focus="", request=None, **fields):
    subject, chapter, module, source, name = _target(actor, None, module_id, chapter_id)
    _require_manage(actor, subject)
    if not source.strip():
        raise ValidationFailed("Cannot generate an assignment without source text.", code="NO_SOURCE")
    max_score = fields.get("max_score") or 100
    system = (
        "You design one written assignment from a textbook excerpt. Follow every rule.\n"
        "1. Everything must be answerable from the SOURCE TEXT alone.\n"
        "2. title is short. description is one paragraph for the student. instructions say exactly what to write and roughly how long.\n"
        f"3. rubric has two to six criteria; the integer points must add up to exactly {max_score}.\n"
        "4. Output JSON only."
    )
    user = f"TOPIC: {name}\nTOTAL POINTS: {max_score}\nFOCUS: {focus or 'general understanding'}\n\nSOURCE TEXT:\n\"\"\"{trim_source(source)}\"\"\""
    result = gateway().generate(purpose="assignment", system_prompt=system, user_prompt=user, schema=GEN_SCHEMA, temperature=0.5)
    generator, warning = "ai", ""
    if result.ok and sum(r["points"] for r in result.data["rubric"]) == max_score:
        data = result.data
    else:
        generator = "fallback"
        warning = f"{result.error_code}: {result.error}" if result.failed else "rubric points did not sum to max_score"
        first = source.strip().split(".")[0][:200]
        data = {"title": f"Assignment: {name}", "description": f"A written exercise on {name}.",
                "instructions": f"In 400-600 words, explain the ideas in '{name}'. Start from: \"{first}\". Use only the module material.",
                "rubric": [{"criterion": "Accuracy against the source", "points": max_score // 2},
                           {"criterion": "Clarity and structure", "points": max_score - max_score // 2}]}
    a = Assignment.objects.create(subject=subject, chapter=chapter, module=module, created_by=actor, generator=generator,
                                  title=data["title"][:300], description=data["description"], instructions=data["instructions"],
                                  rubric=_normalize_rubric(data["rubric"], max_score), max_score=max_score,
                                  **{k: v for k, v in fields.items() if k in ("available_from", "due_at", "allow_late", "allow_resubmission")})
    audit.record(actor, "assignment.generated", a, {"generator": generator, "warning": warning[:200]}, request)
    return a, warning


@transaction.atomic
def update(actor, a, request=None, **fields):
    _require_manage(actor, a.subject)
    changes = {}
    max_score = fields.get("max_score", a.max_score)
    for key in ("title", "description", "instructions", "max_score", "available_from", "due_at", "allow_late", "allow_resubmission"):
        if key in fields and fields[key] is not None and fields[key] != getattr(a, key):
            setattr(a, key, fields[key]); changes[key] = True
    if "rubric" in fields and fields["rubric"] is not None:
        a.rubric = _normalize_rubric(fields["rubric"], max_score); changes["rubric"] = True
    if changes:
        a.save()
        audit.record(actor, "assignment.updated", a, changes, request)
    return a


@transaction.atomic
def set_status(actor, a, status, request=None):
    _require_manage(actor, a.subject)
    if status == AssignmentStatus.PUBLISHED:
        if a.status == AssignmentStatus.PUBLISHED:
            raise Conflict("Already published.", code="INVALID_STATE")
        a.status, a.published_at = status, timezone.now()
    elif status == AssignmentStatus.CLOSED:
        if a.status != AssignmentStatus.PUBLISHED:
            raise Conflict("Only published assignments can be closed.", code="INVALID_STATE")
        a.status, a.closed_at = status, timezone.now()
    else:
        raise ValidationFailed(details={"status": "Use 'published' or 'closed'."})
    a.save()
    audit.record(actor, f"assignment.{status}", a, {}, request)
    return a


@transaction.atomic
def submit(student, assignment_id, content, time_spent_seconds=0, request=None):
    try:
        a = student_visible(student).get(pk=assignment_id)
    except (Assignment.DoesNotExist, ValueError):
        raise NotFound("Assignment not found.")
    if a.module_id:
        learning.resolve_accessible_module(student, a.module_id)
    if not (content or "").strip():
        raise ValidationFailed(details={"content": "Submission content is required."})
    now = timezone.now()
    late = bool(a.due_at and now > a.due_at)
    if late and not a.allow_late:
        raise Conflict("The due date has passed and late submissions are not accepted.", code="PAST_DUE")
    existing = AssignmentSubmission.objects.filter(assignment=a, student=student).count()
    if existing and not a.allow_resubmission:
        raise Conflict("You have already submitted this assignment.", code="ALREADY_SUBMITTED")
    cap = settings.LOCALMIND["MAX_QUIZ_DURATION_HOURS"] * 3600
    sub = AssignmentSubmission.objects.create(assignment=a, student=student, attempt_number=existing + 1, content=content,
                                              is_late=late, time_spent_seconds=max(0, min(int(time_spent_seconds or 0), cap)))
    from activity.services import record_event
    record_event(student, "assignment", sub.time_spent_seconds, subject=a.subject, module=a.module, reference_id=sub.id)
    audit.record(student, "assignment.submitted", sub, {"assignment": str(a.id), "late": late}, request)
    return sub


@transaction.atomic
def evaluate(actor, sub, score=None, feedback="", rubric_scores=None, status=SubmissionStatus.EVALUATED, request=None):
    _require_manage(actor, sub.assignment.subject)
    if rubric_scores:
        total = 0.0
        for row in rubric_scores:
            total += float(row.get("points_awarded", 0))
        score = total if score is None else score
        sub.rubric_scores = rubric_scores
    if status == SubmissionStatus.EVALUATED:
        if score is None:
            raise ValidationFailed(details={"score": "A score is required to mark as evaluated."})
        if score < 0 or score > sub.assignment.max_score:
            raise ValidationFailed(details={"score": f"Score must be between 0 and {sub.assignment.max_score}."})
        sub.score = float(score)
    sub.feedback = feedback or sub.feedback
    sub.status = status
    sub.evaluated_by, sub.evaluated_at = actor, timezone.now()
    sub.save()
    audit.record(actor, "assignment.evaluated", sub, {"score": sub.score, "status": status}, request)
    return sub
