from io import StringIO
from unittest.mock import patch

from django.core.management import call_command
from django.core.management.base import CommandError
from django.test import TestCase, override_settings

from core.testing import client_for, make_admin, make_student

from . import gateway as gw
from .gateway import AIGateway, OllamaProvider, clean_model_output, trim_source, validate_against_schema


class FakeResponse:
    def __init__(self, status_code=200, payload=None):
        self.status_code = status_code
        self._payload = payload

    def json(self):
        return self._payload


def chat(content, done_reason="stop"):
    return FakeResponse(200, {"message": {"content": content}, "done_reason": done_reason})


SCHEMA = {"type": "object", "properties": {"answer": {"type": "string"}, "points": {"type": "array", "items": {"type": "string"}, "minItems": 1}}, "required": ["answer", "points"]}
AI_ON = {"ENABLED": True, "PROVIDER": "ollama", "OLLAMA_BASE_URL": "http://x", "TUTOR_MODEL": "qwen3:1.7b", "OUTLINE_MODEL": "qwen3:1.7b",
         "TIMEOUT_SECONDS": 5, "NUM_CTX": 16384, "NUM_PREDICT": 4096, "KEEP_ALIVE": "30m", "MAX_RETRIES": 1, "MAX_SOURCE_CHARS": 14000,
         "HEALTH_CACHE_SECONDS": 30}
AI_OFF = dict(AI_ON, ENABLED=False)


class SchemaValidatorTests(TestCase):
    def test_accepts_valid(self):
        self.assertEqual(validate_against_schema({"answer": "a", "points": ["x"]}, SCHEMA), [])

    def test_reports_missing_and_wrong_types(self):
        errors = validate_against_schema({"answer": 3, "points": []}, SCHEMA)
        self.assertTrue(any("expected string" in e for e in errors))
        self.assertTrue(any("at least 1" in e for e in errors))


class OutputCleanupTests(TestCase):
    def test_strips_think_block_and_fence(self):
        raw = '<think>let me reason</think>\n```json\n{"answer": "ok", "points": ["p"]}\n```'
        self.assertEqual(clean_model_output(raw), '{"answer": "ok", "points": ["p"]}')

    def test_unterminated_think_drops_everything_after_it(self):
        self.assertEqual(clean_model_output('{"a": 1}<think>still thinking'), '{"a": 1}')

    def test_leading_prose_before_json_is_removed(self):
        self.assertEqual(clean_model_output('Here is the JSON: {"a": 1}'), '{"a": 1}')

    def test_trim_source_cuts_on_paragraph_boundary(self):
        text = ("para one. " * 30 + "\n\n") * 10
        trimmed = trim_source(text, limit=1000)
        self.assertLessEqual(len(trimmed), 1000)
        self.assertTrue(trimmed.endswith("para one."))

    def test_trim_source_leaves_short_text_alone(self):
        self.assertEqual(trim_source("short", limit=100), "short")


