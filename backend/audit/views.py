from rest_framework.generics import ListAPIView

from core.permissions import IsAdmin
from .models import AuditLog
from .serializers import AuditLogSerializer


class AuditLogListView(ListAPIView):
    permission_classes = [IsAdmin]
    serializer_class = AuditLogSerializer

    def get_queryset(self):
        qs = AuditLog.objects.select_related("actor")
        params = self.request.query_params
        if params.get("action"):
            qs = qs.filter(action=params["action"])
        if params.get("target_type"):
            qs = qs.filter(target_type=params["target_type"])
        if params.get("target_id"):
            qs = qs.filter(target_id=params["target_id"])
        if params.get("actor"):
            qs = qs.filter(actor_id=params["actor"])
        if params.get("actor_email"):
            qs = qs.filter(actor_email__icontains=params["actor_email"])
        if params.get("since"):
            qs = qs.filter(created_at__gte=params["since"])
        if params.get("until"):
            qs = qs.filter(created_at__lte=params["until"])
        return qs
