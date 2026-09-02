# LocalMind Backend Architecture

## Purpose and shape

LocalMind is a single Django project exposing one REST API for three kinds of user. The API is split into portals by URL prefix: `/api/auth/` for login and account maintenance, `/api/admin/` for administrators, `/api/faculty/` for faculty (administrators may also use it, since they manage every subject), and `/api/student/` for students. The prefix is enforced, not decorative: a token is honoured only on the portal for its role, so the same view mounted under two prefixes behaves as two distinct portal endpoints with two distinct audiences.

The project is a monolith on purpose. It targets a department-scale deployment, often on a single machine that also hosts the local language model, and the operational simplicity of one process, one database and one media directory outweighs the benefits of service decomposition at that scale. The code is nonetheless layered so the pieces that would move first if it ever grew (document parsing, AI calls, analytics) are already behind clean seams.

## Applications and dependencies

| App | Owns | Depends on |
|---|---|---|
| `core` | base model, error envelope, permissions, pagination, OpenAPI hook, test helpers | nothing |
| `accounts` | `User`, `FacultyProfile`, `StudentProfile`, login, password change, admin user management, Excel import | core, audit, activity, academics (for faculty subject assignment on create) |
| `academics` | `Subject`, `FacultySubject`, `Enrollment` and the scoping helpers every other app uses | core, accounts, audit |
| `audit` | `AuditLog` and the admin audit endpoint | core, accounts |
| `ai` | the provider-agnostic gateway | nothing (reads settings) |
| `documents` | `Document`, upload validation, parsing, outline generation, review, publishing | core, academics, learning, ai, audit |
| `learning` | `Chapter`, `Module`, `ModuleProgress`, student reading views | core, academics, documents |
| `assessments` | `Assessment`, `AssessmentAttempt`, generation, evaluation, versioning | core, academics, learning, ai, activity, audit |
| `assignments` | `Assignment`, `AssignmentSubmission` | core, academics, learning, ai, activity, audit |
| `tutor` | `ModuleLesson`, `Conversation`, `Message` | core, learning, assessments, ai, activity |
| `activity` | `ApplicationSession`, `ActivityEvent` | core, learning |
| `analytics` | read-only aggregation | every data app |

