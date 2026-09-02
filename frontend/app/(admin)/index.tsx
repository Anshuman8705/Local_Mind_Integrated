import React from "react";
import { admin } from "@/api/endpoints";
import type { AIStatus } from "@/api/types";
import { useAsync } from "@/hooks/useAsync";
import { Badge, Card, ErrorBanner, H2, ListRow, Loading, Notice, P, ProgressBar, Row, Screen, Stat, colors, fmtSeconds, pct } from "@/ui";

function AITutorStatus({ status, error }: { status?: AIStatus | null; error?: string | null }) {
  if (!status && !error) return null;
  const s = status;
  const tone = !s ? "warning" : s.ready ? "success" : "warning";
  const message = !s
    ? `Could not read the AI tutor status: ${error}`
    : !s.enabled
      ? "The AI tutor is switched off (AI_ENABLED=false). Lessons, quizzes and grading use their fallbacks."
      : !s.reachable
        ? `Ollama is not reachable at the configured address (${s.error || "no response"}). Students see plain-text lessons and generated quizzes are placeholders until it is back.`
        : !s.ready
          ? `Ollama is up but a model is missing: ${[s.tutor_model, s.outline_model].filter((m) => !m.present).map((m) => m.name).join(", ")}. Run \`ollama pull <model>\` on the server.`
          : `AI tutor online · ${s.tutor_model.name}${s.outline_model.name !== s.tutor_model.name ? ` · outline ${s.outline_model.name}` : ""}`;
  return <Notice tone={tone} message={message} />;
}

export default function Overview() {
  const q = useAsync(() => admin.platform(), []);
  const subs = useAsync(() => admin.platformSubjects(), []);
  const ai = useAsync(() => admin.aiStatus(true), []);
  const d = q.data;
  const n = (o: any) => Object.values(o ?? {}).reduce((t: number, v: any) => t + (v as number), 0);
  const modulePct = d?.modules?.total ? (d.modules.open / d.modules.total) * 100 : 0;
  return (
    <Screen refreshing={q.loading} onRefresh={() => { q.reload(); subs.reload(); ai.reload(); }}>
      <ErrorBanner message={q.error} onRetry={q.reload} />
      <AITutorStatus status={ai.data} error={ai.error} />
      {q.loading && !d ? <Loading /> : null}
      {d ? (
        <>
          <Row style={{ gap: 12 }}>
            <Stat label="admins" icon="shield-half-outline" color={colors.purple} value={d.users.admin?.active ?? 0} helper="active" />
            <Stat label="faculty" icon="people-outline" color={colors.accent} value={d.users.faculty?.active ?? 0} helper={`of ${n(d.users.faculty)} accounts`} />
            <Stat label="students" icon="school-outline" color={colors.primary} value={d.users.student?.active ?? 0} helper={`of ${n(d.users.student)} accounts`} />
            <Stat label="enrollments" icon="person-add-outline" color={colors.warning} value={d.enrollments_active} helper="active" />
          </Row>
          <Row style={{ gap: 12 }}>
            <Stat label="active subjects" icon="library-outline" color={colors.primary} value={d.subjects.active ?? 0} />
            <Stat label="published books" icon="book-outline" color={colors.accent} value={d.documents.published ?? 0} />
            <Stat label="quiz average" icon="ribbon-outline" color={colors.purple} value={pct(d.quizzes.average_percentage)} helper={`${d.quizzes.attempts} attempts`} />
            <Stat label="awaiting grading" icon="hourglass-outline" color={colors.warning} value={d.quizzes.pending_evaluation + d.assignments.awaiting_evaluation} helper={`${d.quizzes.pending_evaluation} quiz · ${d.assignments.awaiting_evaluation} assignment`} />
          </Row>
          <Row style={{ gap: 16, alignItems: "stretch" }}>
            <Card style={{ flex: 1, minWidth: 300 }}>
              <H2 icon="layers-outline">Module readiness</H2>
              <P muted small>{d.modules.open} of {d.modules.total} modules open to students</P>
              <ProgressBar value={modulePct} />
              <Row style={{ justifyContent: "space-between", marginTop: 4 }}>
                <P small style={{ color: colors.muted }}>Missing source text</P>
                <Badge value={String(d.modules.source_missing)} color={d.modules.source_missing ? colors.warning : colors.success} />
              </Row>
            </Card>
            <Card style={{ flex: 1, minWidth: 300 }}>
              <H2 icon="time-outline">Activity</H2>
              <Row style={{ gap: 12 }}>
                <Stat label="sessions" icon="pulse-outline" color={colors.primary} value={d.activity.sessions} />
                <Stat label="app time" icon="phone-portrait-outline" color={colors.accent} value={fmtSeconds(d.activity.session_seconds)} />
                <Stat label="reading" icon="book-outline" color={colors.purple} value={fmtSeconds(d.activity.learning_seconds)} />
              </Row>
            </Card>
          </Row>
        </>
      ) : null}
      <H2 icon="library-outline">Subjects</H2>
      {subs.data?.subjects?.map((s: any) => (
        <ListRow key={s.subject_id} icon="library-outline" title={`${s.code} · ${s.name}`}
          subtitle={`${s.faculty.length ? s.faculty.join(", ") : "No faculty assigned"} · ${s.students_enrolled} students · ${s.documents_published} books · ${s.quiz_attempts} attempts (avg ${pct(s.quiz_average)}) · ${s.students_active_in_window} active`} />
      ))}
    </Screen>
  );
}
