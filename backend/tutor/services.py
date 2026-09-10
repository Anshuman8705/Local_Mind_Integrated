"""Tutor: teach, ask, remediate — all grounded in server-resolved module text."""
import hashlib
import logging
import re
import time

from django.core.cache import cache
from django.utils import timezone

from ai.config import history_messages, task_config
from ai.gateway import gateway, trim_source
from documents.services import retrieval
from assessments.models import AssessmentAttempt, AttemptStatus
from audit import services as audit
from core.exceptions import AIUnavailable, Forbidden, NotFound, ValidationFailed
from learning import services as learning

from . import lessons
from .models import Conversation, Message

logger = logging.getLogger("localmind.tutor")

ANSWER_SCHEMA = {"type": "object", "properties": {
    "answer": {"type": "string"}, "grounded": {"type": "boolean"}, "source_reference": {"type": "string"},
    "follow_up_suggestions": {"type": "array", "maxItems": 3, "items": {"type": "string"}}},
    "required": ["answer", "grounded", "source_reference", "follow_up_suggestions"]}

REMEDIATION_SCHEMA = {"type": "object", "properties": {
    "overview": {"type": "string"},
    "items": {"type": "array", "items": {"type": "object", "properties": {
        "question": {"type": "string"}, "misconception": {"type": "string"}, "explanation": {"type": "string"}, "source_reference": {"type": "string"}},
        "required": ["question", "misconception", "explanation", "source_reference"]}}},
    "required": ["overview", "items"]}

GROUNDING = (
    "You are a tutor for one module of a textbook. Follow every rule.\n"
    "1. Use only the SOURCE TEXT. Do not add facts, dates, names or examples that are not in it.\n"
    "2. When the source does not cover something, say so plainly instead of guessing.\n"
    "3. Every source_reference is a short phrase copied from the SOURCE TEXT.\n"
    "4. Write in plain, simple English for a first-time learner.\n"
    "5. Output JSON only.\n"
)


# Small models sometimes write the schema field into the prose they return.
# Nothing downstream should ever show a student "grounded=false".
_LEAKED_FLAG = re.compile(r"\s*\b(grounded|source_reference)\s*[=:]\s*[\"']?(true|false)[\"']?\.?", re.IGNORECASE)


def _clean_answer(text) -> str:
    return _LEAKED_FLAG.sub("", str(text or "")).strip()


# An identical opening question is common on a shared module. The key carries
# the document's content version, so an edit to the book retires every cached
# answer for it without anything having to clear the cache.
ASK_CACHE_SECONDS = 24 * 60 * 60


def _ask_cache_key(module, question: str) -> str:
    version = module.chapter.document.content_version
    digest = hashlib.sha256(" ".join(question.split()).casefold().encode()).hexdigest()[:32]
    return f"tutor.ask:{module.id}:{version}:{digest}"


def _module(student, module_id):
    return learning.resolve_accessible_module(student, module_id)


def teach(student, module_id, request=None, legacy=False):
    """The Lesson tab. Reads the lesson generated in the background; never
    calls the model, so it answers in milliseconds whatever the queue is doing.
    See tutor/lessons.py for how lessons are produced.

    ``legacy`` is for clients built before background lessons (they POST and
    read ``lesson.title`` unconditionally, so a null lesson crashed their
    Lesson tab to a blank page). They get the plain lesson from the text while
    the tutor's lesson is being prepared; current clients GET and are told the
    lesson is on its way."""
    module = _module(student, module_id)
    data = lessons.lesson_for_student(module)
    if legacy and data.get("lesson") is None:
        data = {**data, "lesson": lessons.fallback_lesson(module), "generator": "fallback"}
    return data


def conversations(student, module_id=None):
    qs = Conversation.objects.filter(student=student).select_related("module")
    if module_id:
        qs = qs.filter(module_id=module_id)
    return qs


