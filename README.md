# LocalMind Backend

A role-based academic learning platform (backend plus an Expo client for iOS, Android and web): administrators manage people and subjects, faculty publish source material and author assessments, students learn from published modules with a source-grounded local AI tutor. Django 5.2, Django REST Framework, JWT authentication, PostgreSQL in production (SQLite for development), Ollama for AI with graceful fallback when it is unavailable.

## Quick start

```bash
cd backend
python3 -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
cp .env.example .env               # edit DJANGO_SECRET_KEY at minimum
python manage.py migrate
python manage.py bootstrap_admin --email admin@example.edu
ollama pull qwen3:1.7b             # the AI tutor model (Ollama 0.9+)
python manage.py check_ai --smoke  # proves Ollama and the model work before you start
python manage.py seed_demo         # optional demo data, DEBUG only
python manage.py runserver
```

Interactive API docs are at `http://127.0.0.1:8000/api/docs/` and the raw OpenAPI 3 schema at `/api/schema/`. Health check at `/api/health/`.

Every account is created with the configured `INITIAL_USER_PASSWORD` and must change it at first login before any other endpoint responds.

## Tests

```bash
python manage.py test                                    # SQLite, 145 tests
DATABASE_URL=postgres://user:pw@host:5432/db python manage.py test   # same suite on PostgreSQL
```

AI is disabled automatically under the test runner so the suite never depends on a running Ollama. Tests that need AI output mock the gateway.

Beyond the unit suite there is a black-box system test that drives a live server through every portal, endpoint, permission boundary and AI fallback over real HTTP (about 190 checks), using a stand-in Ollama so it runs on any machine:

```bash
python scripts/fake_ollama.py &                                  # speaks /api/tags, /api/pull, /api/chat
DJANGO_DEBUG=true python manage.py runserver 127.0.0.1:8011 &
python scripts/system_test.py http://127.0.0.1:8011 --fake-ollama http://127.0.0.1:11434
```

Point it at a server backed by real Ollama (omit `--fake-ollama`) for a pre-release check with the actual model; the AI-outage section is skipped in that mode.

## Client

```bash
cd frontend && npm install && EXPO_PUBLIC_API_URL=http://<backend-host>:8000 npx expo start
```

See `frontend/README.md` and `docs/FRONTEND.md`.

## Documentation

| Document | Contents |
|---|---|
| `docs/ARCHITECTURE.md` | Apps, layering, request lifecycle, permission model, AI gateway, background processing |
| `docs/API.md` | Portals, authentication, workflows, error envelope and code catalogue |
| `docs/DATABASE.md` | Every table and field, relationships, invariants, indexes |
| `docs/ENVIRONMENT.md` | Every environment variable with defaults and production guidance |
| `docs/DEPLOYMENT.md` | Production deployment (docker-compose or systemd), PostgreSQL, Ollama, media, operations |
| `deploy/` | docker-compose stack, nginx config, systemd units, maintenance timer |
| `docs/MIGRATION.md` | Relationship to the reference codebase and what changed |
| `docs/FRONTEND_INTEGRATION.md` | What a client must do: login, token handling, sessions, per-role screens |
| `docs/FRONTEND.md` | The Expo client: every screen and the endpoints behind it |
| `backend/openapi.yaml` | Generated OpenAPI 3 schema (142 operations) |
| `backend/samples/` | Excel import templates for faculty and students |

## Repository layout

```
frontend/        Expo app: app/ (routes by role), src/api, src/auth, src/ui
backend/
  config/        settings, env loading, URL mounting
  core/          shared models, exceptions, permissions, pagination, OpenAPI hook, test helpers
  accounts/      User, profiles, login, password change, admin user management, Excel import
  academics/     Subject, FacultySubject, Enrollment
  audit/         AuditLog and the admin audit endpoint
  ai/            provider-agnostic AI gateway (Ollama qwen3:1.7b, health probe, check_ai command)
  documents/     upload, parsing, outline generation and review, publishing
  learning/      Chapter, Module, ModuleProgress, student reading endpoints
  assessments/   quizzes, attempts, deterministic and AI evaluation, versioning
  assignments/   assignments, submissions, faculty evaluation
  tutor/         structured lessons, grounded Q&A, remediation
  activity/      application sessions, heartbeat, time on task
  analytics/     scoped metrics for student, faculty and admin
docs/            the documents listed above
```
