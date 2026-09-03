from datetime import timedelta
from unittest.mock import patch

from django.test import TestCase
from django.utils import timezone

from ai.gateway import AIResult
from audit.models import AuditLog
from core.testing import (
    MCQ, MCQ2, SUBJ, assign, client_for, enroll, make_faculty, make_published_document, make_student, make_subject,
)
from learning.models import Module, ModuleProgress

from .models import Assessment, AssessmentAttempt


class Base(TestCase):
    def setUp(self):
        self.faculty = make_faculty()
        self.other_faculty = make_faculty()
        self.student = make_student()
        self.other_student = make_student()
        self.subject = make_subject(code="OS")
        assign(self.faculty, self.subject)
        enroll(self.student, self.subject)
        self.doc = make_published_document(self.subject)
        self.module = Module.objects.get(title="Process Management")
        self.chapter = self.module.chapter
        self.fc = client_for(self.faculty)
        self.sc = client_for(self.student)

    def manual_quiz(self, questions=(MCQ, MCQ2), publish=True, **extra):
        res = self.fc.post("/api/faculty/quizzes/", {"module_id": str(self.module.id), "questions": list(questions), **extra}, format="json")
        self.assertEqual(res.status_code, 201, res.content)
        quiz = Assessment.objects.get(pk=res.data["id"])
        if publish:
            pub = self.fc.post(f"/api/faculty/quizzes/{quiz.id}/status/", {"status": "published"}, format="json")
            self.assertEqual(pub.status_code, 200, pub.content)
            quiz.refresh_from_db()
        return quiz

    def start(self, quiz, client=None):
        return (client or self.sc).post(f"/api/student/quizzes/{quiz.id}/attempts/")

    def submit(self, attempt_id, answers, client=None):
        return (client or self.sc).post(f"/api/student/quiz-attempts/{attempt_id}/submit/", {"submitted_answers": answers}, format="json")


class AuthoringTests(Base):
    def test_manual_creation_validates_questions(self):
        bad = self.fc.post("/api/faculty/quizzes/", {"module_id": str(self.module.id), "questions": [{"type": "mcq", "question": "x", "options": [], "correct_answer": "Z"}]}, format="json")
        self.assertEqual(bad.status_code, 400)
        self.assertEqual(bad.data["error"]["code"], "INVALID_QUESTIONS")
        quiz = self.manual_quiz(publish=False)
        self.assertEqual(quiz.kind, "module")
        self.assertEqual(quiz.generator, "manual")
        self.assertEqual(quiz.status, "draft")

    @patch("assessments.services.generation.gateway")
    def test_ai_generation_grounded_and_stored(self, gw):
        gw.return_value.generate.return_value = AIResult(ok=True, data={"mcq_questions": [
            {"question": MCQ["question"], "options": MCQ["options"], "correct_answer": "A", "explanation": "e", "source_reference": "s"}]})
        res = self.fc.post("/api/faculty/quizzes/generate/", {"module_id": str(self.module.id), "num_mcqs": 1}, format="json")
        self.assertEqual(res.status_code, 201, res.content)
        self.assertEqual(res.data["generator"], "ai")
        self.assertIsNone(res.data["generation_warning"])
        prompt = gw.return_value.generate.call_args.kwargs["user_prompt"]
        self.assertIn("Processes are programs in execution", prompt)

    def test_generation_falls_back_when_ai_unavailable_and_blocks_publish(self):
        res = self.fc.post("/api/faculty/quizzes/generate/", {"module_id": str(self.module.id), "num_mcqs": 2, "num_subjective": 1}, format="json")
        self.assertEqual(res.status_code, 201, res.content)
        self.assertEqual(res.data["generator"], "fallback")
        self.assertIn("disabled", res.data["generation_warning"])
        self.assertEqual(len(res.data["questions"]), 3)
        pub = self.fc.post(f"/api/faculty/quizzes/{res.data['id']}/status/", {"status": "published"}, format="json")
        self.assertEqual(pub.status_code, 409)
        self.assertEqual(pub.data["error"]["code"], "PLACEHOLDER_QUESTIONS")

    def test_chapter_quiz_uses_all_module_text(self):
        res = self.fc.post("/api/faculty/quizzes/", {"chapter_id": str(self.chapter.id), "questions": [MCQ]}, format="json")
        self.assertEqual(res.status_code, 201)
        self.assertEqual(res.data["kind"], "chapter")
        self.assertIsNone(res.data["module_id"])

    def test_other_faculty_cannot_author_or_see(self):
        oc = client_for(self.other_faculty)
        self.assertEqual(oc.post("/api/faculty/quizzes/", {"module_id": str(self.module.id), "questions": [MCQ]}, format="json").status_code, 404)
        quiz = self.manual_quiz()
        self.assertEqual(oc.get(f"/api/faculty/quizzes/{quiz.id}/").status_code, 404)
        self.assertEqual(len(oc.get("/api/faculty/quizzes/").data["results"]), 0)

    def test_editing_after_attempts_creates_new_version(self):
        quiz = self.manual_quiz()
        attempt_id = self.start(quiz).data["attempt_id"]
        self.submit(attempt_id, {"q1": "A", "q2": "B"})
        res = self.fc.patch(f"/api/faculty/quizzes/{quiz.id}/", {"questions": [MCQ]}, format="json")
        self.assertEqual(res.status_code, 200, res.content)
        self.assertNotEqual(res.data["id"], str(quiz.id))
        self.assertEqual(res.data["version"], 2)
        self.assertEqual(res.data["supersedes"], quiz.id)
        self.assertEqual(res.data["status"], "draft")
        quiz.refresh_from_db()
        self.assertEqual(quiz.status, "superseded")
        self.assertEqual(len(quiz.questions), 2)  # old version untouched
        old_attempt = AssessmentAttempt.objects.get(pk=attempt_id)
        self.assertEqual(old_attempt.assessment_id, quiz.id)
        self.assertEqual(len(old_attempt.detailed_results), 2)

    def test_editing_without_attempts_edits_in_place(self):
        quiz = self.manual_quiz(publish=False)
        res = self.fc.patch(f"/api/faculty/quizzes/{quiz.id}/", {"questions": [MCQ], "title": "Renamed"}, format="json")
        self.assertEqual(res.data["id"], str(quiz.id))
        self.assertEqual(res.data["title"], "Renamed")
        self.assertEqual(res.data["question_count"], 1)


