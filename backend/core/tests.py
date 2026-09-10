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
from django.test import TestCase, TransactionTestCase

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

    def test_background_lesson_generation(self):
        from tutor import lessons
        lessons.request_lessons([self.module])
        with patch("tutor.lessons.gateway") as gw:
            gw.return_value.generate.side_effect = _no_transaction_open
            lessons.run_pending(wait_for_students=False)
        self.assertEqual(gw.return_value.generate.call_count, 1)
        # Reading the lesson never calls the model at all.
        with patch("tutor.lessons.gateway") as gw:
            res = self.sc.post(f"/api/student/modules/{self.module.id}/teach/")
        self.assertEqual(res.status_code, 200, res.content)
        gw.assert_not_called()

    def test_quiz_generation(self):
        def answer(**kwargs):
            assert not connection.in_atomic_block, "model called with a database transaction open"
            return AIResult(ok=True, data={"mcq_questions": [{
                "question": "What does the scheduler pick next?", "options": ["The next process", "A file", "A frame", "A segment"],
                "answer": "A", "explanation": "It picks a process.", "quote": "The scheduler picks"}]})
        with patch("assessments.services.generation.gateway") as gw:
            gw.return_value.generate.side_effect = answer
            res = self.fc.post("/api/faculty/quizzes/generate/", {"module_id": str(self.module.id), "num_mcqs": 1}, format="json")
        self.assertEqual(res.status_code, 201, res.content)
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


class MetaChoicesTests(TestCase):
    """The client builds its filters from this, so it has to stay in step with
    the models rather than with a list someone typed into a screen."""

    def test_choices_come_from_the_models_and_hide_retired_states(self):
        from core.testing import make_admin

        res = client_for(make_admin()).get("/api/meta/choices/")

        self.assertEqual(res.status_code, 200, res.content)
        subject = [c["value"] for c in res.data["subject_status"]]
        self.assertIn("active", subject)
        self.assertIn("discontinued", subject)
        self.assertNotIn("archived", subject)  # subjects are deleted, not archived
        self.assertNotIn("archived", [c["value"] for c in res.data["document_status"]])
        self.assertNotIn("superseded", [c["value"] for c in res.data["quiz_status"]])
        self.assertNotIn("discontinued", [c["value"] for c in res.data["account_status"]])
        # Labels are Django's own, not something the client invents.
        self.assertEqual(
            [c["label"] for c in res.data["subject_status"] if c["value"] == "active"], ["Active"],
        )

    def test_choices_need_authentication(self):
        self.assertIn(client_for().get("/api/meta/choices/").status_code, (401, 403))


from django.test import override_settings as _override_settings


class HealthDisclosureTests(TestCase):
    """The public health check says whether the platform and its AI are up.
    Paths, model files, provider URLs and the component table are for
    administrators and for requests from the server itself."""

    PRIVATE_KEYS = {"details", "error", "tutor_model", "outline_model"}

    def _get(self, url, client=None, remote="203.0.113.9"):
        from core.testing import client_for
        return (client or client_for()).get(url, REMOTE_ADDR=remote)

    def test_remote_anonymous_gets_the_summary_only(self):
        res = self._get("/api/health/?full=1")
        self.assertEqual(res.status_code, 200)
        self.assertEqual(res.data["status"], "ok")
        self.assertIn("ready", res.data["ai"])
        self.assertFalse(self.PRIVATE_KEYS & set(res.data["ai"]))
        self.assertNotIn("system", res.data)

    def test_forged_forwarded_for_does_not_pass_as_loopback(self):
        from core.testing import client_for
        res = client_for().get("/api/health/?full=1", REMOTE_ADDR="203.0.113.9", HTTP_X_FORWARDED_FOR="127.0.0.1")
        self.assertNotIn("system", res.data)

    def test_admin_and_loopback_get_the_component_report(self):
        from core.testing import client_for, make_admin
        self.assertIn("system", self._get("/api/health/?full=1", client=client_for(make_admin())).data)
        self.assertIn("system", self._get("/api/health/?full=1", remote="127.0.0.1").data)

    def test_a_student_token_is_not_enough(self):
        from core.testing import client_for, make_student
        res = self._get("/api/health/?full=1", client=client_for(make_student()))
        self.assertNotIn("system", res.data)


class ApiDocsGateTests(TestCase):
    def test_docs_off_when_disabled(self):
        import importlib

        from django.urls import clear_url_caches

        import config.urls
        try:
            with _override_settings(API_DOCS_ENABLED=False, SERVE_WEB=False):
                clear_url_caches()
                importlib.reload(config.urls)
                self.assertEqual(self.client.get("/api/schema/").status_code, 404)
                self.assertEqual(self.client.get("/api/docs/").status_code, 404)
        finally:
            clear_url_caches()
            importlib.reload(config.urls)

    def test_docs_on_in_development(self):
        self.assertEqual(self.client.get("/api/schema/").status_code, 200)


class WebappPathTests(TestCase):
    def test_sibling_directory_with_the_same_prefix_is_not_served(self):
        import tempfile
        from pathlib import Path

        from core.webapp import _resolve
        with tempfile.TemporaryDirectory() as tmp:
            root, sibling = Path(tmp) / "dist", Path(tmp) / "dist-old"
            root.mkdir(); sibling.mkdir()
            (root / "index.html").write_text("ok")
            (sibling / "secret.txt").write_text("no")
            with _override_settings(WEB_DIST=root):
                self.assertIsNotNone(_resolve("index.html"))
                self.assertIsNone(_resolve("../dist-old/secret.txt"))


class DotenvParsingTests(TestCase):
    def test_inline_comments_and_quotes(self):
        from config.env import _clean_value
        self.assertEqual(_clean_value("true            # master switch"), "true")
        self.assertEqual(_clean_value("Welcome@LocalMind1"), "Welcome@LocalMind1")
        self.assertEqual(_clean_value("pa#ss"), "pa#ss")
        self.assertEqual(_clean_value('"has # inside"'), "has # inside")
        self.assertEqual(_clean_value("  60  "), "60")
