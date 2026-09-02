# LocalMind Deployment

This describes a single-server deployment, which is the intended shape: the API, PostgreSQL and Ollama on one Linux machine, with a reverse proxy in front. Nothing prevents splitting them across hosts later; the only coupling is the `DATABASE_URL` and `OLLAMA_BASE_URL` variables.

## Requirements

Python 3.12 or newer, PostgreSQL 14 or newer (tested on 16), Ollama with the chosen models pulled, and a reverse proxy such as nginx or Caddy for TLS. The parser depends on `docling`, which pulls PyTorch; allow a few GB of disk for its models on first run. A machine with 16 GB of RAM handles a small department comfortably with a 4B tutor model; the outline model runs only during book processing and can be larger.

## Installation

```bash
sudo useradd --system --home /opt/localmind --create-home localmind
sudo -u localmind bash
cd /opt/localmind
git clone <repository> app && cd app/backend
python3 -m venv .venv && source .venv/bin/activate
pip install --upgrade pip && pip install -r requirements.txt
cp .env.example .env    # then edit as described in ENVIRONMENT.md
```

Create the database and role:

```sql
CREATE ROLE localmind WITH LOGIN PASSWORD '<password>';
CREATE DATABASE localmind OWNER localmind;
```

Then:

```bash
python manage.py migrate
python manage.py collectstatic --noinput     # only for the Django admin site and Swagger UI assets
python manage.py bootstrap_admin --email admin@example.edu
```

The bootstrap admin receives the configured initial password and must change it at first login. Pull the models: `ollama pull qwen3:4b` (and whatever `OLLAMA_OUTLINE_MODEL` names).

## Running

Use gunicorn with a small number of workers. Document processing runs on a thread in the worker that accepted the request, so give workers a generous timeout for the (rare) inline case and prefer the background default:

```
[Unit]
Description=LocalMind API
After=network.target postgresql.service

[Service]
User=localmind
WorkingDirectory=/opt/localmind/app/backend
EnvironmentFile=/opt/localmind/app/backend/.env
ExecStart=/opt/localmind/app/backend/.venv/bin/gunicorn config.wsgi:application \
    --bind 127.0.0.1:8000 --workers 3 --threads 4 --timeout 300
Restart=always

[Install]
WantedBy=multi-user.target
```

With more than one worker, two things follow. First, a document being processed is locked by a database row lock, so two workers will not process the same book. Second, background threads live inside the worker process; if gunicorn recycles a worker mid-processing the document is left in `processing`. Faculty can simply call `process/` again, which re-claims it. For heavier use, replace the thread with a task queue (`documents.services.documents.run_processing(document_id)` is the unit of work).

Reverse proxy: forward `/api/` to gunicorn with `X-Forwarded-Proto` set, cap request bodies at `MAX_UPLOAD_MB`, and serve `/static/` from `STATIC_ROOT` if you use the admin site or Swagger UI. `/media/` need not be exposed at all; nothing in the client flow fetches raw files.

## Health and monitoring

`GET /api/health/` returns `{"status": "ok", "service": "LocalMind", "database": "ok"}` after a real database round trip and is safe to poll. Application logs go to stdout in the format `time level logger: message`; `django.request` warnings cover 4xx, errors cover 5xx, and `localmind.api` logs every unexpected exception with the view name. Watch for `AI_UNAVAILABLE` rates and `error_code: timeout` in gateway logs as the signal that the model host is overloaded.

## Backups

Back up the PostgreSQL database and `MEDIA_ROOT` together; the database references files by path. A nightly `pg_dump` plus an rsync of media is sufficient. Restore is `psql < dump`, copy media back, done; migrations are already applied in the dump.

## Upgrades

```bash
git pull && pip install -r requirements.txt && python manage.py migrate && sudo systemctl restart localmind
```

Migrations are additive and safe to run against a live database. Check `python manage.py check --deploy` after changing settings.

## Operations

`python manage.py cleanup_media` lists media directories no document row references; add `--delete` to remove them. `python manage.py seed_demo` populates a development database and refuses to run when `DJANGO_DEBUG` is false. Rotating `DJANGO_SECRET_KEY` logs every user out. Rotating `INITIAL_USER_PASSWORD` affects only accounts created or reset after the change.

## Running the suite against production PostgreSQL

`DATABASE_URL=postgres://... python manage.py test` creates and destroys a `test_localmind` database, so the role needs `CREATEDB`. The suite passes identically on SQLite and PostgreSQL; one PostgreSQL-only behaviour (`FOR UPDATE` cannot lock the nullable side of an outer join) is already accounted for in `assessments.services`.