class AttemptTests(Base):
    def test_student_only_sees_published_quizzes_on_open_modules(self):
        draft = self.manual_quiz(publish=False)
        quiz = self.manual_quiz()
        ids = {q["id"] for q in self.sc.get("/api/student/quizzes/").data}
        self.assertEqual(ids, {str(quiz.id)})
        self.module.availability = "locked"
        self.module.save()
        self.assertEqual(self.sc.get("/api/student/quizzes/").data, [])
        self.assertEqual(self.start(quiz).status_code, 404)

    def test_publishing_a_quiz_opens_its_locked_module(self):
        self.module.availability = "locked"
        self.module.save()
        draft = self.manual_quiz(publish=False)
        self.assertEqual(self.sc.get("/api/student/quizzes/").data, [])
        res = self.fc.post(f"/api/faculty/quizzes/{draft.id}/status/", {"status": "published"}, format="json")
        self.assertEqual(res.status_code, 200, res.content)
        self.module.refresh_from_db()
        self.assertEqual(self.module.availability, "open")
        self.assertEqual([q["id"] for q in self.sc.get("/api/student/quizzes/").data], [str(draft.id)])

    def test_start_hides_answers_and_submit_scores_deterministically(self):
        quiz = self.manual_quiz()
        res = self.start(quiz)
        self.assertEqual(res.status_code, 201, res.content)
        for q in res.data["questions"]:
            self.assertNotIn("correct_answer", q)
            self.assertNotIn("explanation", q)
        attempt_id = res.data["attempt_id"]
        res = self.submit(attempt_id, {"q1": "a", "q2": "C"})
        self.assertEqual(res.status_code, 200, res.content)
        self.assertEqual(res.data["score"], 1.0)
        self.assertEqual(res.data["percentage"], 50.0)
        self.assertFalse(res.data["passed"])
        self.assertEqual(res.data["status"], "evaluated")
        self.assertEqual(res.data["detailed_results"][0]["is_correct"], True)
        self.assertEqual(res.data["detailed_results"][1]["correct_option"], "B")
        self.assertIsNotNone(res.data["time_taken_seconds"])
        progress = ModuleProgress.objects.get(student=self.student, module=self.module)
        self.assertEqual(progress.status, "needs_review")
        self.assertEqual(progress.best_quiz_percentage, 50.0)

    def test_pass_completes_module_and_time_is_server_computed(self):
        quiz = self.manual_quiz()
        attempt_id = self.start(quiz).data["attempt_id"]
        AssessmentAttempt.objects.filter(pk=attempt_id).update(started_at=timezone.now() - timedelta(seconds=90))
        res = self.submit(attempt_id, {"q1": "A", "q2": "B", "time_taken_seconds": "1"})
        self.assertTrue(res.data["passed"])
        self.assertGreaterEqual(res.data["time_taken_seconds"], 90)
        self.assertEqual(ModuleProgress.objects.get(student=self.student, module=self.module).status, "completed")

    def test_resubmission_rejected_and_attempts_are_immutable(self):
        quiz = self.manual_quiz()
        attempt_id = self.start(quiz).data["attempt_id"]
        self.submit(attempt_id, {"q1": "A"})
        res = self.submit(attempt_id, {"q1": "B"})
        self.assertEqual(res.status_code, 409)
        self.assertEqual(res.data["error"]["code"], "ALREADY_SUBMITTED")

    def test_max_attempts_and_attempt_numbering(self):
        quiz = self.manual_quiz(max_attempts=2)
        a1 = self.start(quiz).data
        self.assertEqual(a1["attempt_number"], 1)
        again = self.start(quiz)
        self.assertEqual(again.status_code, 200)
        self.assertTrue(again.data["resumed"])
        self.submit(a1["attempt_id"], {"q1": "A"})
        a2 = self.start(quiz).data
        self.assertEqual(a2["attempt_number"], 2)
        self.submit(a2["attempt_id"], {"q1": "A"})
        res = self.start(quiz)
        self.assertEqual(res.status_code, 409)
        self.assertEqual(res.data["error"]["code"], "MAX_ATTEMPTS_REACHED")
        self.assertEqual(AssessmentAttempt.objects.filter(student=self.student, assessment=quiz).count(), 2)

    def test_due_date_enforced(self):
        quiz = self.manual_quiz(due_at=(timezone.now() - timedelta(hours=1)).isoformat())
        res = self.start(quiz)
        self.assertEqual(res.status_code, 409)
        self.assertEqual(res.data["error"]["code"], "QUIZ_CLOSED")

    def test_other_student_cannot_see_or_submit_attempt(self):
        quiz = self.manual_quiz()
        attempt_id = self.start(quiz).data["attempt_id"]
        oc = client_for(self.other_student)
        self.assertEqual(oc.get(f"/api/student/quiz-attempts/{attempt_id}/").status_code, 404)
        self.assertEqual(self.submit(attempt_id, {"q1": "A"}, client=oc).status_code, 404)
        self.assertEqual(self.start(quiz, client=oc).status_code, 404)  # not enrolled

    def test_subjective_pending_when_ai_down_then_faculty_reevaluates(self):
        quiz = self.manual_quiz(questions=(MCQ, SUBJ))
        attempt_id = self.start(quiz).data["attempt_id"]
        res = self.submit(attempt_id, {"q1": "A", "q2": "A process is a program in execution."})
        self.assertEqual(res.data["status"], "pending_evaluation")
        self.assertIsNone(res.data["percentage"])
        self.assertEqual(res.data["detailed_results"][1]["evaluation_status"], "pending")
        with patch("assessments.services.assessments.evaluate_subjective", return_value=({"is_correct": True, "score_awarded": 1.0, "feedback": "Good", "missing_points": [], "evaluator": "test"}, True)):
            res = self.fc.post(f"/api/faculty/quiz-attempts/{attempt_id}/re-evaluate/", {}, format="json")
        self.assertEqual(res.status_code, 200, res.content)
        self.assertEqual(res.data["status"], "evaluated")
        self.assertEqual(res.data["percentage"], 100.0)
        self.assertTrue(res.data["passed"])

    def test_faculty_override_score(self):
        quiz = self.manual_quiz(questions=(MCQ, SUBJ))
        attempt_id = self.start(quiz).data["attempt_id"]
        self.submit(attempt_id, {"q1": "B", "q2": "blank-ish"})
        res = self.fc.post(f"/api/faculty/quiz-attempts/{attempt_id}/re-evaluate/", {"overrides": {"q2": {"score_awarded": 1, "feedback": "Accepted"}}}, format="json")
        self.assertEqual(res.data["status"], "evaluated")
        self.assertEqual(res.data["percentage"], 50.0)
        self.assertEqual(res.data["detailed_results"][1]["evaluator"], f"faculty:{self.faculty.email}")
        self.assertTrue(AuditLog.objects.filter(action="quiz.attempt_reevaluated").exists())

    def test_faculty_sees_attempts_and_student_sees_scores(self):
        quiz = self.manual_quiz()
        attempt_id = self.start(quiz).data["attempt_id"]
        self.submit(attempt_id, {"q1": "A", "q2": "B"})
        res = self.fc.get(f"/api/faculty/quizzes/{quiz.id}/attempts/")
        self.assertEqual(len(res.data["results"]), 1)
        self.assertEqual(res.data["results"][0]["student_email"], self.student.email)
        scores = self.sc.get("/api/student/scores/").data["results"]
        self.assertEqual(scores[0]["percentage"], 100.0)
        listing = self.sc.get("/api/student/quizzes/").data[0]
        self.assertEqual(listing["best_percentage"], 100.0)
        self.assertEqual(listing["attempts_used"], 1)


