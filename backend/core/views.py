from django.db import connection
from rest_framework.permissions import AllowAny
from rest_framework.response import Response
from rest_framework.views import APIView

from ai import gateway as ai_gateway
from core.system_health import system_status


class HealthView(APIView):
    """Liveness plus a cached view of the AI host.

    ``status`` stays ``ok`` when the AI is not ready because the application
    keeps serving reading, quizzes and grading through its fallbacks;
    ``ai.ready`` is the field to alert on. ``?full=1`` adds the component-level
    offline-readiness report (database, storage, AI runtime, model file,
    document processing, web client, offline mode).
    """
    permission_classes = [AllowAny]
    authentication_classes = []

    def get(self, request):
        with connection.cursor() as cursor:
            cursor.execute("SELECT 1")
        ai = ai_gateway.health().as_dict()
        payload = {"status": "ok", "service": "LocalMind", "database": "ok", "ai": ai}
        if request.query_params.get("full") in ("1", "true"):
            payload["system"] = system_status()
        return Response(payload)
