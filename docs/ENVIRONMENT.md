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
| `DATABASE_URL` | `sqlite:///<backend>/db.sqlite3` | Any `dj-database-url` string. Production: `postgres://user:password@host:5432/localmind`. Connections are kept open for 600 seconds. |
| `SQLITE_BUSY_TIMEOUT_SECONDS` | `30` | SQLite only. How long a writer waits for the database lock before failing. The SQLite database runs in WAL mode with `IMMEDIATE` transactions, so `db.sqlite3-wal` and `db.sqlite3-shm` appear next to the database file while the server runs; back up all three together, or stop the server first. |

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
| `PROCESSING_STALE_MINUTES` | `30` | A document still `processing` after this long is treated as abandoned by a recycled worker: the next `process/` call re-claims it and `manage.py requeue_stuck_documents` re-runs it. Large scanned PDFs on a slow CPU can legitimately take longer; raise this rather than lower it. |

## AI

| Variable | Default | Notes |
|---|---|---|
| `AI_ENABLED` | `true` | Master switch. When false every AI-dependent feature uses its fallback (source-hierarchy outlines, placeholder quizzes that cannot be published, deterministic lessons) and free-form questions return `AI_UNAVAILABLE`. Always forced false under the test runner. |
| `AI_PROVIDER` | `llamacpp` | `llamacpp` runs the model inside the backend from a local GGUF file (default; fully offline, nothing to install). `ollama` talks to a local Ollama daemon. The gateway is the place to add a cloud provider later. |
| `AI_MODEL_PATH` | *(empty)* | llamacpp: absolute path to the `.gguf`. When empty the file is `backend/models/<AI_MODEL_FILE>`. |
| `AI_MODEL_FILE` | `Qwen3-1.7B-Q4_K_M.gguf` | llamacpp: file name under `backend/models/`; validated (size, GGUF header) before loading. |
| `AI_MODEL_REPO` | `unsloth/Qwen3-1.7B-GGUF` | Hugging Face repo `manage.py fetch_model` downloads from, once, at packaging time. Never used at runtime. |
| `AI_THREADS` | `0` | llamacpp: inference threads; 0 = all cores but one. |
| `AI_GPU_LAYERS` | `0` | llamacpp: layers offloaded to a GPU when the wheel was built with CUDA/Metal. |
| `AI_BATCH` | `256` | llamacpp: prompt batch size. llama.cpp keeps a float32 logits buffer of this many rows by the 152k vocabulary (~150 MB at 256, ~300 MB at 512); raise only on machines with RAM to spare. |
| `AI_LOAD_RETRY_SECONDS` | `60` | llamacpp: after a transient load failure (out of memory while a document was being parsed) the model load is retried after this many seconds. |
| `DOCLING_ARTIFACTS` | `backend/models/docling` | Local Docling layout models (`fetch_model --docling`). When present the parser never downloads. |
| `SERVE_WEB` / `WEB_DIST` | `true` / `frontend/dist` | Serve the built web client from Django when the build exists (standalone mode). |
| `SERVE_MEDIA` | same as `SERVE_WEB` | Serve `/media/` from Django when there is no reverse proxy. |
| `OLLAMA_BASE_URL` | `http://127.0.0.1:11434` | Ollama provider only. |
| `OLLAMA_TUTOR_MODEL` | `qwen3:1.7b` | Used for lessons, free-form questions, quiz and assignment generation, subjective evaluation and remediation. Must match an `ollama list` entry exactly. |
| `OLLAMA_OUTLINE_MODEL` | `qwen3:1.7b` | Used only while a book is processed to group headings into chapters and modules. A larger model (`qwen3:4b`) improves structure quality at the cost of processing time; the default keeps a single model resident. |
| `OLLAMA_TIMEOUT_SECONDS` | `120` | Both providers (name kept for compatibility). Per-call timeout; for llamacpp it bounds the wait for a busy model, since a running generation cannot be interrupted; a timeout is reported as `error_code: timeout` and triggers the fallback. Keep this below the gunicorn worker timeout. |
| `OLLAMA_NUM_CTX` | `16384` | Both providers. Context window per call. Ollama's own default is 4096 tokens, which silently truncates the 14k-character source prompts this app sends. qwen3:1.7b supports 32k; do not go below 8192. |
| `OLLAMA_NUM_PREDICT` | `4096` | Both providers. Cap on generated tokens so a runaway completion cannot hold a worker until the timeout. A 10-question quiz or a full lesson fits well inside it. |
| `OLLAMA_KEEP_ALIVE` | `30m` | How long Ollama keeps the model loaded after a call, so the next student does not pay the load time. |
| `OLLAMA_MAX_RETRIES` | `1` | Both providers. Retries when the model returns empty, truncated, malformed or off-schema JSON. The retry runs at temperature 0 with the rejection reason in the prompt. Timeouts and connection errors are never retried. `0` disables. |
| `AI_MAX_SOURCE_CHARS` | `14000` | Character budget for source text embedded in a prompt, cut on a paragraph boundary. Roughly 4000 tokens; raise only together with `OLLAMA_NUM_CTX`. |
| `AI_HEALTH_CACHE_SECONDS` | `30` | How long `/api/health/` and the admin dashboard reuse the last AI readiness probe. |

## Production security (applied only when DJANGO_DEBUG is false)

| Variable | Default | Notes |
|---|---|---|
| `SESSION_COOKIE_SECURE` | `true` | Only relevant to the Django admin site. |
| `CSRF_COOKIE_SECURE` | `true` | Same. |
| `SECURE_SSL_REDIRECT` | `false` | Set true when Django itself terminates TLS; leave false behind a reverse proxy that already redirects. |
| `TRUST_PROXY_SSL_HEADER` | `true` | Honour `X-Forwarded-Proto: https` from the reverse proxy. Set false only if Django is exposed directly, otherwise a client could spoof the header. |
| `SECURE_HSTS_SECONDS` | `0` | Off by default because LAN deployments often run plain http. Set `31536000` once the site is https-only; includeSubDomains follows automatically. |
| `DJANGO_CSRF_TRUSTED_ORIGINS` | (empty) | Comma-separated `https://host` origins allowed to POST to the Django admin site through the proxy, e.g. `https://lms.example.edu`. The JSON API uses JWT and does not need this. |

`DJANGO_SECRET_KEY` must be at least 32 characters when `DJANGO_DEBUG` is false; startup refuses shorter keys. `X-Content-Type-Options: nosniff`, `X-Frame-Options: DENY` and a same-origin referrer policy are always on in production.

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
OLLAMA_TUTOR_MODEL=qwen3:1.7b
OLLAMA_OUTLINE_MODEL=qwen3:1.7b
OLLAMA_NUM_CTX=16384
OLLAMA_TIMEOUT_SECONDS=120
```
