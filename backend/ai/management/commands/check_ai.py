"""Verify the Ollama host and the configured qwen3 models before serving traffic.

    python manage.py check_ai            # reachability + model presence
    python manage.py check_ai --pull     # pull any missing model first
    python manage.py check_ai --smoke    # also run one structured generation

Exits non-zero on any failure so a deploy script or systemd ExecStartPre can
gate on it. Never run this from a request handler; --pull blocks for minutes.
"""
from django.conf import settings
from django.core.management.base import BaseCommand, CommandError

from ai.gateway import AIGateway, get_provider, health, reset_health_cache

SMOKE_SCHEMA = {"type": "object", "properties": {"greeting": {"type": "string"}, "number": {"type": "integer"}},
                "required": ["greeting", "number"]}


class Command(BaseCommand):
    help = "Check that Ollama is reachable and the configured models are pulled."

    def add_arguments(self, parser):
        parser.add_argument("--pull", action="store_true", help="Pull missing models (blocking).")
        parser.add_argument("--smoke", action="store_true", help="Run one small structured generation through the gateway.")
        parser.add_argument("--timeout", type=int, default=5, help="Seconds for the reachability probe.")

    def handle(self, *args, **options):
        cfg = settings.AI
        if not cfg["ENABLED"]:
            raise CommandError("AI_ENABLED is false; nothing to check. Set AI_ENABLED=true to use the tutor.")

        status = health(force=True, timeout=options["timeout"])
        self.stdout.write(f"Ollama at {status.base_url}: {'reachable' if status.reachable else 'UNREACHABLE'}")
        if not status.reachable:
            raise CommandError(f"Cannot reach Ollama: {status.error}. Start it with `ollama serve` or fix OLLAMA_BASE_URL.")

        wanted = sorted({cfg["TUTOR_MODEL"], cfg["OUTLINE_MODEL"]})
        missing = [m for m in wanted if not status.model_present(m)]
        for m in wanted:
            self.stdout.write(f"  model {m}: {'present' if m not in missing else 'MISSING'}")

        if missing and options["pull"]:
            provider = get_provider()
            for m in missing:
                self.stdout.write(f"Pulling {m} (this can take several minutes)...")
                ok, detail = provider.pull_model(m)
                if not ok:
                    raise CommandError(f"Pull of {m} failed: {detail}")
                self.stdout.write(self.style.SUCCESS(f"  pulled {m}"))
            reset_health_cache()
            status = health(force=True, timeout=options["timeout"])
            missing = [m for m in wanted if not status.model_present(m)]

        if missing:
            raise CommandError("Missing models: " + ", ".join(missing) + ". Run `ollama pull <model>` or re-run with --pull.")

        if options["smoke"]:
            self.stdout.write("Running smoke generation...")
            result = AIGateway().generate(
                purpose="smoke", system_prompt="Reply with JSON only.",
                user_prompt='Return {"greeting": "hello", "number": 7}.', schema=SMOKE_SCHEMA, temperature=0.0)
            if result.failed:
                raise CommandError(f"Smoke generation failed: {result.error_code}: {result.error}")
            self.stdout.write(self.style.SUCCESS(
                f"  ok in {result.latency_ms} ms after {result.attempts} attempt(s): {result.data}"))

        self.stdout.write(self.style.SUCCESS("AI ready."))
