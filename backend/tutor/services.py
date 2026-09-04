"""Tutor: teach, ask, remediate — all grounded in server-resolved module text."""
import re
import time

from django.db import transaction
from django.utils import timezone

from ai.gateway import gateway, trim_source
from assessments.models import AssessmentAttempt, AttemptStatus
from audit import services as audit
from core.exceptions import AIUnavailable, NotFound, ValidationFailed
from learning import services as learning

from .models import Conversation, Message, ModuleLesson

LESSON_SCHEMA = {"type": "object", "properties": {
    "title": {"type": "string"},
    "learning_objectives": {"type": "array", "minItems": 2, "maxItems": 6, "items": {"type": "string"}},
    "sections": {"type": "array", "minItems": 2, "maxItems": 8, "items": {"type": "object", "properties": {
        "heading": {"type": "string"}, "explanation": {"type": "string"}, "source_reference": {"type": "string"}},
        "required": ["heading", "explanation", "source_reference"]}},
    "key_terms": {"type": "array", "items": {"type": "object", "properties": {"term": {"type": "string"}, "definition": {"type": "string"}}, "required": ["term", "definition"]}},
    "summary": {"type": "string"}},
    "required": ["title", "learning_objectives", "sections", "key_terms", "summary"]}

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


def _module(student, module_id):
    return learning.resolve_accessible_module(student, module_id)


def _fallback_lesson(module):
    paragraphs = [p.strip() for p in module.source_text.split("\n\n") if p.strip()]
    if not paragraphs:
        paragraphs = [module.source_text.strip()]
    sections = [{"heading": f"Part {i}", "explanation": p[:1500], "source_reference": p[:120]} for i, p in enumerate(paragraphs[:8], start=1)]
    if len(sections) < 2:
        text = sections[0]["explanation"]
        half = len(text) // 2
        sections = [{"heading": "Part 1", "explanation": text[:half], "source_reference": text[:120]},
                    {"heading": "Part 2", "explanation": text[half:], "source_reference": text[half:half + 120]}]
    return {"title": module.title, "learning_objectives": [f"Read and understand '{module.title}'", "Identify the key ideas in the source text"],
            "sections": sections, "key_terms": [], "summary": "AI tutoring is unavailable; this lesson mirrors the source text directly."}


def teach(student, module_id, request=None):
    """Not wrapped in a transaction: the model call can take a minute, and a
    transaction open that long holds the SQLite write lock against every other
    request. Only the cache write below is atomic."""
    module = _module(student, module_id)
    version = module.chapter.document.content_version
    cached = ModuleLesson.objects.filter(module=module, content_version=version, generator="ai").first()
    if cached:
        return cached.lesson, {"generator": "ai", "cached": True, "model": cached.model_name}
    result = gateway().generate(
        purpose="teach",
        system_prompt=GROUNDING + "TASK: Turn the source into a lesson with two to six learning_objectives, two to eight sections "
                                  "(each with a heading, a clear explanation and a source_reference), the key_terms defined in the "
                                  "source, and a short summary.",
        user_prompt=f"MODULE: {module.title}\n\nSOURCE TEXT:\n\"\"\"{trim_source(module.source_text)}\"\"\"",
        schema=LESSON_SCHEMA, temperature=0.3)
    if result.ok:
        lesson = result.data
        with transaction.atomic():
            ModuleLesson.objects.update_or_create(module=module, content_version=version, defaults={"lesson": lesson, "generator": "ai", "model_name": result.model})
            audit.record(student, "tutor.teach", module, {"generator": "ai"}, request)
        return lesson, {"generator": "ai", "cached": False, "model": result.model}
    audit.record(student, "tutor.teach", module, {"generator": "fallback", "error": result.error_code}, request)
    return _fallback_lesson(module), {"generator": "fallback", "cached": False, "ai_error": result.error_code}


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

    history = list(conv.messages.order_by("-created_at")[:8])[::-1]
    history_text = "\n".join(f"{m.role.upper()}: {m.content[:600]}" for m in history) or "(none)"
    Message.objects.create(conversation=conv, role="user", content=question)

    started = time.monotonic()
    result = gateway().generate(
        purpose="ask",
        system_prompt=GROUNDING + "TASK: Answer the STUDENT QUESTION in a few sentences using only the source. Set the grounded field "
                                  "to true when the answer comes from the source and false when the source does not cover the question. "
                                  "Never mention the grounded field in the answer text itself. "
                                  "Offer up to three short follow_up_suggestions the student could ask next about this source.",
        user_prompt=f"MODULE: {module.title}\n\nSOURCE TEXT:\n\"\"\"{trim_source(module.source_text)}\"\"\"\n\nRECENT CONVERSATION:\n{history_text}\n\nSTUDENT QUESTION:\n{question}",
        schema=ANSWER_SCHEMA, temperature=0.2)
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
    audit.record(student, "tutor.ask", module, {"conversation": str(conv.id), "grounded": msg.grounded, "latency_ms": latency}, request)
    return conv, msg, result.data.get("follow_up_suggestions", [])


def remediation(student, attempt_id, request=None):
    try:
        attempt = AssessmentAttempt.objects.select_related("assessment__module", "assessment__chapter").get(pk=attempt_id, student=student)
    except (AssessmentAttempt.DoesNotExist, ValueError):
        raise NotFound("Attempt not found.")
    if attempt.status not in (AttemptStatus.EVALUATED, AttemptStatus.PENDING_EVALUATION):
        raise ValidationFailed("Remediation is available after submission.", code="NOT_SUBMITTED")
    wrong = [r for r in attempt.detailed_results if r.get("is_correct") is False]
    if not wrong:
        return {"overview": "Every answered question was correct. Nothing to remediate.", "items": [], "generator": "rule"}
    assessment = attempt.assessment
    source = assessment.module.source_text if assessment.module else "\n\n".join(m.source_text for m in assessment.chapter.modules.all())
    items_text = "\n".join(
        f"- Q: {r['question']}\n  Student answered: {r.get('selected_option') or r.get('student_answer', '')}\n  Correct: {r.get('correct_option') or r.get('expected_rubric', '')}\n  Source: {r.get('source_reference', '')}"
        for r in wrong)
    result = gateway().generate(
        purpose="remediation",
        system_prompt=GROUNDING + "TASK: For each INCORRECT ANSWER write one item: repeat the question, name the misconception the "
                                  "student's answer shows, and explain the correct idea from the source. Start with a two-sentence overview.",
        user_prompt=f"SOURCE TEXT:\n\"\"\"{trim_source(source)}\"\"\"\n\nINCORRECT ANSWERS:\n{items_text}", schema=REMEDIATION_SCHEMA, temperature=0.2)
    if result.ok:
        data = dict(result.data, generator="ai")
    else:
        data = {"overview": "Review the source passages below for each question you missed.",
                "items": [{"question": r["question"], "misconception": f"Answered: {r.get('selected_option') or r.get('student_answer', '')}",
                           "explanation": r.get("explanation") or r.get("feedback") or "", "source_reference": r.get("source_reference", "")} for r in wrong],
                "generator": "fallback"}
    audit.record(student, "tutor.remediation", attempt, {"generator": data["generator"], "items": len(data["items"])}, request)
    return data
