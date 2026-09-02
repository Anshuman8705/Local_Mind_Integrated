from rest_framework import serializers

from learning.models import Chapter, Module
from .models import Document


class ModuleSerializer(serializers.ModelSerializer):
    chapter_id = serializers.UUIDField(read_only=True)

    class Meta:
        model = Module
        fields = ["id", "chapter_id", "title", "order", "source_heading_index", "source_text", "source_missing",
                  "start_page", "end_page", "is_user_edited", "availability", "opened_at", "created_at", "updated_at"]


class ModuleBriefSerializer(serializers.ModelSerializer):
    class Meta:
        model = Module
        fields = ["id", "title", "order", "source_missing", "availability", "start_page", "end_page"]


class ChapterSerializer(serializers.ModelSerializer):
    document_id = serializers.UUIDField(read_only=True)
    modules = ModuleSerializer(many=True, read_only=True)

    class Meta:
        model = Chapter
        fields = ["id", "document_id", "title", "order", "source_heading_index", "source_text", "start_page", "end_page",
                  "is_user_edited", "modules", "created_at", "updated_at"]


class ChapterBriefSerializer(serializers.ModelSerializer):
    modules = ModuleBriefSerializer(many=True, read_only=True)

    class Meta:
        model = Chapter
        fields = ["id", "title", "order", "modules"]


class DocumentSerializer(serializers.ModelSerializer):
    subject_id = serializers.UUIDField(read_only=True)
    subject_code = serializers.CharField(source="subject.code", read_only=True)
    uploaded_by_id = serializers.UUIDField(read_only=True)
    uploaded_by_name = serializers.CharField(source="uploaded_by.full_name", read_only=True, default="")
    chapter_count = serializers.SerializerMethodField()
    module_count = serializers.SerializerMethodField()

    class Meta:
        model = Document
        fields = ["id", "subject_id", "subject_code", "title", "original_name", "file_type", "file_size", "status",
                  "outline_source", "parse_mode", "error_message", "uploaded_by_id", "uploaded_by_name",
                  "processed_at", "reviewed_at", "published_at", "unpublished_at", "archived_at",
                  "content_version", "last_edited_at", "chapter_count", "module_count", "created_at", "updated_at"]

    def get_chapter_count(self, doc) -> int:
        return getattr(doc, "chapter_count", None) if hasattr(doc, "chapter_count") else doc.chapters.count()

    def get_module_count(self, doc) -> int:
        return getattr(doc, "module_count", None) if hasattr(doc, "module_count") else Module.objects.filter(chapter__document=doc).count()


class DocumentDetailSerializer(DocumentSerializer):
    chapters = ChapterSerializer(many=True, read_only=True)
    missing_source_modules = serializers.SerializerMethodField()

    class Meta(DocumentSerializer.Meta):
        fields = DocumentSerializer.Meta.fields + ["extracted_headings", "chapters", "missing_source_modules"]

    def get_missing_source_modules(self, doc):
        return [str(m.id) for m in Module.objects.filter(chapter__document=doc, source_missing=True)]


class UploadSerializer(serializers.Serializer):
    subject_id = serializers.UUIDField()
    file = serializers.FileField()
    title = serializers.CharField(max_length=300, required=False, allow_blank=True)


class OutlineModuleInSerializer(serializers.Serializer):
    id = serializers.UUIDField(required=False)
    title = serializers.CharField(max_length=300)
    source_heading_index = serializers.IntegerField(required=False, allow_null=True)
    source_text = serializers.CharField(required=False, allow_blank=True)


class OutlineChapterInSerializer(serializers.Serializer):
    id = serializers.UUIDField(required=False)
    title = serializers.CharField(max_length=300)
    source_heading_index = serializers.IntegerField(required=False, allow_null=True)
    source_text = serializers.CharField(required=False, allow_blank=True)
    modules = OutlineModuleInSerializer(many=True, required=False)


class OutlineInSerializer(serializers.Serializer):
    document_title = serializers.CharField(max_length=300, required=False, allow_blank=True)
    chapters = OutlineChapterInSerializer(many=True)


class ContentEditSerializer(serializers.Serializer):
    title = serializers.CharField(max_length=300, required=False)
    source_text = serializers.CharField(required=False, allow_blank=True)


class AvailabilitySerializer(serializers.Serializer):
    availability = serializers.ChoiceField(choices=["open", "locked"])
