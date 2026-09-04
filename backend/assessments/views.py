from rest_framework import status
from rest_framework.generics import ListAPIView
from rest_framework.response import Response
from rest_framework.views import APIView

from core.permissions import IsAdminOrFaculty, IsStudent
from core.utils import get_or_404

from .models import AssessmentAttempt, AttemptStatus
from .serializers import (
    AssessmentSerializer, AssessmentStudentSerializer, AttemptSerializer, CreateManualSerializer, GenerateSerializer,
    ReEvaluateSerializer, StatusSerializer, SubmitSerializer, UpdateSerializer,
)
from .services import assessments as svc


# ---------- faculty / admin ----------

class QuizListCreateView(ListAPIView):
    permission_classes = [IsAdminOrFaculty]
    serializer_class = AssessmentSerializer

    def get_queryset(self):
        qs = svc.manageable(self.request.user)
        p = self.request.query_params
        for key in ("subject", "module", "chapter", "status", "kind"):
            if p.get(key):
                qs = qs.filter(**{f"{key}_id" if key in ("subject", "module", "chapter") else key: p[key]})
        return qs

    def post(self, request):
        s = CreateManualSerializer(data=request.data)
        s.is_valid(raise_exception=True)
        a = svc.create_manual(request.user, request=request, **s.validated_data)
        return Response(AssessmentSerializer(a).data, status=status.HTTP_201_CREATED)


class QuizGenerateView(APIView):
    permission_classes = [IsAdminOrFaculty]
    throttle_scope = "ai"

    def post(self, request):
        s = GenerateSerializer(data=request.data)
        s.is_valid(raise_exception=True)
        a, error = svc.generate(request.user, request=request, **s.validated_data)
        data = AssessmentSerializer(a).data
        data["generation_warning"] = error or None
        return Response(data, status=status.HTTP_201_CREATED)


class QuizDetailView(APIView):
    permission_classes = [IsAdminOrFaculty]

    def get(self, request, quiz_id):
        return Response(AssessmentSerializer(get_or_404(svc.manageable(request.user), pk=quiz_id)).data)

    def patch(self, request, quiz_id):
        a = get_or_404(svc.manageable(request.user), pk=quiz_id)
        s = UpdateSerializer(data=request.data, partial=True)
        s.is_valid(raise_exception=True)
        a = svc.update(request.user, a, request=request, **s.validated_data)
        return Response(AssessmentSerializer(a).data)

    def delete(self, request, quiz_id):
        a = get_or_404(svc.manageable(request.user), pk=quiz_id)
        label = svc.delete(request.user, a, request)
        return Response({"detail": f"{label} was deleted."})


class QuizStatusView(APIView):
    permission_classes = [IsAdminOrFaculty]

    def post(self, request, quiz_id):
        a = get_or_404(svc.manageable(request.user), pk=quiz_id)
        s = StatusSerializer(data=request.data)
        s.is_valid(raise_exception=True)
        return Response(AssessmentSerializer(svc.set_status(request.user, a, s.validated_data["status"], request)).data)


class QuizAttemptsView(ListAPIView):
    permission_classes = [IsAdminOrFaculty]
    serializer_class = AttemptSerializer

    def get_queryset(self):
        a = get_or_404(svc.manageable(self.request.user), pk=self.kwargs["quiz_id"])
        qs = a.attempts.select_related("student", "assessment").exclude(status=AttemptStatus.IN_PROGRESS)
        if self.request.query_params.get("student"):
            qs = qs.filter(student_id=self.request.query_params["student"])
        return qs


class AttemptReEvaluateView(APIView):
    permission_classes = [IsAdminOrFaculty]

    def post(self, request, attempt_id):
        attempt = get_or_404(AssessmentAttempt.objects.filter(assessment__in=svc.manageable(request.user)).select_related("assessment__subject", "assessment__module", "assessment__chapter", "student"), pk=attempt_id)
        s = ReEvaluateSerializer(data=request.data)
        s.is_valid(raise_exception=True)
        return Response(AttemptSerializer(svc.re_evaluate(request.user, attempt, s.validated_data.get("overrides"), request)).data)


# ---------- student ----------

class StudentQuizListView(APIView):
    permission_classes = [IsStudent]

    def get(self, request):
        qs = svc.student_visible(request.user)
        if request.query_params.get("module"):
            qs = qs.filter(module_id=request.query_params["module"])
        if request.query_params.get("subject"):
            qs = qs.filter(subject_id=request.query_params["subject"])
        attempts = AssessmentAttempt.objects.filter(student=request.user, assessment__in=qs).exclude(status=AttemptStatus.IN_PROGRESS)
        best = {}
        for at in attempts:
            cur = best.get(at.assessment_id)
            if cur is None or (at.percentage or 0) > (cur["best_percentage"] or 0):
                best[at.assessment_id] = {"best_percentage": at.percentage, "passed": at.passed}
            best[at.assessment_id]["attempts_used"] = best[at.assessment_id].get("attempts_used", 0) + 1
        out = []
        for a in qs:
            row = AssessmentStudentSerializer(a).data
            row.update(best.get(a.id, {"best_percentage": None, "passed": None, "attempts_used": 0}))
            out.append(row)
        return Response(out)


class StudentStartAttemptView(APIView):
    permission_classes = [IsStudent]

    def post(self, request, quiz_id):
        attempt, created = svc.start_attempt(request.user, quiz_id, request)
        return Response({"attempt_id": str(attempt.id), "attempt_number": attempt.attempt_number, "started_at": attempt.started_at,
                         "resumed": not created, "time_limit_minutes": attempt.assessment.time_limit_minutes,
                         "quiz": AssessmentStudentSerializer(attempt.assessment).data,
                         "questions": svc.student_questions(attempt.assessment)},
                        status=status.HTTP_201_CREATED if created else status.HTTP_200_OK)


class StudentSubmitAttemptView(APIView):
    permission_classes = [IsStudent]

    def post(self, request, attempt_id):
        s = SubmitSerializer(data=request.data)
        s.is_valid(raise_exception=True)
        attempt = svc.submit_attempt(request.user, attempt_id, s.validated_data["submitted_answers"], request)
        return Response(AttemptSerializer(attempt).data)


class StudentAttemptView(APIView):
    permission_classes = [IsStudent]

    def get(self, request, attempt_id):
        attempt = get_or_404(AssessmentAttempt.objects.filter(student=request.user).select_related("assessment", "student"), pk=attempt_id)
        return Response(AttemptSerializer(attempt).data)


class StudentScoresView(ListAPIView):
    permission_classes = [IsStudent]
    serializer_class = AttemptSerializer

    def get_queryset(self):
        qs = AssessmentAttempt.objects.filter(student=self.request.user).exclude(status=AttemptStatus.IN_PROGRESS).select_related("assessment", "student")
        if self.request.query_params.get("subject"):
            qs = qs.filter(assessment__subject_id=self.request.query_params["subject"])
        return qs
