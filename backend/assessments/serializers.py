from rest_framework import serializers
from .models import Assessment, AssessmentAttempt


class AssessmentSerializer(serializers.ModelSerializer):
    """Faculty/admin view: includes answers."""
    subject_id = serializers.UUIDField(read_only=True)
    source_module_ids = serializers.SerializerMethodField()
    pending_release_count = serializers.SerializerMethodField()
    chapter_id = serializers.UUIDField(read_only=True)
    module_id = serializers.UUIDField(read_only=True)
    created_by_name = serializers.CharField(source="created_by.full_name", read_only=True, default="")
    question_count = serializers.IntegerField(read_only=True)
    attempt_count = serializers.SerializerMethodField()

    class Meta:
        model = Assessment
        fields = ["id", "subject_id", "chapter_id", "module_id", "kind", "title", "instructions", "questions", "generator", "status",
                  "pass_percentage", "max_attempts", "time_limit_minutes", "available_from", "due_at", "version", "supersedes",
                  "created_by_name", "published_at", "closed_at", "question_count", "attempt_count", "created_at", "updated_at",
                  "source_module_ids", "results_release", "results_release_at", "results_released_at", "pending_release_count"]

    def get_attempt_count(self, a) -> int:
        return a.attempts.count()

    def get_source_module_ids(self, a) -> list:
        return [str(m.id) for m in a.source_modules.all()]

    def get_pending_release_count(self, a) -> int:
        from .services import assessments as svc
        return svc.pending_release_count(a)


class AssessmentStudentSerializer(serializers.ModelSerializer):
    """Student view: no answers."""
    module_id = serializers.UUIDField(read_only=True)
    chapter_id = serializers.UUIDField(read_only=True)
    question_count = serializers.IntegerField(read_only=True)

    class Meta:
        model = Assessment
        fields = ["id", "module_id", "chapter_id", "kind", "title", "instructions", "pass_percentage", "max_attempts",
                  "time_limit_minutes", "available_from", "due_at", "question_count", "version",
                  "results_release", "results_release_at"]


class AttemptSerializer(serializers.ModelSerializer):
    assessment_id = serializers.UUIDField(read_only=True)
    assessment_title = serializers.CharField(source="assessment.title", read_only=True)
    student_id = serializers.UUIDField(read_only=True)
    student_email = serializers.EmailField(source="student.email", read_only=True)

    class Meta:
        model = AssessmentAttempt
        fields = ["id", "assessment_id", "assessment_title", "student_id", "student_email", "attempt_number", "status",
                  "started_at", "submitted_at", "time_taken_seconds", "score", "total_questions", "percentage", "passed",
                  "detailed_results", "evaluation_notes", "evaluated_at", "results_released_at"]


class QuestionInSerializer(serializers.Serializer):
    type = serializers.ChoiceField(choices=["mcq", "subjective"], default="mcq")
    question = serializers.CharField()
    options = serializers.ListField(child=serializers.DictField(), required=False)
    correct_answer = serializers.CharField(required=False)
    explanation = serializers.CharField(required=False, allow_blank=True)
    expected_rubric = serializers.CharField(required=False, allow_blank=True)
    source_reference = serializers.CharField(required=False, allow_blank=True)


class _ReleaseMixin(serializers.Serializer):
    results_release = serializers.ChoiceField(choices=["immediate", "held", "scheduled"], required=False)
    results_release_at = serializers.DateTimeField(required=False, allow_null=True)

    def validate(self, data):
        data = super().validate(data)
        if data.get("results_release") == "scheduled" and not data.get("results_release_at"):
            raise serializers.ValidationError({"results_release_at": "A release time is required when results are scheduled."})
        return data


class _OptionsMixin(_ReleaseMixin):
    title = serializers.CharField(max_length=300, required=False)
    instructions = serializers.CharField(required=False, allow_blank=True)
    pass_percentage = serializers.IntegerField(min_value=1, max_value=100, required=False)
    max_attempts = serializers.IntegerField(min_value=1, required=False, allow_null=True)
    time_limit_minutes = serializers.IntegerField(min_value=1, required=False, allow_null=True)
    available_from = serializers.DateTimeField(required=False, allow_null=True)
    due_at = serializers.DateTimeField(required=False, allow_null=True)


class CreateManualSerializer(_OptionsMixin):
    module_id = serializers.UUIDField(required=False)
    chapter_id = serializers.UUIDField(required=False)
    module_ids = serializers.ListField(child=serializers.UUIDField(), required=False, min_length=1, max_length=40)
    questions = QuestionInSerializer(many=True)


class GenerateSerializer(_OptionsMixin):
    module_id = serializers.UUIDField(required=False)
    chapter_id = serializers.UUIDField(required=False)
    module_ids = serializers.ListField(child=serializers.UUIDField(), required=False, min_length=1, max_length=40)
    num_mcqs = serializers.IntegerField(min_value=0, max_value=30, default=6)
    num_subjective = serializers.IntegerField(min_value=0, max_value=10, default=0)


class UpdateSerializer(_OptionsMixin):
    questions = QuestionInSerializer(many=True, required=False)


class StatusSerializer(serializers.Serializer):
    status = serializers.ChoiceField(choices=["published", "closed"])


class SubmitSerializer(serializers.Serializer):
    submitted_answers = serializers.DictField(child=serializers.CharField(allow_blank=True))


class ReEvaluateSerializer(serializers.Serializer):
    overrides = serializers.DictField(child=serializers.DictField(), required=False)


class ReleaseResultsSerializer(serializers.Serializer):
    """Release every held attempt, or one named attempt."""

    attempt_id = serializers.UUIDField(required=False)
