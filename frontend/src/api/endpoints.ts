import { api } from "./client";
import type * as T from "./types";

type Q = Record<string, string | number | undefined | null>;
const list = <X>(d: T.Paginated<X> | X[]): X[] => (Array.isArray(d) ? d : d.results);

export const auth = {
  login: (role: T.Role, email: string, password: string) =>
    api<T.LoginResponse>(`/auth/login/${role}/`, { method: "POST", body: { email, password }, auth: false }),
  me: () => api<T.User>("/auth/me/"),
  changePassword: (current_password: string, new_password: string) =>
    api<T.LoginResponse>("/auth/password/change/", { method: "POST", body: { current_password, new_password } }),
  heartbeat: (session_id: string | null) => api<{ session_id: string }>("/auth/heartbeat/", { method: "POST", body: { session_id } }),
  logout: (refresh: string, session_id: string | null) => api("/auth/logout/", { method: "POST", body: { refresh, session_id } }),
};

export const student = {
  subjects: () => api<T.Subject[]>("/student/subjects/").then(list),
  documents: (subjectId: string) => api<(T.Document & { open_module_count: number; completed_modules: number; progress_percent: number })[]>(`/student/subjects/${subjectId}/documents/`),
  document: (id: string) => api<T.DocumentTree>(`/student/documents/${id}/`),
  module: (id: string) => api<T.ModuleFull>(`/student/modules/${id}/`),
  reportTime: (moduleId: string, seconds: number) => api<{ learning_seconds: number }>(`/student/modules/${moduleId}/time/`, { method: "POST", body: { seconds } }),
  teach: (moduleId: string) => api<T.TeachResponse>(`/student/modules/${moduleId}/teach/`, { method: "POST" }),
  ask: (moduleId: string, question: string, conversation_id?: string) =>
    api<T.AskResponse>(`/student/modules/${moduleId}/ask/`, { method: "POST", body: { question, conversation_id } }),
  conversations: (module?: string) => api<T.Conversation[]>("/student/conversations/", { query: { module } }).then(list),
  conversation: (id: string) => api<T.Conversation>(`/student/conversations/${id}/`),
  quizzes: (q: Q = {}) => api<T.Quiz[]>("/student/quizzes/", { query: q }),
  startAttempt: (quizId: string) => api<T.StartAttempt>(`/student/quizzes/${quizId}/attempts/`, { method: "POST" }),
  submitAttempt: (attemptId: string, submitted_answers: Record<string, string>) =>
    api<T.Attempt>(`/student/quiz-attempts/${attemptId}/submit/`, { method: "POST", body: { submitted_answers } }),
  attempt: (id: string) => api<T.Attempt>(`/student/quiz-attempts/${id}/`),
  scores: (q: Q = {}) => api<T.Paginated<T.Attempt>>("/student/scores/", { query: q }).then(list),
  remediation: (attemptId: string) => api<{ overview: string; items: { question: string; explanation: string; source_reference?: string }[]; generator: string }>(`/student/quiz-attempts/${attemptId}/remediation/`, { method: "POST" }),
  assignments: (q: Q = {}) => api<T.Assignment[]>("/student/assignments/", { query: q }),
  submitAssignment: (id: string, content: string, time_spent_seconds: number) =>
    api<T.Submission>(`/student/assignments/${id}/submissions/`, { method: "POST", body: { content, time_spent_seconds } }),
  submissions: () => api<T.Paginated<T.Submission>>("/student/assignment-submissions/").then(list),
  overview: () => api<any>("/student/analytics/overview/"),
  subjectAnalytics: (id: string) => api<any>(`/student/analytics/subjects/${id}/`),
};

