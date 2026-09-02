"""Student-side content access and progress."""
from django.db import transaction
from django.utils import timezone

from academics.models import Enrollment, EnrollmentStatus
from core.exceptions import Forbidden, NotFound
from documents.models import Document, DocumentStatus

from .models import Module, ModuleAvailability, ModuleProgress, ProgressStatus


def student_documents(student, subject=None):
    qs = Document.objects.visible_to(student).select_related("subject")
    if subject is not None:
        qs = qs.filter(subject=subject)
    return qs


def student_module_queryset(student):
    """Modules in published documents of subjects the student is actively enrolled in."""
    return Module.objects.filter(
        chapter__document__status=DocumentStatus.PUBLISHED,
        chapter__document__subject__status="active",
        chapter__document__subject__enrollments__student=student,
        chapter__document__subject__enrollments__status=EnrollmentStatus.ACTIVE,
    ).distinct()


def resolve_accessible_module(student, module_id):
    """Every rule from the access policy in one place. Raises NotFound when the
    module is outside the student's world, MODULE_LOCKED when it is inside but
    not yet opened."""
    try:
        module = student_module_queryset(student).select_related("chapter__document__subject").get(pk=module_id)
    except (Module.DoesNotExist, ValueError, TypeError):
        raise NotFound("Module not found.")
    if module.availability != ModuleAvailability.OPEN:
        raise Forbidden("This module has not been opened by faculty.", code="MODULE_LOCKED")
    return module


@transaction.atomic
def record_module_view(student, module):
    progress, _ = ModuleProgress.objects.select_for_update().get_or_create(student=student, module=module)
    now = timezone.now()
    progress.last_viewed_at = now
    if progress.status == ProgressStatus.NOT_STARTED:
        progress.status = ProgressStatus.IN_PROGRESS
        progress.started_at = now
    progress.save()
    return progress


@transaction.atomic
def record_quiz_outcome(student, module, percentage, passed):
    progress, _ = ModuleProgress.objects.select_for_update().get_or_create(student=student, module=module)
    now = timezone.now()
    progress.quiz_attempts += 1
    progress.best_quiz_percentage = max(progress.best_quiz_percentage or 0.0, percentage)
    if progress.started_at is None:
        progress.started_at = now
    if passed:
        if progress.status != ProgressStatus.COMPLETED:
            progress.completed_at = now
        progress.status = ProgressStatus.COMPLETED
    elif progress.status != ProgressStatus.COMPLETED:
        progress.status = ProgressStatus.NEEDS_REVIEW
    progress.save()
    return progress


def progress_map(student, modules):
    return {p.module_id: p for p in ModuleProgress.objects.filter(student=student, module__in=modules)}


def chapter_status(progress_rows, modules):
    if not modules:
        return ProgressStatus.NOT_STARTED
    statuses = [progress_rows.get(m.id).status if progress_rows.get(m.id) else ProgressStatus.NOT_STARTED for m in modules]
    if all(s == ProgressStatus.COMPLETED for s in statuses):
        return ProgressStatus.COMPLETED
    if all(s == ProgressStatus.NOT_STARTED for s in statuses):
        return ProgressStatus.NOT_STARTED
    if any(s == ProgressStatus.NEEDS_REVIEW for s in statuses):
        return ProgressStatus.NEEDS_REVIEW
    return ProgressStatus.IN_PROGRESS
