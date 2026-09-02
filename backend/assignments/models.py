from django.conf import settings
from django.db import models

from core.models import TimeStampedUUIDModel


class AssignmentStatus(models.TextChoices):
    DRAFT = "draft", "Draft"
    PUBLISHED = "published", "Published"
    CLOSED = "closed", "Closed"


class Assignment(TimeStampedUUIDModel):
    subject = models.ForeignKey("academics.Subject", on_delete=models.PROTECT, related_name="assignments")
    chapter = models.ForeignKey("learning.Chapter", null=True, blank=True, on_delete=models.PROTECT, related_name="assignments")
    module = models.ForeignKey("learning.Module", null=True, blank=True, on_delete=models.PROTECT, related_name="assignments")
    created_by = models.ForeignKey(settings.AUTH_USER_MODEL, null=True, on_delete=models.SET_NULL, related_name="+")
    title = models.CharField(max_length=300)
    description = models.TextField(blank=True)
    instructions = models.TextField(blank=True)
    rubric = models.JSONField(default=list, blank=True)  # [{"criterion":..., "points":...}]
    max_score = models.PositiveSmallIntegerField(default=100)
    generator = models.CharField(max_length=10, default="manual")  # ai | fallback | manual
    status = models.CharField(max_length=10, choices=AssignmentStatus.choices, default=AssignmentStatus.DRAFT, db_index=True)
    available_from = models.DateTimeField(null=True, blank=True)
    due_at = models.DateTimeField(null=True, blank=True)
    allow_late = models.BooleanField(default=True)
    allow_resubmission = models.BooleanField(default=False)
    published_at = models.DateTimeField(null=True, blank=True)
    closed_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        ordering = ["-created_at"]
        indexes = [models.Index(fields=["subject", "status"])]

    def __str__(self):
        return self.title


class SubmissionStatus(models.TextChoices):
    SUBMITTED = "submitted", "Submitted"
    EVALUATED = "evaluated", "Evaluated"
    RETURNED = "returned", "Returned for revision"


class AssignmentSubmission(TimeStampedUUIDModel):
    assignment = models.ForeignKey(Assignment, on_delete=models.PROTECT, related_name="submissions")
    student = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="assignment_submissions")
    attempt_number = models.PositiveSmallIntegerField(default=1)
    content = models.TextField()
    submitted_at = models.DateTimeField(auto_now_add=True)
    is_late = models.BooleanField(default=False)
    time_spent_seconds = models.PositiveIntegerField(default=0)  # client-reported, clamped; app-session time is the audited source
    status = models.CharField(max_length=12, choices=SubmissionStatus.choices, default=SubmissionStatus.SUBMITTED, db_index=True)
    score = models.FloatField(null=True, blank=True)
    feedback = models.TextField(blank=True)
    rubric_scores = models.JSONField(default=list, blank=True)
    evaluated_by = models.ForeignKey(settings.AUTH_USER_MODEL, null=True, blank=True, on_delete=models.SET_NULL, related_name="+")
    evaluated_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        ordering = ["-submitted_at"]
        constraints = [models.UniqueConstraint(fields=["assignment", "student", "attempt_number"], name="uniq_submission_attempt")]

    def __str__(self):
        return f"{self.student.email} -> {self.assignment.title} #{self.attempt_number}"
