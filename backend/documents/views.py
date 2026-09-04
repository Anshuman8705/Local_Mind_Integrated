from django.db.models import Count
from rest_framework import status
from rest_framework.generics import ListAPIView
from rest_framework.parsers import FormParser, MultiPartParser
from rest_framework.response import Response
from rest_framework.views import APIView

from academics.models import Subject
from core.exceptions import APIError
from core.permissions import IsAdminOrFaculty
from core.utils import get_or_404
from learning.models import Chapter, Module

from .models import Document, DocumentStatus
from .serializers import (
    AvailabilitySerializer, ChapterSerializer, ContentEditSerializer, DocumentDetailSerializer, DocumentSerializer,
    ModuleSerializer, OutlineInSerializer, UploadSerializer,
)
from .services import documents as svc


def _docs_for(user):
    return Document.objects.visible_to(user).select_related("subject", "uploaded_by")


def _doc(user, document_id):
    return get_or_404(_docs_for(user).prefetch_related("chapters__modules"), pk=document_id)


class DocumentListUploadView(ListAPIView):
    """GET lists books the caller manages; POST uploads one to a subject."""

    permission_classes = [IsAdminOrFaculty]
    serializer_class = DocumentSerializer
    parser_classes = [MultiPartParser, FormParser]

    def get_queryset(self):
        qs = _docs_for(self.request.user).annotate(chapter_count=Count("chapters", distinct=True),
                                                    module_count=Count("chapters__modules", distinct=True))
        params = self.request.query_params
        if params.get("subject"):
            qs = qs.filter(subject_id=params["subject"])
        if params.get("status"):
            qs = qs.filter(status=params["status"])
        return qs

    def post(self, request):
        serializer = UploadSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        data = serializer.validated_data
        subject = get_or_404(Subject.objects.visible_to(request.user), pk=data["subject_id"])
        document = svc.upload_document(request.user, subject, data["file"], data.get("title", ""), request)
        return Response(DocumentSerializer(document).data, status=status.HTTP_201_CREATED)


class DocumentDetailView(APIView):
    permission_classes = [IsAdminOrFaculty]

    def get(self, request, document_id):
        return Response(DocumentDetailSerializer(_doc(request.user, document_id)).data)

    def delete(self, request, document_id):
        """Permanent delete. Replaces the old archive action in the workspace."""
        document = _doc(request.user, document_id)
        label = svc.delete_document(request.user, document, request)
        return Response({"detail": f"{label} was deleted."})


class _Transition(APIView):
    permission_classes = [IsAdminOrFaculty]
    action = None

    def post(self, request, document_id):
        document = _doc(request.user, document_id)
        document = getattr(svc, self.action)(request.user, document, request)
        return Response(DocumentDetailSerializer(document).data)


class ProcessView(APIView):
    """Returns the document in 'processing' (background) or its final state
    when processing ran inline; an inline failure is reported as 422."""

    permission_classes = [IsAdminOrFaculty]

    def post(self, request, document_id):
        document = _doc(request.user, document_id)
        document = svc.start_processing(request.user, document, request)
        if document.status == DocumentStatus.ERROR:
            raise APIError("Document processing failed.", code="PROCESSING_FAILED", status_code=422,
                           details={"document_id": str(document.id), "error": document.error_message})
        return Response(DocumentDetailSerializer(_doc(request.user, document_id)).data)


class MarkReadyView(_Transition):
    action = "mark_ready"


class PublishView(_Transition):
    action = "publish"


class UnpublishView(_Transition):
    action = "unpublish"


class ArchiveView(_Transition):
    action = "archive"


class OutlineView(APIView):
    permission_classes = [IsAdminOrFaculty]

    def get(self, request, document_id):
        document = _doc(request.user, document_id)
        return Response({"document_id": str(document.id), "document_title": document.title, "status": document.status,
                         "outline_source": document.outline_source, "headings": document.extracted_headings,
                         "chapters": ChapterSerializer(document.chapters.all(), many=True).data})

    def put(self, request, document_id):
        document = _doc(request.user, document_id)
        serializer = OutlineInSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        document = svc.replace_outline(request.user, document, serializer.validated_data, request)
        return Response(DocumentDetailSerializer(_doc(request.user, document_id)).data)


class ChapterEditView(APIView):
    permission_classes = [IsAdminOrFaculty]

    def patch(self, request, chapter_id):
        chapter = get_or_404(Chapter.objects.filter(document__in=_docs_for(request.user)).select_related("document__subject"), pk=chapter_id)
        serializer = ContentEditSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        chapter = svc.edit_chapter(request.user, chapter, request=request, **serializer.validated_data)
        return Response(ChapterSerializer(chapter).data)


class ChapterAvailabilityView(APIView):
    permission_classes = [IsAdminOrFaculty]

    def post(self, request, chapter_id):
        chapter = get_or_404(Chapter.objects.filter(document__in=_docs_for(request.user)).select_related("document__subject"), pk=chapter_id)
        serializer = AvailabilitySerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        modules = svc.set_chapter_availability(request.user, chapter, serializer.validated_data["availability"], request)
        return Response(ModuleSerializer(modules, many=True).data)


class ModuleEditView(APIView):
    permission_classes = [IsAdminOrFaculty]

    def get(self, request, module_id):
        module = get_or_404(Module.objects.filter(chapter__document__in=_docs_for(request.user)), pk=module_id)
        return Response(ModuleSerializer(module).data)

    def patch(self, request, module_id):
        module = get_or_404(Module.objects.filter(chapter__document__in=_docs_for(request.user)).select_related("chapter__document__subject"), pk=module_id)
        serializer = ContentEditSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        module = svc.edit_module(request.user, module, request=request, **serializer.validated_data)
        return Response(ModuleSerializer(module).data)


class ModuleAvailabilityView(APIView):
    permission_classes = [IsAdminOrFaculty]

    def post(self, request, module_id):
        module = get_or_404(Module.objects.filter(chapter__document__in=_docs_for(request.user)).select_related("chapter__document__subject"), pk=module_id)
        serializer = AvailabilitySerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        module = svc.set_module_availability(request.user, module, serializer.validated_data["availability"], request)
        return Response(ModuleSerializer(module).data)
