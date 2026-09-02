from rest_framework import serializers
from .models import Assignment, AssignmentSubmission


class AssignmentSerializer(serializers.ModelSerializer):
    subject_id = serializers.UUIDField(read_only=True)
    chapter_id = serializers.UUIDField(read_only=True)
    module_id = serializers.UUIDField(read_only=True)
    submission_count = serializers.SerializerMethodField()

    class Meta:
        model = Assignment
        fields = ["id", "subject_id", "chapter_id", "module_id", "title", "description", "instructions", "rubric", "max_score",
                  "generator", "status", "available_from", "due_at", "allow_late", "allow_resubmission", "published_at",
                  "closed_at", "submission_count", "created_at", "updated_at"]

    def get_submission_count(self, a) -> int:
        return a.submissions.count()


class SubmissionSerializer(serializers.ModelSerializer):
    assignment_id = serializers.UUIDField(read_only=True)
    assignment_title = serializers.CharField(source="assignment.title", read_only=True)
    max_score = serializers.IntegerField(source="assignment.max_score", read_only=True)
    student_id = serializers.UUIDField(read_only=True)
    student_email = serializers.EmailField(source="student.email", read_only=True)

    class Meta:
        model = AssignmentSubmission
        fields = ["id", "assignment_id", "assignment_title", "max_score", "student_id", "student_email", "attempt_number",
                  "content", "submitted_at", "is_late", "time_spent_seconds", "status", "score", "feedback", "rubric_scores", "evaluated_at"]


class RubricItemSerializer(serializers.Serializer):
    criterion = serializers.CharField()
    points = serializers.IntegerField(min_value=0)


class _Fields(serializers.Serializer):
    title = serializers.CharField(max_length=300, required=False)
    description = serializers.CharField(required=False, allow_blank=True)
    instructions = serializers.CharField(required=False, allow_blank=True)
    rubric = RubricItemSerializer(many=True, required=False)
    max_score = serializers.IntegerField(min_value=1, max_value=1000, required=False)
    available_from = serializers.DateTimeField(required=False, allow_null=True)
    due_at = serializers.DateTimeField(required=False, allow_null=True)
    allow_late = serializers.BooleanField(required=False)
    allow_resubmission = serializers.BooleanField(required=False)


class CreateSerializer(_Fields):
    title = serializers.CharField(max_length=300)
    subject_id = serializers.UUIDField(required=False)
    chapter_id = serializers.UUIDField(required=False)
    module_id = serializers.UUIDField(required=False)


class GenerateSerializer(_Fields):
    chapter_id = serializers.UUIDField(required=False)
    module_id = serializers.UUIDField(required=False)
    focus = serializers.CharField(required=False, allow_blank=True, max_length=300)


class StatusSerializer(serializers.Serializer):
    status = serializers.ChoiceField(choices=["published", "closed"])


class SubmitSerializer(serializers.Serializer):
    content = serializers.CharField()
    time_spent_seconds = serializers.IntegerField(min_value=0, required=False, default=0)


class EvaluateSerializer(serializers.Serializer):
    score = serializers.FloatField(required=False, allow_null=True)
    feedback = serializers.CharField(required=False, allow_blank=True)
    rubric_scores = serializers.ListField(child=serializers.DictField(), required=False)
    status = serializers.ChoiceField(choices=["evaluated", "returned"], default="evaluated")