def get_conversation(student, conversation_id):
    try:
        return Conversation.objects.select_related("module__chapter__document").get(pk=conversation_id, student=student)
    except (Conversation.DoesNotExist, ValueError):
        raise NotFound("Conversation not found.")


def ask(student, module_id, question, conversation_id=None, request=None):
    """Not wrapped in a transaction on purpose: the student's question must
    survive even when the model call fails."""
    module = _module(student, module_id)
    question = (question or "").strip()
    if not question:
        raise ValidationFailed(details={"question": "A question is required."})
    if len(question) > 2000:
        raise ValidationFailed(details={"question": "Questions are limited to 2000 characters."})
    if conversation_id:
        conv = get_conversation(student, conversation_id)
        if conv.module_id != module.id:
            raise ValidationFailed("Conversation belongs to a different module.", code="CONVERSATION_MISMATCH")
    else:
        conv = Conversation.objects.create(student=student, module=module, title=question[:200])

    # Only the last few turns go into the prompt. The conversation keeps every
    # message; a long thread used to grow the prompt without bound.
    history = list(conv.messages.order_by("-created_at")[:history_messages()])[::-1]
    history_text = "\n".join(f"{m.role.upper()}: {m.content[:600]}" for m in history) or "(none)"
    Message.objects.create(conversation=conv, role="user", content=question)

    # The passages that answer this question, not the whole module. A long
    # module put 14,000 characters into every prompt regardless of what was
    # asked, which is most of the cost of a tutor reply.
    budget = task_config("tutor")
    hits = retrieval.retrieve(module, question, k=budget.retrieval_chunks,
                              max_k=budget.retrieval_chunks + 1, char_budget=budget.source_chars)
    if hits:
        source = "\n\n".join(h.text for h in hits)
    else:
        source, hits = trim_source(module.source_text, budget.source_chars), []

    # An opening question is asked verbatim by many students on the same
    # module, so the first answer for a given content version is reused.
    cache_key = None
    if not conversation_id:
        cache_key = _ask_cache_key(module, question)
        cached = cache.get(cache_key)
        if cached:
            msg = Message.objects.create(conversation=conv, role="assistant", content=cached["answer"],
                                         grounded=cached["grounded"], source_reference=cached["source_reference"],
                                         model_name=cached.get("model", ""), latency_ms=0)
            conv.last_message_at = timezone.now()
            conv.save(update_fields=["last_message_at", "updated_at"])
            audit.record(student, "tutor.ask", module, {"conversation": str(conv.id), "cached": True}, request)
            return conv, msg, cached.get("follow_up_suggestions", [])

    started = time.monotonic()
    result = gateway().generate(
        task="tutor",
        system_prompt=GROUNDING + "TASK: Answer the STUDENT QUESTION in a few sentences using only the source. Set the grounded field "
                                  "to true when the answer comes from the source and false when the source does not cover the question. "
                                  "Never mention the grounded field in the answer text itself. "
                                  "Offer up to three short follow_up_suggestions the student could ask next about this source.",
        user_prompt=f"MODULE: {module.title}\n\nSOURCE TEXT:\n\"\"\"{source}\"\"\"\n\nRECENT CONVERSATION:\n{history_text}\n\nSTUDENT QUESTION:\n{question}",
        schema=ANSWER_SCHEMA, source_chars=len(source), retrieved_chunks=len(hits))
    latency = int((time.monotonic() - started) * 1000)
    conv.last_message_at = timezone.now()
    conv.save(update_fields=["last_message_at", "updated_at"])
    if result.failed:
        audit.record(student, "tutor.ask_failed", module, {"error": result.error_code, "conversation": str(conv.id)}, request)
        raise AIUnavailable(details={"conversation_id": str(conv.id), "reason": result.error_code,
                                     "fallback": "The module text is available for reading while the tutor is offline."})
    grounded = bool(result.data["grounded"])
    answer = _clean_answer(result.data.get("answer", ""))
    if not grounded:
        # The model's own wording for an off-topic question is unhelpful to a
        # student ("The source text does not cover physics"), and a small model
        # tends to spill the schema field into it as well. Replace it with a
        # sentence that says what to do next.
        answer = (f'This module is about "{module.title}", and its text does not cover that. '
                  "Ask about something in this module, or open the Read tab to see what it covers. "
                  "For anything else, your faculty is the right place to go.")
    msg = Message.objects.create(conversation=conv, role="assistant", content=answer, grounded=grounded,
                                 source_reference=result.data.get("source_reference", "") if grounded else "",
                                 model_name=result.model, latency_ms=latency)
    audit.record(student, "tutor.ask", module, {"conversation": str(conv.id), "grounded": msg.grounded,
                                                "latency_ms": latency, "chunks": len(hits)}, request)
    suggestions = result.data.get("follow_up_suggestions", [])
    if cache_key:
        cache.set(cache_key, {"answer": answer, "grounded": grounded, "source_reference": msg.source_reference,
                              "model": result.model, "follow_up_suggestions": suggestions}, ASK_CACHE_SECONDS)
    return conv, msg, suggestions