class GenerationRulesTests(TestCase):
    def test_duplicate_option_texts_are_rejected(self):
        from assessments.services.generation import normalize_questions
        from core.exceptions import ValidationFailed
        q = {"type": "mcq", "question": "Q?", "options": [{"key": k, "text": "same"} for k in "ABCD"], "correct_answer": "A"}
        with self.assertRaises(ValidationFailed) as ctx:
            normalize_questions([q])
        self.assertIn("distinct", str(ctx.exception.details))

    def test_fallback_is_deterministic_across_calls(self):
        from assessments.services.generation import fallback_questions
        text = "Processes are programs in execution. Threads share the address space of their process. Scheduling decides which runs next."
        self.assertEqual(fallback_questions(text, "T", 2, 1), fallback_questions(text, "T", 2, 1))

    @patch("assessments.services.generation.gateway")
    def test_ai_questions_repeating_previous_quiz_are_dropped(self, gw):
        from assessments.services.generation import generate_questions
        mk = lambda text: {"question": text, "options": [{"key": k, "text": f"opt {k}"} for k in "ABCD"], "correct_answer": "B", "explanation": "e", "source_reference": "s"}
        gw.return_value.generate.return_value = AIResult(ok=True, data={"mcq_questions": [mk("What is a process?"), mk("What is a thread?")]})
        questions, generator, note = generate_questions("Processes are programs in execution.", "T", num_mcqs=2, previous_questions=["what is a process?"])
        self.assertEqual(generator, "ai")
        self.assertEqual([q["question"] for q in questions], ["What is a thread?"])
        self.assertEqual(questions[0]["id"], "q1")
        self.assertIn("repeated", note)

    @patch("assessments.services.generation.gateway")
    def test_ai_output_that_only_repeats_falls_back(self, gw):
        from assessments.services.generation import generate_questions
        mk = lambda text: {"question": text, "options": [{"key": k, "text": f"opt {k}"} for k in "ABCD"], "correct_answer": "B", "explanation": "e", "source_reference": "s"}
        gw.return_value.generate.return_value = AIResult(ok=True, data={"mcq_questions": [mk("What is a process?")]})
        _, generator, note = generate_questions("Processes are programs in execution. " * 3, "T", num_mcqs=1, previous_questions=["What is a process?"])
        self.assertEqual(generator, "fallback")
        self.assertIn("repeated", note)

    @patch("assessments.services.evaluation.gateway")
    def test_evaluator_marks_incorrect_when_model_lists_missing_points(self, gw):
        from assessments.services.evaluation import evaluate_subjective
        gw.return_value.generate.return_value = AIResult(ok=True, provider="ollama", model="qwen3:1.7b", data={
            "is_correct": True, "score_awarded": 1, "feedback": "Nearly.", "missing_points": ["did not mention scheduling"]})
        result, ok = evaluate_subjective("src", "Q", "rubric", "an answer")
        self.assertTrue(ok)
        self.assertFalse(result["is_correct"])
        self.assertEqual(result["score_awarded"], 0.0)
        self.assertEqual(result["evaluator"], "ollama:qwen3:1.7b")
