from rest_framework.response import Response
from rest_framework.views import APIView

from core.permissions import IsStudent
from learning import services as learning

from . import services as svc


class HeartbeatView(APIView):
    """Keeps the application session alive. Allowed before password change so
    the onboarding screen still counts as a session."""

    allow_password_change = True

    def post(self, request):
        session = svc.heartbeat(request.user, request.data.get("session_id"))
        return Response({"session_id": str(session.id), "last_heartbeat_at": session.last_heartbeat_at})


class ModuleTimeView(APIView):
    permission_classes = [IsStudent]

    def post(self, request, module_id):
        module = learning.resolve_accessible_module(request.user, module_id)
        total = svc.record_learning_time(request.user, module, request.data.get("seconds", 0))
        return Response({"module_id": str(module.id), "learning_seconds": total})
