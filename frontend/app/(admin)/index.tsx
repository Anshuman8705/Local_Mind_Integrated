import React from "react";
import { admin } from "@/api/endpoints";
import { useAsync } from "@/hooks/useAsync";
import { Badge, Card, ErrorBanner, H2, ListRow, Loading, P, ProgressBar, Row, Screen, Stat, colors, fmtSeconds, pct } from "@/ui";

export default function Overview() {
  const q = useAsync(() => admin.platform(), []);
  const subs = useAsync(() => admin.platformSubjects(), []);
  const d = q.data;
  const n = (o: any) => Object.values(o ?? {}).reduce((t: number, v: any) => t + (v as number), 0);
  const modulePct = d?.modules?.total ? (d.modules.open / d.modules.total) * 100 : 0;
  return (
    <Screen refreshing={q.loading} onRefresh={() => { q.reload(); subs.reload(); }}>
      <ErrorBanner message={q.error} onRetry={q.reload} />
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