@override_settings(AI=AI_ON)
class GatewayTests(TestCase):
    def _gateway(self):
        return AIGateway(provider=OllamaProvider("http://x"))

    @patch("requests.post")
    def test_valid_output_passes_through(self, post):
        post.return_value = chat('{"answer": "ok", "points": ["p"]}')
        result = self._gateway().generate(purpose="t", system_prompt="s", user_prompt="u", schema=SCHEMA)
        self.assertTrue(result.ok)
        self.assertEqual(result.data["answer"], "ok")
        self.assertEqual(result.attempts, 1)

    @patch("requests.post")
    def test_request_carries_context_window_and_output_cap(self, post):
        post.return_value = chat('{"answer": "ok", "points": ["p"]}')
        self._gateway().generate(purpose="t", system_prompt="s", user_prompt="u", schema=SCHEMA, temperature=0.3)
        body = post.call_args.kwargs["json"]
        self.assertEqual(body["model"], "qwen3:1.7b")
        self.assertEqual(body["options"]["num_ctx"], 16384)
        self.assertEqual(body["options"]["num_predict"], 4096)
        self.assertEqual(body["options"]["temperature"], 0.3)
        self.assertIs(body["think"], False)
        self.assertEqual(body["format"], SCHEMA)
        self.assertEqual(body["keep_alive"], "30m")
        self.assertEqual(post.call_args.kwargs["timeout"], 5)

    @patch("requests.post")
    def test_think_wrapped_json_is_accepted(self, post):
        post.return_value = chat('<think>hmm</think>{"answer": "ok", "points": ["p"]}')
        result = self._gateway().generate(purpose="t", system_prompt="s", user_prompt="u", schema=SCHEMA)
        self.assertTrue(result.ok)

    @patch("requests.post")
    def test_malformed_then_valid_is_retried_once_at_temperature_zero(self, post):
        post.side_effect = [chat("not json"), chat('{"answer": "ok", "points": ["p"]}')]
        result = self._gateway().generate(purpose="t", system_prompt="s", user_prompt="u", schema=SCHEMA, temperature=0.7)
        self.assertTrue(result.ok)
        self.assertEqual(result.attempts, 2)
        second = post.call_args_list[1].kwargs["json"]
        self.assertEqual(second["options"]["temperature"], 0.0)
        self.assertEqual(len(second["messages"]), 3)
        self.assertIn("malformed", second["messages"][2]["content"])

    @patch("requests.post")
    def test_schema_violation_twice_is_rejected(self, post):
        post.side_effect = [chat('{"answer": "ok"}'), chat('{"answer": "ok"}')]
        result = self._gateway().generate(purpose="t", system_prompt="s", user_prompt="u", schema=SCHEMA)
        self.assertFalse(result.ok)
        self.assertEqual(result.error_code, "invalid_schema")
        self.assertEqual(result.attempts, 2)

    @patch("requests.post")
    def test_truncated_output_is_flagged_and_retried(self, post):
        post.side_effect = [chat('{"answer": "ok", "poi', done_reason="length"), chat('{"answer": "ok", "points": ["p"]}')]
        result = self._gateway().generate(purpose="t", system_prompt="s", user_prompt="u", schema=SCHEMA)
        self.assertTrue(result.ok)
        self.assertEqual(result.attempts, 2)

    @patch("requests.post")
    def test_empty_content_is_reported(self, post):
        post.side_effect = [chat(""), chat("")]
        result = self._gateway().generate(purpose="t", system_prompt="s", user_prompt="u", schema=SCHEMA)
        self.assertEqual(result.error_code, "empty")

    @patch("requests.post")
    def test_connection_error_is_unavailable_and_not_retried(self, post):
        import requests
        post.side_effect = requests.ConnectionError("refused")
        result = self._gateway().generate(purpose="t", system_prompt="s", user_prompt="u", schema=SCHEMA)
        self.assertEqual(result.error_code, "unavailable")
        self.assertEqual(post.call_count, 1)

    @patch("requests.post")
    def test_missing_model_gives_pull_hint(self, post):
        post.return_value = FakeResponse(404, {"error": "model not found"})
        result = self._gateway().generate(purpose="t", system_prompt="s", user_prompt="u", schema=SCHEMA)
        self.assertEqual(result.error_code, "unavailable")
        self.assertIn("ollama pull qwen3:1.7b", result.error)

    @patch("requests.post")
    def test_timeout_is_not_retried(self, post):
        import requests
        post.side_effect = requests.Timeout()
        result = self._gateway().generate(purpose="t", system_prompt="s", user_prompt="u", schema=SCHEMA)
        self.assertEqual(result.error_code, "timeout")
        self.assertEqual(post.call_count, 1)

    @override_settings(AI=dict(AI_ON, MAX_RETRIES=0))
    @patch("requests.post")
    def test_retries_can_be_disabled(self, post):
        post.return_value = chat("not json")
        result = self._gateway().generate(purpose="t", system_prompt="s", user_prompt="u", schema=SCHEMA)
        self.assertEqual(result.error_code, "malformed")
        self.assertEqual(post.call_count, 1)

    def test_disabled_provider_when_ai_off(self):
        with override_settings(AI=AI_OFF):
            result = gw.gateway().generate(purpose="t", system_prompt="s", user_prompt="u", schema=SCHEMA)
            self.assertEqual(result.error_code, "disabled")


