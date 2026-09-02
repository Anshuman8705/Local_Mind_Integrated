# LocalMind Environment Configuration

All configuration is read from environment variables by `backend/config/env.py`. When a `.env` file exists in `backend/`, it is loaded first, and real environment variables override it. `backend/.env.example` is a complete annotated starting point; copy it to `.env` and never commit the copy.

Boolean variables accept `true`, `1`, `yes`, `on` (case-insensitive); anything else is false. List variables are comma-separated.

## Core

| Variable | Default | Notes |
|---|---|---|
| `DJANGO_SECRET_KEY` | none | Required whenever `DJANGO_DEBUG` is false; the application refuses to start without it. Use at least 50 random characters. Rotating it invalidates every issued JWT. |
| `DJANGO_DEBUG` | `false` | Never true in production. Enables detailed error pages, serving of media by Django, and the `seed_demo` command. |
| `DJANGO_ALLOWED_HOSTS` | `127.0.0.1,localhost` | Hostnames the server answers to. |
| `DJANGO_CORS_ALLOWED_ORIGINS` | `http://localhost:8081` | Exact origins the mobile or web client runs from. Credentials mode is off; tokens travel in the Authorization header. |
| `LOG_LEVEL` | `INFO` | Root and `localmind` logger level. |

## Database

| Variable | Default | Notes |
|---|---|---|
| `DATABASE_URL` | `sqlite:///<backend>/db.sqlite3` | Any `dj-database-url` string. Production: `postgres://user:password@host:5432/localmind`. Connections are kept open for 60 seconds. |

## Media and uploads

| Variable | Default | Notes |
|---|---|---|
| `MEDIA_ROOT` | `<backend>/media` | Where uploaded books and parsed markdown live. Must be writable and persistent. |
| `MEDIA_URL` | `/media/` | Only served by Django when debugging; in production the web server serves this path, or it is not exposed at all (the API never needs clients to fetch raw files). |
| `MAX_UPLOAD_MB` | `100` | Maximum book size; also sets Django's request body limit. |
| `PROCESS_DOCUMENTS_INLINE` | `false` | When true, `process/` blocks until parsing finishes. Useful for single-user setups and debugging; leave false for multi-user servers so uploads return immediately. |

## Accounts and sessions

| Variable | Default | Notes |
|---|---|---|
| `INITIAL_USER_PASSWORD` | `Welcome@LocalMind1` | Password given to every newly created or reset account. Must satisfy Django's validators. Change it per deployment. |
| `ACCESS_TOKEN_MINUTES` | `60` | Access token lifetime. |
| `REFRESH_TOKEN_DAYS` | `7` | Refresh token lifetime; refresh rotates and blacklists. |
| `SESSION_HEARTBEAT_TIMEOUT_MINUTES` | `10` | An application session with no heartbeat for this long is closed at its last heartbeat. Set it a little above the client's heartbeat interval. |

## Learning rules

| Variable | Default | Notes |
|---|---|---|
| `FACULTY_CAN_PUBLISH` | `true` | When false, faculty may mark a book ready but only administrators can publish (`PUBLISH_ADMIN_ONLY`). |
| `DEFAULT_PASS_PERCENTAGE` | `65` | Pass mark applied when a quiz does not set its own. |
| `MAX_QUIZ_DURATION_HOURS` | `6` | Upper bound on server-computed attempt time, so an abandoned tab does not record days. |

## AI

| Variable | Default | Notes |
|---|---|---|
| `AI_ENABLED` | `true` | Master switch. When false every AI-dependent feature uses its fallback (source-hierarchy outlines, placeholder quizzes that cannot be published, deterministic lessons) and free-form questions return `AI_UNAVAILABLE`. Always forced false under the test runner. |
| `AI_PROVIDER` | `ollama` | Only `ollama` is implemented; the gateway is the place to add another. |
| `OLLAMA_BASE_URL` | `http://127.0.0.1:11434` | |
| `OLLAMA_TUTOR_MODEL` | `qwen3:1.7b` | Used for lessons, questions, subjective evaluation and remediation. |
| `OLLAMA_OUTLINE_MODEL` | `qwen3:1.7b` | Used for outline and question generation; a larger model here improves structure quality at the cost of processing time. |
| `OLLAMA_TIMEOUT_SECONDS` | `90` | Per-call timeout; a timeout is reported as `error_code: timeout` and triggers the fallback. |

## Production security (applied only when DJANGO_DEBUG is false)

| Variable | Default | Notes |
|---|---|---|
| `SESSION_COOKIE_SECURE` | `true` | Only relevant to the Django admin site. |
| `CSRF_COOKIE_SECURE` | `true` | Same. |
| `SECURE_SSL_REDIRECT` | `false` | Set true when Django itself terminates TLS; leave false behind a reverse proxy that already redirects. |

HSTS, `X-Content-Type-Options` and the proxy SSL header are enabled unconditionally in production settings.

## A minimal production `.env`

```
DJANGO_SECRET_KEY=<long random string>
DJANGO_DEBUG=false
DJANGO_ALLOWED_HOSTS=lms.example.edu
DJANGO_CORS_ALLOWED_ORIGINS=https://app.example.edu
DATABASE_URL=postgres://localmind:<password>@127.0.0.1:5432/localmind
MEDIA_ROOT=/var/lib/localmind/media
INITIAL_USER_PASSWORD=<department policy>
OLLAMA_BASE_URL=http://127.0.0.1:11434
OLLAMA_TUTOR_MODEL=qwen3:4b
OLLAMA_OUTLINE_MODEL=qwen3:8b
```
