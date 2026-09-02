# LocalMind API image. docling pulls PyTorch, so the image is a few GB; that
# is the cost of local, offline document parsing and is expected.
FROM python:3.12-slim

ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1 PIP_NO_CACHE_DIR=1
RUN apt-get update && apt-get install -y --no-install-recommends build-essential libpq-dev curl \
    && rm -rf /var/lib/apt/lists/*

RUN useradd --system --create-home --home /app localmind
WORKDIR /app
COPY requirements.txt .
RUN pip install -r requirements.txt

COPY --chown=localmind:localmind . .
RUN mkdir -p /app/media /app/staticfiles && chown -R localmind:localmind /app
USER localmind

EXPOSE 8000
HEALTHCHECK --interval=30s --timeout=5s --start-period=60s \
    CMD curl -fsS http://127.0.0.1:8000/api/health/ || exit 1

# migrate + collectstatic run in the entrypoint so a fresh container is usable;
# check_ai gates on Ollama being ready with the models pulled.
COPY --chown=localmind:localmind deploy-entrypoint.sh /app/entrypoint.sh
ENTRYPOINT ["/app/entrypoint.sh"]
CMD ["gunicorn", "config.wsgi:application", "--bind", "0.0.0.0:8000", "--workers", "3", "--threads", "4", "--timeout", "300"]