Dependencies point downward only. `learning` and `documents` reference each other at the model level (a chapter belongs to a document; a document's outline is chapters and modules) but `learning` never imports document services, which keeps the student-facing reading path free of upload and parsing concerns.

## Layering inside an app

Each app follows the same three layers. Views (`views.py` or `views_*.py`) are thin: they validate input with a serializer, call one service function, and return a serialized result. They never contain business rules and never build querysets beyond simple filters on a queryset a service has already scoped. Services (`services.py` or `services/`) hold every rule: who may do what, what state transitions are legal, what gets audited. They accept the acting user as the first argument and raise typed exceptions from `core.exceptions`. Models hold structure, choices, and the small set of query helpers that express scope, most importantly `SubjectQuerySet.visible_to(user)`.

The consequence is that the test suite exercises rules through HTTP with `APIClient` and a handful of factory helpers in `core.testing`, rather than testing services in isolation. That keeps tests honest about serialization and permissions, which is where regressions in this kind of application usually hide.

## Request lifecycle

A request passes through CORS handling, Django's security middleware, then DRF. Authentication is JWT via `djangorestframework-simplejwt`; the access token carries `user_id` and `role`, and the user row is loaded on every request so that a discontinued or locked account is refused immediately, not when its token expires. Three permission gates apply globally: `IsAuthenticated`, `AccountActive`, and `PasswordChangeCompleted`. The last one blocks every endpoint except those a view explicitly marks with `allow_password_change = True` (password change itself, me, logout, heartbeat) while `must_change_password` is set.

Role permissions (`IsAdmin`, `IsFaculty`, `IsStudent`, `IsAdminOrFaculty`) are added per view. They re-apply the account-state gates internally so that a view overriding `permission_classes` cannot accidentally drop them, and they check the portal prefix. Object-level access is not a permission class at all; it is the scoped queryset. A faculty member asking for a document they do not manage gets a 404, identical to a document that does not exist, because `Document.objects.visible_to(user)` never contained it. This is deliberate: existence is not leaked across scopes.

Errors, whether raised by services, by DRF validation, or unexpectedly, are converted by `core.exceptions.exception_handler` into a single envelope, `{"error": {"code", "message", "details?"}}`, with an HTTP status matching the exception type. Unexpected exceptions are logged with the view name and returned as `INTERNAL_ERROR` with no stack detail.

## Identity and roles

There is one `User` table with a `role` column and two optional profile tables. Login is role-specific: `POST /api/auth/login/faculty/` refuses an administrator's credentials with the same `INVALID_CREDENTIALS` response as a wrong password, so the login endpoint reveals nothing about which portal an email belongs to. Every user is created with the configured initial password and `must_change_password = true`. Passwords are validated by Django's validators, and reusing the current password is refused.

Discontinuing a user sets `status = discontinued`, records who and why in the audit log, and blacklists their outstanding refresh tokens. Their data stays; enrollments and assignments are left as they were so historical analytics remain truthful. Reactivation restores access without touching any of that.

## Academic scope

Three tables define who sees what. `Subject` is the unit of everything. `FacultySubject` says which faculty manage a subject; `Enrollment` says which students belong to it. Both are soft-state rows with `active` and `discontinued` statuses rather than deletable links, because a discontinued enrollment must still explain historical attempts and time.

`SubjectQuerySet.visible_to(user)` returns all subjects for an admin, actively assigned subjects for faculty, and actively enrolled subjects for a student. Every other scoped queryset in the codebase is built by joining through to this one, so the rule lives in exactly one place. Subjects have three states: `active`, `discontinued` (reversible), and `archived` (terminal; nothing may be created under it).

## Content pipeline

A faculty member uploads a PDF or Word file to a subject they manage. Upload validation checks extension, magic bytes and size before anything is stored. Processing is claimed under a row lock so two workers cannot process the same document, and runs either inline (tests, or `PROCESS_DOCUMENTS_INLINE=true`) or on a daemon thread. The parser (reused from the reference codebase) produces markdown plus an indexed list of sections keyed by heading index.

Outline generation asks the AI gateway for a chapter and module structure where every module names the integer `source_heading_index` it draws from. Any module whose index is missing, invalid or duplicated is discarded rather than fuzzy-matched; if the AI is unavailable or returns nothing usable, the document's own heading hierarchy becomes the outline. The document then sits in `under_review` for faculty to edit. Outline edits are reconciled by id: existing chapters and modules are updated in place, new ones created, and modules referenced by any quiz, assignment, progress row or conversation cannot be deleted (`MODULE_IN_USE`). This is the single most important difference from the reference implementation, which recreated the whole tree on every save and orphaned everything downstream.

Publishing validates that every module has source text (`MODULES_MISSING_SOURCE` otherwise) and locks the structure (`PUBLISHED_STRUCTURE_LOCKED` on further outline replacement), while still allowing text edits that bump `content_version`. Modules start `locked`; faculty open them one at a time, or per chapter. A locked module cannot be read by students and its quizzes cannot be started.

## Assessments

Quizzes belong to a module or a chapter. Questions live in a JSON column that is never sent to students in full: the student view strips `correct_answer`, `explanation` and rubrics. MCQ scoring is deterministic and server-side. Subjective answers are evaluated by the AI gateway against the question's rubric and source reference; when the gateway is unavailable the attempt is stored as `pending_evaluation` with its MCQ portion scored, and faculty can trigger re-evaluation or override scores later.

Attempts are immutable once submitted (`ALREADY_SUBMITTED` on a second submit) and are numbered per student. Time is server-computed from `started_at` and capped at the configured maximum; client-supplied timing is ignored. Editing a quiz that already has attempts creates a new version row that supersedes the old one, so historical attempts keep pointing at exactly the questions they answered. Publishing refuses quizzes whose questions are the placeholder set produced when generation fell back without AI.

Passing a module quiz marks the module `completed`; failing marks it `needs_review`; reading marks it `in_progress`. Faculty can override progress state.

## AI gateway

`ai.gateway.AIGateway.generate(purpose, system_prompt, user_prompt, schema, model_kind, ...)` is the only path to a language model anywhere in the codebase. It returns an `AIResult` with `ok`, `data`, `attempts`, `latency_ms` and an `error_code` from a fixed set (`disabled`, `unavailable`, `timeout`, `empty`, `truncated`, `malformed`, `invalid_schema`). The Ollama provider posts to `/api/chat` with a JSON schema in the `format` field, `think: false` (qwen3 is a reasoning model and the reasoning pass only adds latency to structured output), and explicit `num_ctx`, `num_predict` and `keep_alive` options; it strips any `<think>` block or markdown fence a small model wraps around the JSON, treats `done_reason == "length"` as `truncated`, and validates the reply against the schema before returning it. The gateway retries `empty`, `truncated`, `malformed` and `invalid_schema` once at temperature 0 with the rejection reason appended to the conversation; it never retries `timeout` or `unavailable`. The disabled provider returns `disabled` immediately. `ai.gateway.trim_source` is the one place source text is cut to the prompt budget (`AI_MAX_SOURCE_CHARS`, on a paragraph boundary), and `ai.gateway.health` is a cached probe of Ollama's `/api/tags` used by `/api/health/`, the admin dashboard and the `check_ai` management command.

The production model is `qwen3:1.7b` for every purpose. Prompts are written for a model that size: numbered rules, one task sentence, no examples the model could copy, and the schema does the structural work. Post-validation catches what the schema cannot: quiz options must be distinct, questions that repeat an earlier quiz on the same target are dropped, an assignment rubric must sum to `max_score`, an outline may only reference heading indices it was given, and a subjective answer the model marks correct while also listing missing rubric points is scored as incorrect. Callers decide what fallback is appropriate: outlines fall back to the source hierarchy, quiz generation to flagged placeholders, structured lessons to a deterministic summary of the source text, free-form questions to `AI_UNAVAILABLE` (503), since there is no honest fallback for an open question.

Every prompt is built server-side from the module's stored `source_text`. Clients never send source text, which closes the injection path the reference design left open.

## Sessions and time

Login opens an `ApplicationSession`; the client heartbeats it; logout closes it. Any open session without a heartbeat inside the timeout window is closed at its last heartbeat the next time that user logs in or heartbeats, so no scheduler is needed. A fresh login while another session is open closes the older one, so overlapping sessions never double count. Durations are computed server-side.

Time on task is recorded as `ActivityEvent` rows: learning time is client-reported in chunks and clamped to fifteen minutes per chunk; quiz and assignment time are server-derived. Analytics aggregate these rows by user, subject, module and kind.

## Analytics

`analytics.services` contains only read paths. Each function takes the acting user and returns data scoped exactly the way the rest of the API is scoped: a student sees only themselves, faculty see their subjects and may look at a student only through a subject they share, admins see everything. All time-stamped facts accept an optional `since`/`until` window; structural counts (enrollments, published modules) are point-in-time.

## Audit

`audit.services.record(actor, action, target, summary, request)` writes one row with actor identity snapshotted (so the log survives user changes), a target type and id, a JSON summary scrubbed of password and token keys, and the client IP. Every state-changing service call records one. The admin endpoint filters by action, target, actor and time.

## Configuration and environments

All configuration comes from environment variables through `config/env.py`, which also reads a local `.env` file when present. The settings module refuses to start without a secret key when `DEBUG` is false. `DATABASE_URL` selects SQLite or PostgreSQL. Under the test runner, AI is forced off and the fast MD5 password hasher is used.

## Known limits and next steps

Document processing runs on a thread inside the web process. For a single-server deployment this is adequate and keeps the operational footprint small, but a multi-worker deployment behind a load balancer should move `run_processing` to a task queue; the function is already the unit of work and takes only a document id. Token blacklisting relies on the database; for very large deployments a cache-backed denylist would be faster. Analytics queries are straightforward aggregations and will be fine to tens of thousands of attempts; beyond that, materialised per-subject summaries would be the next step.
