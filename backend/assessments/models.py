from django.conf import settings
from django.db import models

from core.models import TimeStampedUUIDModel


class AssessmentKind(models.TextChoices):
    MODULE = "module", "Module quiz"
    CHAPTER = "chapter", "Chapter quiz"
    SELECTION = "selection", "Several chosen modules"


class ResultsRelease(models.TextChoices):
    """When a student may see the outcome of their own attempt.

    IMMEDIATE keeps the original behaviour: the result is part of the submit
    response. HELD shows the student only that the attempt was received until
    faculty release it. SCHEDULED releases without anyone pressing anything,
    the first time the student loads the page after the chosen moment, which
    needs no scheduler in a deployment that may have none.
    """

    IMMEDIATE = "immediate", "Shown on submission"
    HELD = "held", "Held until released"
    SCHEDULED = "scheduled", "Released at a set time"


class AssessmentStatus(models.TextChoices):
    DRAFT = "draft", "Draft"
    PUBLISHED = "published", "Published"
    CLOSED = "closed", "Closed"
    SUPERSEDED = "superseded", "Superseded by a newer version"


class Generator(models.TextChoices):
    AI = "ai", "AI generated"
    FALLBACK = "fallback", "Fallback generator"
    MANUAL = "manual", "Manually authored"


class Assessment(TimeStampedUUIDModel):
    """A quiz. Questions (with answers) are immutable once any attempt exists;
    editing then creates a new version row that supersedes this one."""

    subject = models.ForeignKey("academics.Subject", on_delete=models.PROTECT, related_name="assessments")
    chapter = models.ForeignKey("learning.Chapter", null=True, blank=True, on_delete=models.PROTECT, related_name="assessments")
    module = models.ForeignKey("learning.Module", null=True, blank=True, on_delete=models.PROTECT, related_name="assessments")
    # A quiz drawn from several chosen modules keeps `chapter` set to the
    # chapter they share (null when they span chapters) and lists every module
    # it was written from here. Module and chapter quizzes leave it empty.
    source_modules = models.ManyToManyField("learning.Module", blank=True, related_name="sourced_assessments")
    kind = models.CharField(max_length=12, choices=AssessmentKind.choices)
    title = models.CharField(max_length=300)
    instructions = models.TextField(blank=True)
    questions = models.JSONField(default=list)  # private: includes correct answers and rubrics
    generator = models.CharField(max_length=10, choices=Generator.choices, default=Generator.MANUAL)
    status = models.CharField(max_length=12, choices=AssessmentStatus.choices, default=AssessmentStatus.DRAFT, db_index=True)
    pass_percentage = models.PositiveSmallIntegerField(default=65)
    max_attempts = models.PositiveSmallIntegerField(null=True, blank=True)  # null = unlimited
    time_limit_minutes = models.PositiveSmallIntegerField(null=True, blank=True)
    available_from = models.DateTimeField(null=True, blank=True)
    due_at = models.DateTimeField(null=True, blank=True)
    version = models.PositiveIntegerField(default=1)
    supersedes = models.OneToOneField("self", null=True, blank=True, on_delete=models.SET_NULL, related_name="superseded_by")
    created_by = models.ForeignKey(settings.AUTH_USER_MODEL, null=True, on_delete=models.SET_NULL, related_name="+")
    published_at = models.DateTimeField(null=True, blank=True)
    closed_at = models.DateTimeField(null=True, blank=True)
    content_version_at_creation = models.PositiveIntegerField(default=1)
    results_release = models.CharField(max_length=12, choices=ResultsRelease.choices, default=ResultsRelease.IMMEDIATE)
    results_release_at = models.DateTimeField(null=True, blank=True)   # used by SCHEDULED
    results_released_at = models.DateTimeField(null=True, blank=True)  # set when faculty release the whole quiz
    results_released_by = models.ForeignKey(settings.AUTH_USER_MODEL, null=True, blank=True, on_delete=models.SET_NULL, related_name="+")

    class Meta:
        ordering = ["-created_at"]
        indexes = [models.Index(fields=["subject", "status"]), models.Index(fields=["module", "status"])]

    def __str__(self):
        return f"{self.title} v{self.version}"

    @property
    def question_count(self):
        return len(self.questions or [])


class AttemptStatus(models.TextChoices):
    IN_PROGRESS = "in_progress", "In progress"
    SUBMITTED = "submitted", "Submitted"
    PENDING_EVALUATION = "pending_evaluation", "Pending subjective evaluation"
    EVALUATED = "evaluated", "Evaluated"


class AssessmentAttempt(TimeStampedUUIDModel):
    """Immutable historical record of one student sitting one assessment version."""

    assessment = models.ForeignKey(Assessment, on_delete=models.PROTECT, related_name="attempts")
    student = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="assessment_attempts")
    attempt_number = models.PositiveSmallIntegerField()
    status = models.CharField(max_length=20, choices=AttemptStatus.choices, default=AttemptStatus.IN_PROGRESS, db_index=True)
    started_at = models.DateTimeField(auto_now_add=True)
    submitted_at = models.DateTimeField(null=True, blank=True)
    time_taken_seconds = models.PositiveIntegerField(null=True, blank=True)
    submitted_answers = models.JSONField(default=dict)
    score = models.FloatField(null=True, blank=True)
    total_questions = models.PositiveSmallIntegerField(default=0)
    percentage = models.FloatField(null=True, blank=True)
    passed = models.BooleanField(null=True, blank=True)
    detailed_results = models.JSONField(default=list)
    evaluation_notes = models.JSONField(default=dict, blank=True)
    evaluated_by = models.ForeignKey(settings.AUTH_USER_MODEL, null=True, blank=True, on_delete=models.SET_NULL, related_name="+")
    evaluated_at = models.DateTimeField(null=True, blank=True)
    # Set when this one attempt is released ahead of the rest.
    results_released_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        ordering = ["-started_at"]
        constraints = [models.UniqueConstraint(fields=["assessment", "student", "attempt_number"], name="uniq_attempt_number")]
        indexes = [models.Index(fields=["student", "status"])]

    def __str__(self):
        return f"{self.student.email} attempt {self.attempt_number} on {self.assessment.title}"

    @property
    def results_visible(self):
        """Whether the student who owns this attempt may see its outcome."""
        from django.utils import timezone

        mode = self.assessment.results_release
        if mode == ResultsRelease.IMMEDIATE:
            return True
        if self.results_released_at or self.assessment.results_released_at:
            return True
        if mode == ResultsRelease.SCHEDULED and self.assessment.results_release_at:
            return timezone.now() >= self.assessment.results_release_at
        return False
