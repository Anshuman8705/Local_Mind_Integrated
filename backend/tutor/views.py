from rest_framework import status
from rest_framework.response import Response
from rest_framework.views import APIView

from core.permissions import IsStudent
from core.utils import get_or_404

from . import services as svc
from .models import Message


def _msg(m):
    return {"id": str(m.id), "role": m.role, "content": m.content, "grounded": m.grounded, "source_reference": m.source_reference,
            "created_at": m.created_at}


class TeachView(APIView):
    permission_classes = [IsStudent]
    throttle_scope = "ai"

    def post(self, request, module_id):
        lesson, meta = svc.teach(request.user, module_id, request)
        return Response({"module_id": str(module_id), "lesson": lesson, **meta})


class AskView(APIView):
    permission_classes = [IsStudent]
    throttle_scope = "ai"

    def post(self, request, module_id):
        conv, msg, suggestions = svc.ask(request.user, module_id, request.data.get("question"), request.data.get("conversation_id"), request)
        return Response({"conversation_id": str(conv.id), "message": _msg(msg), "follow_up_suggestions": suggestions}, status=status.HTTP_201_CREATED)


class ConversationListView(APIView):
    permission_classes = [IsStudent]

    def get(self, request):
        rows = svc.conversations(request.user, request.query_params.get("module"))
        return Response([{"id": str(c.id), "module_id": str(c.module_id), "module_title": c.module.title, "title": c.title,
                          "last_message_at": c.last_message_at, "created_at": c.created_at} for c in rows])


class ConversationDetailView(APIView):
    permission_classes = [IsStudent]

    def get(self, request, conversation_id):
        conv = svc.get_conversation(request.user, conversation_id)
        return Response({"id": str(conv.id), "module_id": str(conv.module_id), "title": conv.title,
                         "messages": [_msg(m) for m in conv.messages.all()]})


class RemediationView(APIView):
    permission_classes = [IsStudent]
    throttle_scope = "ai"

    def post(self, request, attempt_id):
        return Response(svc.remediation(request.user, attempt_id, request))
