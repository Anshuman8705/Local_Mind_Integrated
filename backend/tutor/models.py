from django.conf import settings
from django.db import models

from core.models import TimeStampedUUIDModel


class ModuleLesson(TimeStampedUUIDModel):
    """Cached structured lesson per (module, document content_version). Shared
    across students because it depends only on the source text."""

    module = models.ForeignKey("learning.Module", on_delete=models.CASCADE, related_name="lessons")
    content_version = models.PositiveIntegerField()
    lesson = models.JSONField()
    generator = models.CharField(max_length=10, default="ai")  # ai | fallback
    model_name = models.CharField(max_length=100, blank=True)

    class Meta:
        constraints = [models.UniqueConstraint(fields=["module", "content_version"], name="uniq_lesson_per_module_version")]


class Conversation(TimeStampedUUIDModel):
    student = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="conversations")
    module = models.ForeignKey("learning.Module", on_delete=models.CASCADE, related_name="conversations")
    title = models.CharField(max_length=200, blank=True)
    last_message_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        ordering = ["-updated_at"]
        indexes = [models.Index(fields=["student", "module"])]


class Message(TimeStampedUUIDModel):
    conversation = models.ForeignKey(Conversation, on_delete=models.CASCADE, related_name="messages")
    role = models.CharField(max_length=10)  # user | assistant | system
    content = models.TextField()
    grounded = models.BooleanField(default=True)
    source_reference = models.TextField(blank=True)
    model_name = models.CharField(max_length=100, blank=True)
    latency_ms = models.PositiveIntegerField(null=True, blank=True)

    class Meta:
        ordering = ["created_at"]
