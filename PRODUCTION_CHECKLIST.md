# Production checklist

Everything in this list was verified against this exact tree. The commands
are the ones to re-run after any change; the decisions are the ones an
operator has to make before real students use the system.

## Verified in this release

| Check | Command | Result |
| --- | --- | --- |
| Backend unit and integration suite | `python manage.py test` | 296 pass |
| Migrations match the models | `python manage.py makemigrations --check --dry-run` | no changes |
| Production settings | `python manage.py check --deploy --fail-level ERROR` | clean |
| API schema matches the code | `python manage.py spectacular --file openapi.yaml` then diff | in sync (152 routes) |
| Three-portal black-box walk, including AI outage | `python scripts/system_test.py <url> --fake-ollama <url>` | 194 pass |
| Role-by-role acceptance walk | `python scripts/acceptance.py <url>` | pass |
| Frontend types | `npm run typecheck` | clean |
| Frontend lint | `npm run lint` | clean (2 warnings) |
| Web build | `npm run export:web` | builds |
| AI monitor validators | `python manage.py monitor_benchmark` | 100% precision and recall on 18 labelled cases |

Run the two server suites with `AI_MONITOR_MODE=off`: they count calls to the
stand-in model, and the monitor's judge calls would skew that count. The unit
suite forces sync mode itself and ignores the variable.

## Before real users

1. **Create `backend/.env` from `backend/.env.production.example`.** It ships
   with a freshly generated `DJANGO_SECRET_KEY`; generate your own if this
   file has ever been shared. Never commit `.env`.
2. **Change `INITIAL_USER_PASSWORD`** from the placeholder. Every imported
   account starts on it and is forced to change it at first login, but until
   they do, anyone who knows the value can log in as them.
3. **Set `DJANGO_ALLOWED_HOSTS`** to the server's hostname or IP. `*` is
   acceptable on a closed campus network, not on the public internet.
4. **Serve over TLS** if the app leaves the local network: put nginx or Caddy
   in front (`deploy/nginx.conf`), or use the Docker Compose stack. JWTs and
   passwords must not cross an untrusted network in plain HTTP.
5. **Download the models** (`python manage.py fetch_model --docling`) and
   confirm `GET /api/health/?full=1` reports `offline_mode: READY`.
6. **Decide on the monitor's judge.** Under 16 GB of RAM, leave
   `AI_MONITOR_MODEL_FILE` commented out so the judge shares the application
   model. See `docs/AI_MONITORING.md` for the trade-off.
7. **Schedule maintenance.** The systemd timer and the Compose maintenance
   loop already run `requeue_stuck_documents`, `flushexpiredtokens` and
   `monitor_ai --purge` every 15 minutes. On a bare `run_localmind.py` install
   there is no scheduler: run those three by hand or add a Task Scheduler job.
8. **Back up** `db.sqlite3` (or the PostgreSQL database) and `media/`
   together. They are only consistent as a pair.

## Known limits

- One model, one generation at a time. Concurrent AI requests queue rather
  than run in parallel; see the concurrency note in `docs/DEPLOYMENT.md`.
- The AI monitor's judge shares that queue. During a class, either accept the
  wait or set `AI_MONITOR_JUDGE_ENABLED=false` and run
  `monitor_ai --backfill --judge` afterwards.
- Faculty have the monitoring API but no dedicated screen; admins have the
  full AI Monitor console.
- Incident trends are served as numbers (`/api/admin/monitor/trends/`) and
  not yet drawn as a chart.
