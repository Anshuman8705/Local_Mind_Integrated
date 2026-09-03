"""Regression tests for the SQLite "database is locked" fix.

Every code path that calls the language model must do so with no transaction
open. A transaction held across a 30-120 second model call keeps the SQLite
write lock and every other request that needs to write fails. These tests
use TransactionTestCase so ``connection.in_atomic_block`` reflects what the
service code does rather than the test wrapper.
"""
from unittest.mock import patch

from django.conf import settings
from django.db import connection
from django.test import TransactionTestCase

from ai.gateway import AIResult
from assessments.models import AssessmentAttempt, AttemptStatus
from core.testing import MCQ, SUBJ, assign, client_for, enroll, make_faculty, make_published_document, make_student, make_subject
from learning.models import Module


def _no_transaction_open(**kwargs):
    assert not connection.in_atomic_block, "model called with a database transaction open"
    return AIResult(ok=False, error_code="disabled", error="disabled")


class NoTransactionDuringModelCallTests(TransactionTestCase):
    def setUp(self):
        self.faculty = make_faculty()
        self.student = make_student()
        self.subject = make_subject(code="OS")
        assign(self.faculty, self.subject)
        enroll(self.student, self.subject)
        make_published_document(self.subject)
        self.module = Module.objects.get(title="Process Management")
        self.fc = client_for(self.faculty)
        self.sc = client_for(self.student)

    def test_teach(self):
        with patch("tutor.services.gateway") as gw:
            gw.return_value.generate.side_effect = _no_transaction_open
            res = self.sc.post(f"/api/student/modules/{self.module.id}/teach/")
        self.assertEqual(res.status_code, 200, res.content)
        self.assertEqual(gw.return_value.generate.call_count, 1)

    def test_quiz_generation(self):
        with patch("assessments.services.generation.gateway") as gw:
            gw.return_value.generate.side_effect = _no_transaction_open
            res = self.fc.post("/api/faculty/quizzes/generate/", {"module_id": str(self.module.id), "num_mcqs": 2}, format="json")
        self.assertIn(res.status_code, (200, 201), res.content)
        self.assertEqual(gw.return_value.generate.call_count, 1)

    def test_assignment_generation(self):
        with patch("assignments.services.gateway") as gw:
            gw.return_value.generate.side_effect = _no_transaction_open
            res = self.fc.post("/api/faculty/assignments/generate/", {"module_id": str(self.module.id)}, format="json")
        self.assertIn(res.status_code, (200, 201), res.content)
        self.assertEqual(gw.return_value.generate.call_count, 1)

    def test_submit_and_reevaluate_with_subjective_grading(self):
        res = self.fc.post("/api/faculty/quizzes/", {"module_id": str(self.module.id), "title": "Q", "questions": [MCQ, SUBJ]}, format="json")
        self.assertIn(res.status_code, (200, 201), res.content)
        quiz_id = res.data["id"]
        self.assertEqual(self.fc.post(f"/api/faculty/quizzes/{quiz_id}/status/", {"status": "published"}, format="json").status_code, 200)
        attempt_id = self.sc.post(f"/api/student/quizzes/{quiz_id}/attempts/").data["attempt_id"]
        with patch("assessments.services.evaluation.gateway") as gw:
            gw.return_value.generate.side_effect = _no_transaction_open
            res = self.sc.post(f"/api/student/quiz-attempts/{attempt_id}/submit/",
                               {"submitted_answers": {"q1": "A", "q2": "A program in execution."}}, format="json")
        self.assertEqual(res.status_code, 200, res.content)
        self.assertEqual(res.data["status"], AttemptStatus.PENDING_EVALUATION)
        self.assertEqual(gw.return_value.generate.call_count, 1)
        # A second submit of the same attempt is rejected.
        res = self.sc.post(f"/api/student/quiz-attempts/{attempt_id}/submit/", {"submitted_answers": {"q1": "A"}}, format="json")
        self.assertEqual(res.status_code, 409, res.content)
        with patch("assessments.services.evaluation.gateway") as gw:
            gw.return_value.generate.side_effect = _no_transaction_open
            res = self.fc.post(f"/api/faculty/quiz-attempts/{attempt_id}/re-evaluate/", {}, format="json")
        self.assertEqual(res.status_code, 200, res.content)
        self.assertEqual(gw.return_value.generate.call_count, 1)
        self.assertEqual(AssessmentAttempt.objects.get(pk=attempt_id).status, AttemptStatus.PENDING_EVALUATION)


class SqliteConfigurationTests(TransactionTestCase):
    def test_sqlite_options_are_set_for_concurrency(self):
        if connection.vendor != "sqlite":
            self.skipTest("sqlite only")
        opts = settings.DATABASES["default"]["OPTIONS"]
        self.assertEqual(opts["transaction_mode"], "IMMEDIATE")
        self.assertGreaterEqual(opts["timeout"], 5)
        with connection.cursor() as c:
            # Django's test database for sqlite is in-memory, where the journal
            # mode is always "memory"; the busy timeout must still be applied.
            c.execute("PRAGMA busy_timeout")
            self.assertGreaterEqual(c.fetchone()[0], 5000)
