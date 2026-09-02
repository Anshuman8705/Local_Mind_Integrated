import sys
from datetime import timedelta
from pathlib import Path

import dj_database_url

from .env import BASE_DIR, env_bool, env_int, env_list, env_str

TESTING = "test" in sys.argv[1:2]
PROCESS_DOCUMENTS_INLINE = env_bool("PROCESS_DOCUMENTS_INLINE", False)

SECRET_KEY = env_str("DJANGO_SECRET_KEY", "")
DEBUG = env_bool("DJANGO_DEBUG", False)

if not SECRET_KEY:
    if DEBUG or TESTING:
        SECRET_KEY = "insecure-development-only-secret-key"
    else:
        raise RuntimeError("DJANGO_SECRET_KEY must be set when DEBUG is false.")

ALLOWED_HOSTS = env_list("DJANGO_ALLOWED_HOSTS", "127.0.0.1,localhost")
if TESTING:
    ALLOWED_HOSTS.append("testserver")

INSTALLED_APPS = [
    "django.contrib.admin",
    "django.contrib.auth",
    "django.contrib.contenttypes",
    "django.contrib.sessions",
    "django.contrib.messages",
    "django.contrib.staticfiles",
    "corsheaders",
    "rest_framework",
    "rest_framework_simplejwt.token_blacklist",
    "drf_spectacular",
    "core",
    "accounts",
    "academics",
    "audit",
    "documents",
    "learning",
    "assessments",
    "assignments",
    "tutor",
    "activity",
    "analytics",
]

MIDDLEWARE = [
    "django.middleware.security.SecurityMiddleware",
    "django.contrib.sessions.middleware.SessionMiddleware",
    "corsheaders.middleware.CorsMiddleware",
    "django.middleware.common.CommonMiddleware",
    "django.middleware.csrf.CsrfViewMiddleware",
    "django.contrib.auth.middleware.AuthenticationMiddleware",
    "django.contrib.messages.middleware.MessageMiddleware",
    "django.middleware.clickjacking.XFrameOptionsMiddleware",
]

ROOT_URLCONF = "config.urls"
WSGI_APPLICATION = "config.wsgi.application"

TEMPLATES = [
    {
        "BACKEND": "django.template.backends.django.DjangoTemplates",
        "DIRS": [],
        "APP_DIRS": True,
        "OPTIONS": {
            "context_processors": [
                "django.template.context_processors.request",
                "django.contrib.auth.context_processors.auth",
                "django.contrib.messages.context_processors.messages",
            ],
        },
    },
]

DATABASES = {
    "default": dj_database_url.parse(
        env_str("DATABASE_URL", f"sqlite:///{BASE_DIR / 'db.sqlite3'}"),
        conn_max_age=600,
    )
}

AUTH_USER_MODEL = "accounts.User"

AUTH_PASSWORD_VALIDATORS = [
    {"NAME": "django.contrib.auth.password_validation.UserAttributeSimilarityValidator"},
    {"NAME": "django.contrib.auth.password_validation.MinimumLengthValidator", "OPTIONS": {"min_length": 10}},
    {"NAME": "django.contrib.auth.password_validation.CommonPasswordValidator"},
    {"NAME": "django.contrib.auth.password_validation.NumericPasswordValidator"},
]

LANGUAGE_CODE = "en-us"
TIME_ZONE = "UTC"
USE_I18N = True
USE_TZ = True

STATIC_URL = "static/"
STATIC_ROOT = BASE_DIR / "staticfiles"
MEDIA_URL = env_str("MEDIA_URL", "/media/")
MEDIA_ROOT = Path(env_str("MEDIA_ROOT", str(BASE_DIR / "media"))).resolve()

DEFAULT_AUTO_FIELD = "django.db.models.BigAutoField"

REST_FRAMEWORK = {
    "DEFAULT_AUTHENTICATION_CLASSES": [
        "rest_framework_simplejwt.authentication.JWTAuthentication",
    ],
    "DEFAULT_PERMISSION_CLASSES": [
        "rest_framework.permissions.IsAuthenticated",
        "core.permissions.AccountActive",
        "core.permissions.PasswordChangeCompleted",
    ],
    "DEFAULT_RENDERER_CLASSES": ["rest_framework.renderers.JSONRenderer"],
    "DEFAULT_PAGINATION_CLASS": "core.pagination.StandardPagination",
    "PAGE_SIZE": 25,
    "EXCEPTION_HANDLER": "core.exceptions.exception_handler",
    "DEFAULT_SCHEMA_CLASS": "drf_spectacular.openapi.AutoSchema",
    "DEFAULT_THROTTLE_CLASSES": ["rest_framework.throttling.ScopedRateThrottle"],
    "DEFAULT_THROTTLE_RATES": {"login": "20/min", "ai": "60/min"},
}

