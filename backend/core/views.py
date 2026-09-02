from django.db import connection
from rest_framework.permissions import AllowAny
from rest_framework.response import Response
from rest_framework.views import APIView

from ai import gateway as ai_gateway


class HealthView(APIView):
    """Liveness plus a cached view of the AI host.

    ``status`` stays ``ok`` when Ollama is down because the application keeps
    serving reading, quizzes and grading through its fallbacks; ``ai.ready``
    is the field to alert on.
    """
    permission_classes = [AllowAny]
    authentication_classes = []

    def get(self, request):
        with connection.cursor() as cursor:
            cursor.execute("SELECT 1")
        ai = ai_gateway.health().as_dict()
        return Response({"status": "ok", "service": "LocalMind", "database": "ok", "ai": ai})
