"""AI gateway: the only place that talks to a language model.

Callers describe *what* they want (system prompt, user prompt, JSON schema,
which model class) and get back an AIResult. They never see HTTP, provider
payloads, or raw strings. Swapping Ollama for another provider means adding a
class here that implements AIProvider.
"""
from __future__ import annotations

import json
import logging
from dataclasses import dataclass, field
from typing import Any, Protocol

from django.conf import settings

logger = logging.getLogger("localmind.ai")


@dataclass
class AIResult:
    ok: bool
    data: dict | None = None
    error_code: str = ""  # disabled | unavailable | timeout | malformed | invalid_schema | empty
    error: str = ""
    provider: str = ""
    model: str = ""
    raw: str = field(default="", repr=False)

    @property
    def failed(self):
        return not self.ok


class AIProvider(Protocol):
    name: str

    def generate_structured(self, *, model: str, messages: list[dict], schema: dict,
                            temperature: float, timeout: int) -> AIResult: ...


class OllamaProvider:
    name = "ollama"

    def __init__(self, base_url: str):
        self.base_url = base_url.rstrip("/")

    def generate_structured(self, *, model, messages, schema, temperature, timeout):
        import requests

        try:
            response = requests.post(
                f"{self.base_url}/api/chat",
                json={
                    "model": model,
                    "messages": messages,
                    "format": schema,
                    "stream": False,
                    "think": False,
                    "options": {"temperature": temperature, "top_p": 0.1 if temperature == 0 else 0.9},
                    "keep_alive": "30m",
                },
                timeout=timeout,
            )
        except requests.Timeout:
            return AIResult(ok=False, error_code="timeout", error="Model request timed out.", provider=self.name, model=model)
        except requests.RequestException as exc:
            return AIResult(ok=False, error_code="unavailable", error=str(exc), provider=self.name, model=model)

        if response.status_code == 404:
            return AIResult(ok=False, error_code="unavailable", error=f"Model {model} is not available.", provider=self.name, model=model)
        if response.status_code >= 400:
            return AIResult(ok=False, error_code="unavailable", error=f"Provider returned {response.status_code}.", provider=self.name, model=model)

        try:
            content = response.json()["message"]["content"]
        except (ValueError, KeyError):
            return AIResult(ok=False, error_code="malformed", error="Provider response had no message content.", provider=self.name, model=model)
        try:
            data = json.loads(content)
        except json.JSONDecodeError:
            return AIResult(ok=False, error_code="malformed", error="Model output was not valid JSON.", provider=self.name, model=model, raw=content[:2000])
        return AIResult(ok=True, data=data, provider=self.name, model=model, raw=content)


class DisabledProvider:
    name = "disabled"

    def generate_structured(self, **kwargs):
        return AIResult(ok=False, error_code="disabled", error="AI is disabled by configuration.", provider=self.name, model=kwargs.get("model", ""))


_provider_cache: dict[str, AIProvider] = {}


def get_provider() -> AIProvider:
    cfg = settings.AI
    if not cfg["ENABLED"]:
        return DisabledProvider()
    key = f'{cfg["PROVIDER"]}:{cfg["OLLAMA_BASE_URL"]}'
    if key not in _provider_cache:
        if cfg["PROVIDER"] == "ollama":
            _provider_cache[key] = OllamaProvider(cfg["OLLAMA_BASE_URL"])
        else:
            raise RuntimeError(f"Unknown AI provider {cfg['PROVIDER']}")
    return _provider_cache[key]


# ---- minimal schema validation (subset of JSON Schema we actually use) ----

def _validate(instance, schema, path="$"):
    errors = []
    expected = schema.get("type")
    if expected == "object":
        if not isinstance(instance, dict):
            return [f"{path}: expected object"]
        for key in schema.get("required", []):
            if key not in instance:
                errors.append(f"{path}.{key}: missing")
        for key, sub in schema.get("properties", {}).items():
            if key in instance:
                errors += _validate(instance[key], sub, f"{path}.{key}")
    elif expected == "array":
        if not isinstance(instance, list):
            return [f"{path}: expected array"]
        if "minItems" in schema and len(instance) < schema["minItems"]:
            errors.append(f"{path}: expected at least {schema['minItems']} items")
        if "maxItems" in schema and len(instance) > schema["maxItems"]:
            errors.append(f"{path}: expected at most {schema['maxItems']} items")
        items = schema.get("items")
        if items:
            for idx, item in enumerate(instance):
                errors += _validate(item, items, f"{path}[{idx}]")
    elif expected == "string":
        if not isinstance(instance, str):
            errors.append(f"{path}: expected string")
        elif "enum" in schema and instance not in schema["enum"]:
            errors.append(f"{path}: not one of {schema['enum']}")
    elif expected == "integer":
        if not isinstance(instance, int) or isinstance(instance, bool):
            errors.append(f"{path}: expected integer")
    elif expected == "number":
        if not isinstance(instance, (int, float)) or isinstance(instance, bool):
            errors.append(f"{path}: expected number")
    elif expected == "boolean":
        if not isinstance(instance, bool):
            errors.append(f"{path}: expected boolean")
    return errors


def validate_against_schema(instance, schema) -> list[str]:
    return _validate(instance, schema)


class AIGateway:
    def __init__(self, provider: AIProvider | None = None):
        self.provider = provider or get_provider()

    def generate(self, *, purpose: str, system_prompt: str, user_prompt: str, schema: dict,
                 model_kind: str = "tutor", temperature: float = 0.0, timeout: int | None = None) -> AIResult:
        cfg = settings.AI
        model = cfg["OUTLINE_MODEL"] if model_kind == "outline" else cfg["TUTOR_MODEL"]
        result = self.provider.generate_structured(
            model=model,
            messages=[{"role": "system", "content": system_prompt}, {"role": "user", "content": user_prompt}],
            schema=schema,
            temperature=temperature,
            timeout=timeout or cfg["TIMEOUT_SECONDS"],
        )
        if result.ok:
            problems = validate_against_schema(result.data, schema)
            if problems:
                logger.warning("AI output for %s failed schema validation: %s", purpose, problems[:5])
                return AIResult(ok=False, error_code="invalid_schema", error="; ".join(problems[:5]),
                                provider=result.provider, model=result.model, raw=result.raw)
        else:
            logger.warning("AI call for %s failed: %s (%s)", purpose, result.error_code, result.error)
        return result


def gateway() -> AIGateway:
    return AIGateway()