class HealthTests(TestCase):
    def setUp(self):
        gw.reset_health_cache()

    @override_settings(AI=AI_ON)
    @patch("requests.get")
    def test_ready_when_reachable_and_model_present(self, get):
        get.return_value = FakeResponse(200, {"models": [{"name": "qwen3:1.7b"}, {"name": "nomic-embed-text:latest"}]})
        status = gw.health(force=True)
        self.assertTrue(status.ready)
        self.assertEqual(status.as_dict()["tutor_model"], {"name": "qwen3:1.7b", "present": True})

    @override_settings(AI=AI_ON)
    @patch("requests.get")
    def test_not_ready_when_model_missing_and_result_is_cached(self, get):
        get.return_value = FakeResponse(200, {"models": [{"name": "llama3:latest"}]})
        first = gw.health(force=True)
        self.assertTrue(first.reachable)
        self.assertFalse(first.ready)
        gw.health()
        self.assertEqual(get.call_count, 1)

    @override_settings(AI=AI_ON)
    @patch("requests.get")
    def test_unreachable(self, get):
        import requests
        get.side_effect = requests.ConnectionError("refused")
        status = gw.health(force=True)
        self.assertFalse(status.reachable)
        self.assertIn("refused", status.error)

    @override_settings(AI=AI_OFF)
    def test_disabled_reports_not_ready_without_network(self):
        status = gw.health(force=True)
        self.assertFalse(status.enabled)
        self.assertFalse(status.ready)

    def test_health_endpoint_includes_ai_block(self):
        data = client_for().get("/api/health/").json()
        self.assertEqual(data["status"], "ok")
        self.assertIn("ready", data["ai"])
        self.assertFalse(data["ai"]["enabled"])  # forced off under the test runner

    @override_settings(AI=AI_ON)
    @patch("requests.get")
    def test_admin_ai_status_endpoint(self, get):
        get.return_value = FakeResponse(200, {"models": [{"name": "qwen3:1.7b"}]})
        resp = client_for(make_admin()).get("/api/admin/ai/status/?refresh=1")
        self.assertEqual(resp.status_code, 200)
        self.assertTrue(resp.json()["ready"])
        self.assertEqual(client_for(make_student()).get("/api/admin/ai/status/").status_code, 403)


class CheckAICommandTests(TestCase):
    def setUp(self):
        gw.reset_health_cache()

    def _run(self, *args):
        out = StringIO()
        call_command("check_ai", *args, stdout=out)
        return out.getvalue()

    @override_settings(AI=AI_OFF)
    def test_fails_when_disabled(self):
        with self.assertRaises(CommandError):
            self._run()

    @override_settings(AI=AI_ON)
    @patch("requests.get")
    def test_fails_when_unreachable(self, get):
        import requests
        get.side_effect = requests.ConnectionError("refused")
        with self.assertRaises(CommandError):
            self._run()

    @override_settings(AI=AI_ON)
    @patch("requests.get")
    def test_fails_when_model_missing(self, get):
        get.return_value = FakeResponse(200, {"models": []})
        with self.assertRaisesRegex(CommandError, "qwen3:1.7b"):
            self._run()

    @override_settings(AI=AI_ON)
    @patch("requests.post")
    @patch("requests.get")
    def test_pull_then_smoke(self, get, post):
        get.side_effect = [FakeResponse(200, {"models": []}), FakeResponse(200, {"models": [{"name": "qwen3:1.7b"}]})]
        post.side_effect = [FakeResponse(200, {"status": "success"}), chat('{"greeting": "hello", "number": 7}')]
        out = self._run("--pull", "--smoke")
        self.assertIn("pulled qwen3:1.7b", out)
        self.assertIn("AI ready", out)
        self.assertEqual(post.call_args_list[0].args[0], "http://x/api/pull")
