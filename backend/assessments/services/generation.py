"""Question generation: AI first, deterministic fallback second, both flagged."""
import hashlib
import logging
import random

from ai.config import task_config
from ai.gateway import gateway, trim_source
from documents.services import retrieval
from core.exceptions import ValidationFailed

logger = logging.getLogger("localmind.assessments")

MCQ_KEYS = ["A", "B", "C", "D"]


def mcq_schema(n):
    return {
        "type": "array", "minItems": n, "maxItems": n,
        "items": {"type": "object", "properties": {
            "question": {"type": "string"},
            "options": {"type": "array", "minItems": 4, "maxItems": 4,
                        "items": {"type": "object", "properties": {"key": {"type": "string"}, "text": {"type": "string"}}, "required": ["key", "text"]}},
            "correct_answer": {"type": "string", "enum": MCQ_KEYS},
            "explanation": {"type": "string"},
            "source_reference": {"type": "string"},
        }, "required": ["question", "options", "correct_answer", "explanation", "source_reference"]},
    }


def subjective_schema(n):
    return {
        "type": "array", "minItems": n, "maxItems": n,
        "items": {"type": "object", "properties": {
            "question": {"type": "string"}, "expected_rubric": {"type": "string"}, "source_reference": {"type": "string"},
        }, "required": ["question", "expected_rubric", "source_reference"]},
    }


def normalize_questions(raw_questions):
    """Validate and canonicalise a question list (manual or AI). Raises on problems."""
    out, errors = [], []
    for idx, q in enumerate(raw_questions or [], start=1):
        qtype = (q.get("type") or "mcq").lower()
        text = str(q.get("question") or "").strip()
        if not text:
            errors.append(f"q{idx}: question text is required")
            continue
        item = {"id": f"q{idx}", "type": qtype, "question": text, "source_reference": str(q.get("source_reference") or "")}
        if qtype == "mcq":
            options = q.get("options") or []
            if len(options) != 4:
                errors.append(f"q{idx}: mcq needs exactly 4 options")
                continue
            keys = []
            norm = []
            for pos, opt in enumerate(options):
                key = str(opt.get("key") or MCQ_KEYS[pos]).strip().upper()
                keys.append(key)
                norm.append({"key": key, "text": str(opt.get("text") or "").strip()})
            if sorted(keys) != MCQ_KEYS or any(not o["text"] for o in norm):
                errors.append(f"q{idx}: options must be A-D with text")
                continue
            if len({o["text"].casefold() for o in norm}) != 4:
                errors.append(f"q{idx}: options must be distinct")
                continue
            correct = str(q.get("correct_answer") or "").strip().upper()
            if correct not in MCQ_KEYS:
                errors.append(f"q{idx}: correct_answer must be one of A-D")
                continue
            item.update({"options": norm, "correct_answer": correct, "explanation": str(q.get("explanation") or "")})
        elif qtype == "subjective":
            rubric = str(q.get("expected_rubric") or "").strip()
            if not rubric:
                errors.append(f"q{idx}: subjective question needs expected_rubric")
                continue
            item["expected_rubric"] = rubric
        else:
            errors.append(f"q{idx}: unsupported type {qtype}")
            continue
        out.append(item)
    if errors:
        raise ValidationFailed("Question set is invalid.", code="INVALID_QUESTIONS", details={"questions": errors})
    if not out:
        raise ValidationFailed("At least one question is required.", code="INVALID_QUESTIONS")
    return out


def fallback_questions(source_text, title, num_mcqs, num_subjective):
    """Deterministic, transparent stand-in when AI is unavailable. Always
    flagged as generator=fallback so faculty review before publishing."""
    sentences = [s.strip() for s in source_text.replace("\n", " ").split(".") if len(s.strip()) > 30]
    if not sentences:
        sentences = [source_text.strip()[:200] or title]
    rng = random.Random(int(hashlib.sha256(source_text.encode('utf-8')).hexdigest()[:8], 16))
    questions = []
    for i in range(num_mcqs):
        sent = sentences[i % len(sentences)]
        correct = rng.choice(MCQ_KEYS)
        texts = {
            correct: sent[:160],
            **{k: f"[Placeholder distractor {n} — edit before publishing]" for n, k in enumerate([k for k in MCQ_KEYS if k != correct], 1)},
        }
        questions.append({"type": "mcq", "question": f"Which statement from '{title}' is correct?",
                          "options": [{"key": k, "text": texts[k]} for k in MCQ_KEYS],
                          "correct_answer": correct, "explanation": f"From the source: {sent}", "source_reference": sent})
    for i in range(num_subjective):
        sent = sentences[(num_mcqs + i) % len(sentences)]
        questions.append({"type": "subjective", "question": f"Explain, in your own words: \"{sent[:120]}\"",
                          "expected_rubric": f"Must convey the meaning of: {sent}", "source_reference": sent})
    return normalize_questions(questions)