SIMPLE_JWT = {
    "ACCESS_TOKEN_LIFETIME": timedelta(minutes=env_int("ACCESS_TOKEN_MINUTES", 60)),
    "REFRESH_TOKEN_LIFETIME": timedelta(days=env_int("REFRESH_TOKEN_DAYS", 7)),
    "ROTATE_REFRESH_TOKENS": True,
    "BLACKLIST_AFTER_ROTATION": True,
    "AUTH_HEADER_TYPES": ("Bearer",),
    "USER_ID_FIELD": "id",
    "USER_ID_CLAIM": "user_id",
}

SPECTACULAR_SETTINGS = {
    "TITLE": "LocalMind API",
    "DESCRIPTION": "Role-based academic learning platform with source-grounded AI tutoring.",
    "VERSION": "1.0.0",
    "SERVE_INCLUDE_SCHEMA": False,
    "SCHEMA_PATH_PREFIX": r"/api/",
    "POSTPROCESSING_HOOKS": ["core.openapi.unique_operation_ids"],
    "TAGS": [{"name": "auth"}, {"name": "admin"}, {"name": "faculty"}, {"name": "student"}],
}

CORS_ALLOWED_ORIGINS = env_list("DJANGO_CORS_ALLOWED_ORIGINS", "http://localhost:8081")
CORS_ALLOW_CREDENTIALS = False

if not DEBUG:
    SECURE_CONTENT_TYPE_NOSNIFF = True
    SECURE_BROWSER_XSS_FILTER = True
    X_FRAME_OPTIONS = "DENY"
    SESSION_COOKIE_SECURE = env_bool("SESSION_COOKIE_SECURE", True)
    CSRF_COOKIE_SECURE = env_bool("CSRF_COOKIE_SECURE", True)
    SECURE_SSL_REDIRECT = env_bool("SECURE_SSL_REDIRECT", False)

DATA_UPLOAD_MAX_MEMORY_SIZE = env_int("MAX_UPLOAD_MB", 100) * 1024 * 1024
FILE_UPLOAD_MAX_MEMORY_SIZE = 5 * 1024 * 1024

# LocalMind domain settings
LOCALMIND = {
    "MAX_UPLOAD_MB": env_int("MAX_UPLOAD_MB", 100),
    "ALLOWED_UPLOAD_EXTENSIONS": {".pdf", ".docx", ".doc"},
    "INITIAL_USER_PASSWORD": env_str("INITIAL_USER_PASSWORD", "Welcome@LocalMind1"),
    "FACULTY_CAN_PUBLISH": env_bool("FACULTY_CAN_PUBLISH", True),
    "SESSION_HEARTBEAT_TIMEOUT_MINUTES": env_int("SESSION_HEARTBEAT_TIMEOUT_MINUTES", 10),
    "MAX_QUIZ_DURATION_HOURS": env_int("MAX_QUIZ_DURATION_HOURS", 6),
    "DEFAULT_PASS_PERCENTAGE": env_int("DEFAULT_PASS_PERCENTAGE", 65),
}

AI = {
    "ENABLED": env_bool("AI_ENABLED", True) and not TESTING,
    "PROVIDER": env_str("AI_PROVIDER", "ollama"),
    "OLLAMA_BASE_URL": env_str("OLLAMA_BASE_URL", "http://127.0.0.1:11434"),
    "TUTOR_MODEL": env_str("OLLAMA_TUTOR_MODEL", "qwen3:1.7b"),
    "OUTLINE_MODEL": env_str("OLLAMA_OUTLINE_MODEL", "qwen3:1.7b"),
    "TIMEOUT_SECONDS": env_int("OLLAMA_TIMEOUT_SECONDS", 90),
}

if TESTING:
    PASSWORD_HASHERS = ["django.contrib.auth.hashers.MD5PasswordHasher"]

LOGGING = {
    "version": 1,
    "disable_existing_loggers": False,
    "formatters": {
        "standard": {"format": "%(asctime)s %(levelname)s %(name)s: %(message)s"},
    },
    "handlers": {
        "console": {"class": "logging.StreamHandler", "formatter": "standard"},
    },
    "root": {"handlers": ["console"], "level": env_str("LOG_LEVEL", "INFO")},
    "loggers": {
        "django.request": {"level": "ERROR" if TESTING else "WARNING", "propagate": True},
        "localmind": {"level": env_str("LOG_LEVEL", "INFO"), "propagate": True},
    },
}
