# LocalMind Database

Every application table extends `TimeStampedUUIDModel`: a UUID primary key `id`, and `created_at` / `updated_at` timestamps. Those three columns are omitted from the field lists below. Foreign keys are named for the model they reference; the column in the database is `<name>_id`. `PROTECT` means the referenced row cannot be deleted while this row exists; `SET_NULL` means the link is cleared; `CASCADE` means this row is deleted with its parent. Deletion is rare in practice because almost everything uses a status column instead.

The schema is identical on SQLite and PostgreSQL. JSON columns are `JSONField`, which maps to `jsonb` on PostgreSQL. Migrations for all thirteen apps are committed; `python manage.py migrate` creates 31 tables (including Django's auth, sessions, content types and the JWT blacklist).

## Entity relationships

```
User 1──* FacultySubject *──1 Subject 1──* Enrollment *──1 User
                                 │
                                 1──* Document 1──* Chapter 1──* Module
                                 │                                 │
                                 1──* Assessment ─────────────────┤ (module or chapter)
                                 1──* Assignment ─────────────────┤
                                                                   1──* ModuleProgress *──1 User
                                                                   1──* ModuleLesson
                                                                   1──* Conversation 1──* Message
Assessment 1──* AssessmentAttempt *──1 User
Assignment 1──* AssignmentSubmission *──1 User
User 1──* ApplicationSession
User 1──* ActivityEvent (optional Subject, Module)
User 1──* AuditLog (actor)
```

## accounts

### accounts_user

Custom user model (`AUTH_USER_MODEL = accounts.User`), email login, no username.

| Field | Type | Notes |
|---|---|---|
| email | varchar, unique | login identifier, stored lowercase |
| full_name | varchar | |
| role | varchar | `admin`, `faculty`, `student`; indexed |
| status | varchar | `active`, `discontinued`, `locked`; indexed |
| must_change_password | bool | true on creation and after admin reset |
| password_changed_at | datetime, null | |
| discontinued_at | datetime, null | |
| created_by | FK User, SET_NULL | the admin who created the account |
| organization_key | varchar | reserved for multi-tenant partitioning; empty today |
| password, last_login, is_superuser, groups, user_permissions | | Django internals; `is_active` and `is_staff` are properties derived from `status` and `role` |

### accounts_facultyprofile and accounts_studentprofile

One-to-one with `User` (primary key is `user_id`). Faculty: `employee_id`, `department`, `designation`, `phone`. Student: `roll_number`, `program`, `batch`, `phone`. All optional strings.

## academics

### academics_subject

| Field | Type | Notes |
|---|---|---|
| name | varchar | |
| code | varchar, unique | uppercased on save |
| description | text | |
| status | varchar | `active`, `discontinued`, `archived` (terminal); indexed |
| created_by | FK User, SET_NULL | |
| discontinued_at, archived_at | datetime, null | |
| organization_key | varchar | reserved |

### academics_facultysubject

Unique on (`faculty`, `subject`). `faculty` FK User CASCADE, `subject` FK Subject CASCADE, `status` (`active`, `discontinued`), `assigned_by` FK User SET_NULL, `assigned_at`, `discontinued_at`. Re-assigning reuses the row and sets it active again.

### academics_enrollment

Unique on (`student`, `subject`). `student` FK User CASCADE, `subject` FK Subject CASCADE, `status` (`active`, `discontinued`, `completed`), `enrolled_at`, `discontinued_at`, `completed_at`, `created_by` FK User SET_NULL.

## audit

### audit_auditlog

`actor` FK User SET_NULL plus snapshotted `actor_email` and `actor_role` so the row stays meaningful if the user changes; `action` (dotted verb such as `document.publish`), `target_type`, `target_id`, `target_label`, `summary` JSON with password and token keys scrubbed, `ip_address`. Indexed on (`action`, `created_at`) and (`target_type`, `target_id`).

## documents

### documents_document

| Field | Type | Notes |
|---|---|---|
| subject | FK Subject, PROTECT | |
| uploaded_by | FK User, SET_NULL | |
| title | varchar | defaults to the file name without extension |
| original_name | varchar | |
| file | file | stored at `documents/<id>/original.<ext>` under MEDIA_ROOT |
| file_type | varchar | `pdf`, `docx`, `doc` |
| file_size | bigint | |
| status | varchar | `uploaded`, `processing`, `under_review`, `ready`, `published`, `unpublished`, `archived`, `error`; indexed |
| processed_markdown_path | varchar | relative path of the parsed markdown |
| extracted_headings | JSON | `[{"index", "level", "title", "start_page", "end_page"}]` from the parser |
| outline_source | varchar | `ai`, `source_hierarchy`, `edited` |
| parse_mode | varchar | parser mode used |
| error_message | text | populated when status is `error` |
| processing_started_at, processed_at, reviewed_at, published_at, unpublished_at, archived_at | datetime, null | |
| reviewed_by, published_by, last_edited_by | FK User, SET_NULL | |
| content_version | int | incremented on any text edit; lessons cache against it |
| last_edited_at | datetime, null | |

Indexed on (`subject`, `status`).

## learning

### learning_chapter

`document` FK Document CASCADE, `title`, `order` (unique per document), `source_heading_index` (null when user-created), `source_text`, `start_page`, `end_page`, `is_user_edited`.

### learning_module

`chapter` FK Chapter CASCADE, `title`, `order` (unique per chapter), `source_heading_index`, `source_text`, `source_missing` (true when no section could be resolved; blocks publish and open), `start_page`, `end_page`, `is_user_edited`, `availability` (`locked`, `open`; indexed), `opened_by` FK User SET_NULL, `opened_at`.

### learning_moduleprogress

Unique on (`student`, `module`). `status` (`not_started`, `in_progress`, `completed`, `needs_review`), `started_at`, `completed_at`, `last_viewed_at`, `best_quiz_percentage` float null, `quiz_attempts` int, `learning_seconds` int, `overridden_by` FK User SET_NULL (set when faculty change the status by hand).

## assessments

### assessments_assessment

| Field | Type | Notes |
|---|---|---|
| subject | FK Subject, PROTECT | denormalised from the module or chapter for scoping |
| chapter | FK Chapter, PROTECT, null | exactly one of chapter / module is set |
| module | FK Module, PROTECT, null | |
| kind | varchar | `module`, `chapter` |
| title, instructions | | |
| questions | JSON | private; `[{"id", "type", "question", "options", "correct_answer", "explanation", "expected_rubric", "source_reference"}]` |
| generator | varchar | `ai`, `fallback`, `manual` |
| status | varchar | `draft`, `published`, `closed`, `superseded`; indexed |
| pass_percentage | smallint | default from settings (65) |
| max_attempts | smallint | 0 means unlimited |
| time_limit_minutes | smallint, null | |
| available_from, due_at | datetime, null | |
| version | int | starts at 1 |
| supersedes | one-to-one Assessment, null | the previous version this row replaced |
| created_by | FK User, SET_NULL | |
| published_at, closed_at | datetime, null | |
| content_version_at_creation | int | the document's content_version when questions were generated |

### assessments_assessmentattempt

Unique on (`assessment`, `student`, `attempt_number`). `assessment` FK PROTECT (an assessment with attempts is never deleted, only superseded or closed), `student` FK CASCADE, `status` (`in_progress`, `submitted`, `pending_evaluation`, `evaluated`), `started_at`, `submitted_at`, `time_taken_seconds` (server computed), `submitted_answers` JSON, `score` float, `total_questions`, `percentage` float, `passed` bool null, `detailed_results` JSON (per question: correct, awarded, feedback), `evaluation_notes` JSON (AI or faculty notes), `evaluated_by` FK User SET_NULL, `evaluated_at`. Rows are never updated after evaluation except through faculty re-evaluation, which is audited.

## assignments

### assignments_assignment

`subject` FK PROTECT, optional `chapter` and `module` FK PROTECT, `created_by`, `title`, `description`, `instructions`, `rubric` JSON `[{"criterion", "points"}]` summing to `max_score`, `max_score` smallint, `generator`, `status` (`draft`, `published`, `closed`), `available_from`, `due_at`, `allow_late`, `allow_resubmission`, `published_at`, `closed_at`. Indexed on (`subject`, `status`).

### assignments_assignmentsubmission

Unique on (`assignment`, `student`, `attempt_number`). `content` text, `submitted_at`, `is_late`, `time_spent_seconds` (client-reported, clamped), `status` (`submitted`, `evaluated`, `returned`), `score` float null, `feedback`, `rubric_scores` JSON, `evaluated_by`, `evaluated_at`.

## tutor

### tutor_modulelesson

Cached structured lesson, unique on (`module`, `content_version`): `lesson` JSON, `generator` (`ai`, `fallback`), `model_name`. Shared across students because it depends only on source text.

### tutor_conversation and tutor_message

A conversation belongs to one student and one module (`title`, `last_message_at`; indexed on student and module). Messages: `role` (`user`, `assistant`), `content`, `grounded` bool, `source_reference`, `model_name`, `latency_ms`. Ordered by `created_at`.

## activity

### activity_applicationsession

`user` FK CASCADE, `login_at`, `last_heartbeat_at`, `logout_at` null, `ended_by` (`logout`, `timeout`, `relogin`), `duration_seconds` (server computed when closed), `user_agent`, `ip_address`. Indexed on (`user`, `logout_at`).

### activity_activityevent

`user` FK CASCADE, `kind` (`learning`, `quiz`, `assignment`, `tutor`; indexed), optional `subject` and `module` FK SET_NULL, `reference_id` (attempt, submission or conversation id as text), `seconds`, `occurred_at` (indexed). Indexed on (`user`, `kind`, `occurred_at`).

## Invariants the services enforce

A subject that is archived accepts no new documents, quizzes, assignments, assignments of faculty or enrollments. A document may only be published when every module has non-empty source text and `source_missing` is false. Once published, its chapter and module set is fixed; text may still change. A module referenced by any assessment, assignment, progress row or conversation cannot be deleted through the outline editor. An assessment with attempts is never edited in place; a new version is created. An attempt is written once at submission; later evaluation only fills evaluation fields. Session durations and attempt timings are never accepted from a client.

## Retention

Nothing is hard-deleted by the API. Users, subjects, enrollments and assignments are discontinued or archived; documents are archived and their files kept. `cleanup_media` finds media directories whose document row no longer exists (which can only happen through manual database work) and removes them on request.