// Faculty portal; admins may use it too, so every manage screen calls these.
export const manage = {
  subjects: () => api<(T.Subject & { active_students: number; assignment_status: string })[]>("/faculty/subjects/"),
  subjectStudents: (id: string) => api<{ id: string; student_id: string; student_email: string; student_name: string; status: string; enrolled_at: string }[]>(`/faculty/subjects/${id}/students/`),
  enroll: (id: string, student_ids: string[]) => api<{ results: { student_id: string; status: string }[] }>(`/faculty/subjects/${id}/students/`, { method: "POST", body: { student_ids } }),
  discontinueEnrollment: (subjectId: string, studentId: string) => api(`/faculty/subjects/${subjectId}/students/${studentId}/discontinue/`, { method: "POST" }),
  searchStudents: (q: string) => api<{ id: string; email: string; full_name: string; roll_number: string }[]>("/faculty/students/search/", { query: { q } }),

  documents: (q: Q = {}) => api<T.Paginated<T.Document>>("/faculty/documents/", { query: q }).then(list),
  document: (id: string) => api<T.Document>(`/faculty/documents/${id}/`),
  upload: (form: FormData) => api<T.Document>("/faculty/documents/", { method: "POST", form }),
  process: (id: string) => api<T.Document>(`/faculty/documents/${id}/process/`, { method: "POST" }),
  outline: (id: string) => api<T.Outline>(`/faculty/documents/${id}/outline/`),
  saveOutline: (id: string, chapters: T.OutlineChapter[], document_title?: string) =>
    api<T.Document>(`/faculty/documents/${id}/outline/`, { method: "PUT", body: { chapters, document_title } }),
  transition: (id: string, action: "ready" | "publish" | "unpublish" | "archive") => api<T.Document>(`/faculty/documents/${id}/${action}/`, { method: "POST" }),
  editModule: (id: string, body: { title?: string; source_text?: string }) => api<T.ModuleFull>(`/faculty/modules/${id}/`, { method: "PATCH", body }),
  moduleAvailability: (id: string, availability: T.ModuleAvailability) => api<T.ModuleFull>(`/faculty/modules/${id}/availability/`, { method: "POST", body: { availability } }),
  chapterAvailability: (id: string, availability: T.ModuleAvailability) => api(`/faculty/chapters/${id}/availability/`, { method: "POST", body: { availability } }),

  quizzes: (q: Q = {}) => api<T.Paginated<T.Quiz>>("/faculty/quizzes/", { query: q }).then(list),
  quiz: (id: string) => api<T.Quiz>(`/faculty/quizzes/${id}/`),
  createQuiz: (body: Record<string, unknown>) => api<T.Quiz>("/faculty/quizzes/", { method: "POST", body }),
  generateQuiz: (body: Record<string, unknown>) => api<T.Quiz>("/faculty/quizzes/generate/", { method: "POST", body }),
  updateQuiz: (id: string, body: Record<string, unknown>) => api<T.Quiz>(`/faculty/quizzes/${id}/`, { method: "PATCH", body }),
  quizStatus: (id: string, status: string) => api<T.Quiz>(`/faculty/quizzes/${id}/status/`, { method: "POST", body: { status } }),
  quizAttempts: (id: string) => api<T.Paginated<T.Attempt>>(`/faculty/quizzes/${id}/attempts/`).then(list),
  reEvaluate: (attemptId: string, overrides?: Record<string, { score_awarded: number; feedback?: string }>) =>
    api<T.Attempt>(`/faculty/quiz-attempts/${attemptId}/re-evaluate/`, { method: "POST", body: overrides ? { overrides } : {} }),

  assignments: (q: Q = {}) => api<T.Paginated<T.Assignment>>("/faculty/assignments/", { query: q }).then(list),
  assignment: (id: string) => api<T.Assignment>(`/faculty/assignments/${id}/`),
  createAssignment: (body: Record<string, unknown>) => api<T.Assignment>("/faculty/assignments/", { method: "POST", body }),
  generateAssignment: (body: Record<string, unknown>) => api<T.Assignment>("/faculty/assignments/generate/", { method: "POST", body }),
  updateAssignment: (id: string, body: Record<string, unknown>) => api<T.Assignment>(`/faculty/assignments/${id}/`, { method: "PATCH", body }),
  assignmentStatus: (id: string, status: string) => api<T.Assignment>(`/faculty/assignments/${id}/status/`, { method: "POST", body: { status } }),
  submissions: (id: string) => api<T.Paginated<T.Submission>>(`/faculty/assignments/${id}/submissions/`).then(list),
  evaluate: (submissionId: string, body: { score: number; feedback: string }) => api<T.Submission>(`/faculty/assignment-submissions/${submissionId}/evaluate/`, { method: "POST", body }),

  overview: () => api<any>("/faculty/analytics/overview/"),
  subjectSummary: (id: string) => api<any>(`/faculty/analytics/subjects/${id}/`),
  subjectStudentsAnalytics: (id: string) => api<any>(`/faculty/analytics/subjects/${id}/students/`),
  subjectModules: (id: string) => api<any>(`/faculty/analytics/subjects/${id}/modules/`),
  studentAnalytics: (id: string) => api<any>(`/faculty/analytics/students/${id}/`),
};