def remediation(student, attempt_id, request=None):
    try:
        attempt = AssessmentAttempt.objects.select_related("assessment__module", "assessment__chapter").get(pk=attempt_id, student=student)
    except (AssessmentAttempt.DoesNotExist, ValueError):
        raise NotFound("Attempt not found.")
    if attempt.status not in (AttemptStatus.EVALUATED, AttemptStatus.PENDING_EVALUATION):
        raise ValidationFailed("Remediation is available after submission.", code="NOT_SUBMITTED")
    # Remediation names the questions the student got wrong and explains the
    # right answer, so it is a result like any other: while faculty hold the
    # results it must say nothing, or a held quiz with attempts left could be
    # retaken with the answers in hand.
    if not attempt.results_visible:
        raise Forbidden("Results for this quiz have not been released yet.", code="RESULTS_NOT_RELEASED")
    wrong = [r for r in attempt.detailed_results if r.get("is_correct") is False]
    if not wrong:
        return {"overview": "Every answered question was correct. Nothing to remediate.", "items": [], "generator": "rule"}
    from assessments.services.assessments import source_text_for

    assessment = attempt.assessment
    # Same rule as grading: a module, a chapter, or chosen modules that may
    # span chapters (chapter and module are both null then).
    source = source_text_for(assessment)
    items_text = "\n".join(
        f"- Q: {r['question']}\n  Student answered: {r.get('selected_option') or r.get('student_answer', '')}\n  Correct: {r.get('correct_option') or r.get('expected_rubric', '')}\n  Source: {r.get('source_reference', '')}"
        for r in wrong)
    trimmed = trim_source(source)
    result = gateway().generate(
        task="remediation",
        system_prompt=GROUNDING + "TASK: For each INCORRECT ANSWER write one item: repeat the question, name the misconception the "
                                  "student's answer shows, and explain the correct idea from the source. Start with a two-sentence overview.",
        user_prompt=f"SOURCE TEXT:\n\"\"\"{trimmed}\"\"\"\n\nINCORRECT ANSWERS:\n{items_text}",
        schema=REMEDIATION_SCHEMA, source_chars=len(trimmed))
    if result.ok:
        data = dict(result.data, generator="ai")
    else:
        data = {"overview": "Review the source passages below for each question you missed.",
                "items": [{"question": r["question"], "misconception": f"Answered: {r.get('selected_option') or r.get('student_answer', '')}",
                           "explanation": r.get("explanation") or r.get("feedback") or "", "source_reference": r.get("source_reference", "")} for r in wrong],
                "generator": "fallback"}
    audit.record(student, "tutor.remediation", attempt, {"generator": data["generator"], "items": len(data["items"])}, request)
    return data
