export type Role = "admin" | "faculty" | "student";

export interface Profile {
  employee_id?: string; department?: string; designation?: string; phone?: string;
  roll_number?: string; program?: string; batch?: string;
}
export interface User {
  id: string; email: string; full_name: string; role: Role;
  status: "active" | "discontinued" | "locked"; must_change_password: boolean;
  profile?: Profile | null; created_at?: string;
}
export interface LoginResponse {
  access: string; refresh: string; user: User; must_change_password: boolean; session_id: string | null;
}
export interface Paginated<T> { count: number; next: string | null; previous: string | null; results: T[] }

export interface Subject {
  id: string; name: string; code: string; description?: string;
  status: "active" | "discontinued" | "archived"; created_at?: string;
}
export type ModuleAvailability = "locked" | "open";
export type ProgressStatus = "not_started" | "in_progress" | "completed" | "needs_review";
export interface Progress {
  status: ProgressStatus; best_quiz_percentage: number | null; quiz_attempts: number; learning_seconds: number;
}
export interface ModuleBrief {
  id: string; title: string; order: number; availability: ModuleAvailability; source_missing?: boolean;
  start_page?: number | null; end_page?: number | null; progress?: Progress | null;
}
export interface ModuleFull extends ModuleBrief {
  chapter_id: string; source_text: string; source_heading_index?: number | null; is_user_edited?: boolean;
  document_title?: string; chapter_title?: string;
}
export interface Chapter { id: string; title: string; order: number; modules: ModuleBrief[]; status?: string }
export type DocumentStatus = "uploaded" | "processing" | "under_review" | "ready" | "published" | "unpublished" | "archived" | "error";
export interface Document {
  id: string; title: string; original_name: string; subject_id: string; subject_code?: string; status: DocumentStatus;
  file_type: string; file_size?: number; error_message?: string; content_version: number;
  chapter_count?: number; module_count?: number; missing_source_modules?: number; outline_source?: string;
  uploaded_by_name?: string; created_at: string; published_at?: string | null;
}
export interface DocumentTree { id: string; title: string; subject_id: string; content_version: number; chapters: Chapter[] }
export interface Heading { index: number; level: number; title: string; start_page?: number; end_page?: number }
export interface OutlineModule {
  id?: string; title: string; order: number; source_heading_index: number | null; source_text?: string;
  source_missing?: boolean; availability?: ModuleAvailability;
}
export interface OutlineChapter { id?: string; title: string; order: number; source_heading_index?: number | null; modules: OutlineModule[] }
export interface Outline { document_id: string; status: DocumentStatus; content_version: number; headings: Heading[]; outline_source?: string; document_title: string; chapters: OutlineChapter[] }

export interface QuizOption { key: string; text: string }
export interface Question {
  id: string; type: "mcq" | "subjective"; question: string; options?: QuizOption[];
  correct_answer?: string; explanation?: string; expected_rubric?: string; source_reference?: string;
}
export interface Quiz {
  id: string; title: string; instructions?: string; kind: "module" | "chapter"; subject_id: string; module_id: string | null;
  chapter_id: string | null; status: "draft" | "published" | "closed" | "superseded"; generator: "ai" | "fallback" | "manual";
  pass_percentage: number; max_attempts: number; time_limit_minutes: number | null; available_from: string | null; due_at: string | null;
  version: number; question_count?: number; attempt_count?: number; questions?: Question[];
  attempts_used?: number; best_percentage?: number | null; passed?: boolean | null; created_by_name?: string; created_at: string;
}
export interface DetailedResult {
  question_id: string; type: "mcq" | "subjective"; question: string; selected_option?: string; correct_option?: string;
  student_answer?: string; is_correct: boolean | null; score_awarded: number | null; explanation?: string; feedback?: string; missing_points?: string[];
}
export interface Attempt {
  id: string; assessment_id: string; assessment_title?: string; student_id?: string; student_email?: string; attempt_number: number;
  status: "in_progress" | "submitted" | "pending_evaluation" | "evaluated"; started_at: string; submitted_at: string | null;
  time_taken_seconds: number; score: number | null; total_questions: number; percentage: number | null; passed: boolean | null;
  detailed_results: DetailedResult[];
}
export interface StartAttempt { attempt_id: string; attempt_number: number; started_at: string; resumed: boolean; time_limit_minutes: number | null; questions: Question[] }

export interface RubricItem { criterion: string; points: number }
export interface Assignment {
  id: string; title: string; description?: string; instructions?: string; subject_id: string; module_id: string | null; chapter_id: string | null;
  rubric: RubricItem[]; max_score: number; generator: string; status: "draft" | "published" | "closed";
  available_from: string | null; due_at: string | null; allow_late: boolean; allow_resubmission: boolean;
  submission_count?: number; my_submission?: Submission | null; created_at: string;
}
export interface Submission {
  id: string; assignment_id: string; assignment_title?: string; student_id?: string; student_email?: string; attempt_number: number;
  content: string; submitted_at: string; is_late: boolean; time_spent_seconds: number; status: "submitted" | "evaluated" | "returned";
  score: number | null; feedback: string; rubric_scores: { criterion: string; points: number }[]; evaluated_at: string | null;
}

export interface LessonSection { heading: string; explanation: string; source_reference: string }
export interface Lesson { title: string; learning_objectives: string[]; sections: LessonSection[]; key_terms: { term: string; definition: string }[]; summary: string }
export interface TeachResponse { module_id: string; lesson: Lesson; generator: "ai" | "fallback"; cached: boolean; ai_error?: string }
export interface Message { id: string; role: "user" | "assistant"; content: string; grounded: boolean; source_reference: string; created_at: string }
export interface AskResponse { conversation_id: string; message: Message; follow_up_suggestions: string[] }
export interface Conversation { id: string; module_id: string; title: string; last_message_at: string | null; messages?: Message[] }

export interface AuditLog { id: string; actor_email: string; actor_role: string; action: string; target_type: string; target_id: string; target_label: string; summary: Record<string, unknown>; created_at: string }
export interface ImportReport { total_rows: number; created: number; already_existing: number; invalid: number; errors: { row: number; email?: string; error: string }[] }

export interface AIModelStatus { name: string; present: boolean }
export interface AIStatus {
  enabled: boolean; provider: string; reachable: boolean; ready: boolean;
  tutor_model: AIModelStatus; outline_model: AIModelStatus; error: string;
}