export const admin = {
  subjects: (q: Q = {}) => api<T.Paginated<T.Subject>>("/admin/subjects/", { query: q }).then(list),
  subject: (id: string) => api<T.Subject & { faculty: { faculty_id: string; email: string; full_name: string; status: string }[]; active_students?: number }>(`/admin/subjects/${id}/`),
  createSubject: (body: { name: string; code: string; description?: string }) => api<T.Subject>("/admin/subjects/", { method: "POST", body }),
  updateSubject: (id: string, body: Record<string, unknown>) => api<T.Subject>(`/admin/subjects/${id}/`, { method: "PATCH", body }),
  subjectStatus: (id: string, status: string) => api<T.Subject>(`/admin/subjects/${id}/status/`, { method: "POST", body: { status } }),
  assignFaculty: (id: string, faculty_ids: string[]) => api(`/admin/subjects/${id}/faculty/`, { method: "POST", body: { faculty_ids } }),
  unassignFaculty: (id: string, facultyId: string) => api(`/admin/subjects/${id}/faculty/${facultyId}/`, { method: "DELETE" }),
  subjectStudents: (id: string) => manage.subjectStudents(id),
  enroll: (id: string, student_ids: string[]) => api<{ results: { student_id: string; status: string }[] }>(`/admin/subjects/${id}/students/`, { method: "POST", body: { student_ids } }),
  discontinueEnrollment: (subjectId: string, studentId: string) => api(`/admin/subjects/${subjectId}/students/${studentId}/discontinue/`, { method: "POST" }),
  searchStudents: (q: string) => api<{ id: string; email: string; full_name: string; roll_number: string }[]>("/admin/students/search/", { query: { q } }),

  users: (kind: "faculty" | "students", q: Q = {}) => api<T.Paginated<T.User>>(`/admin/${kind}/`, { query: q }).then(list),
  user: (kind: "faculty" | "students", id: string) => api<T.User>(`/admin/${kind}/${id}/`),
  createUser: (kind: "faculty" | "students", body: Record<string, unknown>) => api<T.User>(`/admin/${kind}/`, { method: "POST", body }),
  updateUser: (kind: "faculty" | "students", id: string, body: Record<string, unknown>) => api<T.User>(`/admin/${kind}/${id}/`, { method: "PATCH", body }),
  userAction: (kind: "faculty" | "students", id: string, action: "discontinue" | "reactivate" | "reset-password", body: Record<string, unknown> = {}) =>
    api<T.User>(`/admin/${kind}/${id}/${action}/`, { method: "POST", body }),
  importUsers: (kind: "faculty" | "students", form: FormData) => api<T.ImportReport>(`/admin/${kind}/import/`, { method: "POST", form }),
  auditLogs: (q: Q = {}) => api<T.Paginated<T.AuditLog>>("/admin/audit-logs/", { query: q }),
  platform: () => api<any>("/admin/analytics/platform/"),
  platformSubjects: () => api<any>("/admin/analytics/platform/subjects/"),
  aiStatus: (refresh = false) => api<T.AIStatus>("/admin/ai/status/", { query: { refresh: refresh ? 1 : undefined } }),
};
