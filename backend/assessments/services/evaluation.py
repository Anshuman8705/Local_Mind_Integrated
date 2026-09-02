"""Subjective answer evaluation via the AI gateway. Auditable and re-runnable."""
from ai.gateway import gateway

SCHEMA = {"type": "object", "properties": {
    "is_correct": {"type": "boolean"}, "score_awarded": {"type": "number"},
    "feedback": {"type": "string"}, "missing_points": {"type": "array", "items": {"type": "string"}}},
    "required": ["is_correct", "score_awarded", "feedback", "missing_points"]}


def evaluate_subjective(source_text, question, expected_rubric, student_answer):
    """Returns (result_dict, ok). When ok is False the item must stay pending."""
    if not (student_answer or "").strip():
        return {"is_correct": False, "score_awarded": 0.0, "feedback": "No answer was provided.", "missing_points": ["Question left blank."], "evaluator": "rule"}, True
    system = ("You are a strict, impartial exam evaluator. Judge the student's answer ONLY against the SOURCE TEXT and "
              "EXPECTED RUBRIC. Award 1.0 if the required factual meaning is conveyed, otherwise 0.0. Give brief feedback and list missing points.")
    user = f"SOURCE TEXT:\n\"\"\"{source_text[:12000]}\"\"\"\n\nQUESTION:\n{question}\n\nEXPECTED RUBRIC:\n{expected_rubric}\n\nSTUDENT ANSWER:\n\"\"\"{student_answer}\"\"\""
    result = gateway().generate(purpose="evaluate", system_prompt=system, user_prompt=user, schema=SCHEMA, temperature=0.0)
    if result.failed:
        return {"error": f"{result.error_code}: {result.error}"}, False
    is_correct = bool(result.data["is_correct"])
    return {"is_correct": is_correct, "score_awarded": 1.0 if is_correct else 0.0,
            "feedback": result.data.get("feedback", ""), "missing_points": result.data.get("missing_points", []),
            "evaluator": f"{result.provider}:{result.model}"}, True