def _dedupe(questions, previous_questions):
    """Drop questions that repeat an earlier quiz or another question in the same
    set (case- and whitespace-insensitive). Returns (kept, repeated_earlier, repeated_within)."""
    earlier = {" ".join(str(q).split()).casefold() for q in (previous_questions or [])}
    seen, kept, hit_earlier, hit_within = set(), [], 0, 0
    for q in questions:
        key = " ".join(q["question"].split()).casefold()
        if key in earlier:
            hit_earlier += 1
            continue
        if key in seen:
            hit_within += 1
            continue
        seen.add(key)
        kept.append(q)
    return kept, hit_earlier, hit_within


def generate_questions(source_text, title, num_mcqs=6, num_subjective=0, previous_questions=None, module=None):
    """Returns (questions, generator, ai_error_or_empty).

    generator is "ai" when qwen3 produced a valid set (possibly fewer than
    requested after de-duplication, noted in the third value) and "fallback"
    when the model was unavailable or its output failed validation twice.
    """
    if not source_text.strip():
        raise ValidationFailed("Cannot generate questions without source text.", code="NO_SOURCE")
    exclusion = ""
    if previous_questions:
        exclusion = "\nPREVIOUSLY ASKED (do not repeat or rephrase any of these):\n" + "\n".join(f"- {q}" for q in previous_questions[:20]) + "\n"

    props, req, tasks = {}, [], []
    if num_mcqs > 0:
        props["mcq_questions"] = mcq_schema(num_mcqs); req.append("mcq_questions"); tasks.append(f"exactly {num_mcqs} multiple-choice questions")
    if num_subjective > 0:
        props["subjective_questions"] = subjective_schema(num_subjective); req.append("subjective_questions"); tasks.append(f"exactly {num_subjective} open-ended questions")
    schema = {"type": "object", "properties": props, "required": req}

    system = (
        "You write exam questions from a textbook excerpt. Follow every rule.\n"
        "1. Use only facts stated in the SOURCE TEXT. Never use outside knowledge.\n"
        "2. Each multiple-choice question has four options with keys A, B, C, D in that order. "
        "Exactly one option is correct; the other three are plausible but wrong according to the source. "
        "All four option texts must be different.\n"
        "3. correct_answer is the single letter of the correct option.\n"
        "4. explanation says in one or two sentences why the correct option is right, citing the source.\n"
        "5. source_reference is a short phrase copied from the SOURCE TEXT that the question is based on.\n"
        "6. Open-ended questions need an expected_rubric: the two to four points a full answer must contain.\n"
        "7. Cover different parts of the source; do not ask two questions about the same sentence.\n"
        "8. Output only the JSON."
    )
    # A quiz should cover the whole module, so when the caller names one the
    # source is sampled evenly across its chunks instead of being truncated at
    # the front, which used to mean every question came from the first pages.
    budget = task_config("quiz")
    chunk_count = 0
    source = ""
    if module is not None:
        source, chunk_count = retrieval.coverage_sample(module, budget.source_chars)
    if not source:
        source = trim_source(source_text, budget.source_chars)
    user = f"TITLE: {title}\n\nSOURCE TEXT:\n\"\"\"{source}\"\"\"\n{exclusion}\nTASK: Write {' and '.join(tasks)} about the source text above.\nOutput only the JSON."
    result = gateway().generate(task="quiz", system_prompt=system, user_prompt=user, schema=schema,
                                source_chars=len(source), retrieved_chunks=chunk_count)
    if result.ok:
        raw = [dict(q, type="mcq") for q in result.data.get("mcq_questions", [])] + \
              [dict(q, type="subjective") for q in result.data.get("subjective_questions", [])]
        try:
            questions, hit_earlier, hit_within = _dedupe(normalize_questions(raw), previous_questions)
            if questions:
                notes = []
                if hit_earlier:
                    notes.append(f"dropped {hit_earlier} question(s) that repeated an earlier quiz")
                if hit_within:
                    notes.append(f"dropped {hit_within} duplicate question(s)")
                if notes:
                    questions = normalize_questions(questions)  # re-number q1..qN after the drop
                return questions, "ai", "; ".join(notes)
            error = "every generated question was a duplicate or repeated an earlier quiz"
        except ValidationFailed as exc:
            logger.warning("AI questions failed validation: %s", exc.details)
            error = f"invalid_questions: {exc.details}"
    else:
        error = f"{result.error_code}: {result.error}"
    return fallback_questions(source_text, title, num_mcqs, num_subjective), "fallback", error
