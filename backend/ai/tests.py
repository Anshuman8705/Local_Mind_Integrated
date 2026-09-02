from unittest.mock import patch

from django.test import TestCase, override_settings

from .gateway import AIGateway, AIResult, OllamaProvider, validate_against_schema


class FakeResponse:
    def __init__(self, status_code=200, payload=None):
        self.status_code = status_code
        self._payload = payload

    def json(self):
        return self._payload


SCHEMA = {"type": "object", "properties": {"answer": {"type": "string"}, "points": {"type": "array", "items": {"type": "string"}, "minItems": 1}}, "required": ["answer", "points"]}


class SchemaValidatorTests(TestCase):
    def test_accepts_valid(self):
        self.assertEqual(validate_against_schema({"answer": "a", "points": ["x"]}, SCHEMA), [])

    def test_reports_missing_and_wrong_types(self):
        errors = validate_against_schema({"answer": 3, "points": []}, SCHEMA)
        self.assertTrue(any("expected string" in e for e in errors))
        self.assertTrue(any("at least 1" in e for e in errors))


@override_settings(AI={"ENABLED": True, "PROVIDER": "ollama", "OLLAMA_BASE_URL": "http://x", "TUTOR_MODEL": "m", "OUTLINE_MODEL": "o", "TIMEOUT_SECONDS": 5})
class GatewayTests(TestCase):
    def _gateway(self):
        return AIGateway(provider=OllamaProvider("http://x"))

    @patch("requests.post")
    def test_valid_output_passes_through(self, post):
        post.return_value = FakeResponse(200, {"message": {"content": '{"answer": "ok", "points": ["p"]}'}})
        result = self._gateway().generate(purpose="t", system_prompt="s", user_prompt="u", schema=SCHEMA)
        self.assertTrue(result.ok)
        self.assertEqual(result.data["answer"], "ok")

    @patch("requests.post")
    def test_malformed_json_is_rejected_not_saved(self, post):
        post.return_value = FakeResponse(200, {"message": {"content": "not json"}})
        result = self._gateway().generate(purpose="t", system_prompt="s", user_prompt="u", schema=SCHEMA)
        self.assertFalse(result.ok)
        self.assertEqual(result.error_code, "malformed")

    @patch("requests.post")
    def test_schema_violation_is_rejected(self, post):
        post.return_value = FakeResponse(200, {"message": {"content": '{"answer": "ok"}'}})
        result = self._gateway().generate(purpose="t", system_prompt="s", user_prompt="u", schema=SCHEMA)
        self.assertEqual(result.error_code, "invalid_schema")

    @patch("requests.post")
    def test_connection_error_is_unavailable(self, post):
        import requests
        post.side_effect = requests.ConnectionError("refused")
        result = self._gateway().generate(purpose="t", system_prompt="s", user_prompt="u", schema=SCHEMA)
        self.assertEqual(result.error_code, "unavailable")

    @patch("requests.post")
    def test_timeout(self, post):
        import requests
        post.side_effect = requests.Timeout()
        result = self._gateway().generate(purpose="t", system_prompt="s", user_prompt="u", schema=SCHEMA)
        self.assertEqual(result.error_code, "timeout")

    def test_disabled_provider_when_ai_off(self):
        with override_settings(AI={"ENABLED": False, "PROVIDER": "ollama", "OLLAMA_BASE_URL": "", "TUTOR_MODEL": "m", "OUTLINE_MODEL": "o", "TIMEOUT_SECONDS": 5}):
            from .gateway import gateway
            result = gateway().generate(purpose="t", system_prompt="s", user_prompt="u", schema=SCHEMA)
            self.assertEqual(result.error_code, "disabled")
