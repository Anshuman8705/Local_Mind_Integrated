from datetime import timedelta

from django.test import TestCase
from django.utils import timezone

from core.testing import assign, client_for, enroll, make_faculty, make_published_document, make_student, make_subject
from learning.models import Module

from .models import Assignment


class AssignmentTests(TestCase):
    def setUp(self):
        self.faculty = make_faculty()
        self.student = make_student()
        self.outsider = make_student()
        self.subject = make_subject(code="OS")
        assign(self.faculty, self.subject)
        enroll(self.student, self.subject)
        make_published_document(self.subject)
        self.module = Module.objects.get(title="Process Management")
        self.fc = client_for(self.faculty)
        self.sc = client_for(self.student)

    def create(self, publish=True, **extra):
        res = self.fc.post("/api/faculty/assignments/", {"module_id": str(self.module.id), "title": "Essay", "max_score": 10,
                                                        "rubric": [{"criterion": "Accuracy", "points": 6}, {"criterion": "Clarity", "points": 4}], **extra}, format="json")
        self.assertEqual(res.status_code, 201, res.content)
        a = Assignment.objects.get(pk=res.data["id"])
        if publish:
            self.fc.post(f"/api/faculty/assignments/{a.id}/status/", {"status": "published"}, format="json")
            a.refresh_from_db()
        return a

    def test_rubric_must_sum_to_max_score(self):
        res = self.fc.post("/api/faculty/assignments/", {"module_id": str(self.module.id), "title": "E", "max_score": 10,
                                                        "rubric": [{"criterion": "A", "points": 3}]}, format="json")
        self.assertEqual(res.status_code, 400)

    def test_generation_falls_back_without_ai(self):
        res = self.fc.post("/api/faculty/assignments/generate/", {"module_id": str(self.module.id), "max_score": 20}, format="json")
        self.assertEqual(res.status_code, 201, res.content)
        self.assertEqual(res.data["generator"], "fallback")
        self.assertEqual(sum(r["points"] for r in res.data["rubric"]), 20)
        self.assertIn("Processes are programs", res.data["instructions"])

    def test_student_visibility_submission_and_evaluation(self):
        draft = self.create(publish=False)
        a = self.create()
        listed = self.sc.get("/api/student/assignments/").data
        self.assertEqual([x["id"] for x in listed], [str(a.id)])
        self.assertIsNone(listed[0]["my_submission"])
        res = self.sc.post(f"/api/student/assignments/{a.id}/submissions/", {"content": "My essay.", "time_spent_seconds": 999999999}, format="json")
        self.assertEqual(res.status_code, 201, res.content)
        self.assertLessEqual(res.data["time_spent_seconds"], 6 * 3600)
        self.assertFalse(res.data["is_late"])
        again = self.sc.post(f"/api/student/assignments/{a.id}/submissions/", {"content": "Again"}, format="json")
        self.assertEqual(again.status_code, 409)
        subs = self.fc.get(f"/api/faculty/assignments/{a.id}/submissions/").data["results"]
        self.assertEqual(len(subs), 1)
        ev = self.fc.post(f"/api/faculty/assignment-submissions/{subs[0]['id']}/evaluate/", {"rubric_scores": [{"criterion": "Accuracy", "points_awarded": 5}, {"criterion": "Clarity", "points_awarded": 3}], "feedback": "Good"}, format="json")
        self.assertEqual(ev.status_code, 200, ev.content)
        self.assertEqual(ev.data["score"], 8.0)
        self.assertEqual(ev.data["status"], "evaluated")
        mine = self.sc.get("/api/student/assignment-submissions/").data["results"][0]
        self.assertEqual(mine["score"], 8.0)
        self.assertEqual(mine["feedback"], "Good")
        self.assertEqual(self.sc.get("/api/student/assignments/").data[0]["my_submission"]["score"], 8.0)

    def test_late_and_locked_and_unenrolled(self):
        a = self.create(due_at=(timezone.now() - timedelta(days=1)).isoformat(), allow_late=False)
        res = self.sc.post(f"/api/student/assignments/{a.id}/submissions/", {"content": "x"}, format="json")
        self.assertEqual(res.status_code, 409)
        self.assertEqual(res.data["error"]["code"], "PAST_DUE")
        b = self.create(due_at=(timezone.now() - timedelta(days=1)).isoformat(), allow_late=True)
        self.assertTrue(self.sc.post(f"/api/student/assignments/{b.id}/submissions/", {"content": "x"}, format="json").data["is_late"])
        self.assertEqual(client_for(self.outsider).post(f"/api/student/assignments/{b.id}/submissions/", {"content": "x"}, format="json").status_code, 404)
        self.module.availability = "locked"
        self.module.save()
        self.assertEqual(self.sc.get("/api/student/assignments/").data, [])

    def test_score_bounds(self):
        a = self.create()
        sub = self.sc.post(f"/api/student/assignments/{a.id}/submissions/", {"content": "x"}, format="json").data
        res = self.fc.post(f"/api/faculty/assignment-submissions/{sub['id']}/evaluate/", {"score": 99}, format="json")
        self.assertEqual(res.status_code, 400)
