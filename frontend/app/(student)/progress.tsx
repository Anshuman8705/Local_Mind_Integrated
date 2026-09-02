import React from "react";
import { View } from "react-native";
import { student } from "@/api/endpoints";
import { useAsync } from "@/hooks/useAsync";
import { Card, ErrorBanner, H2, Loading, P, ProgressBar, Row, Screen, Stat, colors, fmtSeconds, pct } from "@/ui";

export default function Progress() {
  const q = useAsync(() => student.overview(), []);
  const sessions = useAsync(() => student.subjects().then(async (subs) => Promise.all(subs.map(async (s) => ({ s, a: await student.subjectAnalytics(s.id) })))), []);
  const d = q.data;
  return (
    <Screen refreshing={q.loading} onRefresh={() => { q.reload(); sessions.reload(); }}>
      <ErrorBanner message={q.error} onRetry={q.reload} />
      {q.loading && !d ? <Loading /> : null}
      {d ? (
        <>
          <Card>
            <Row style={{ justifyContent: "space-between" }}>
              <H2 icon="trending-up-outline">Overall progress</H2>
              <P style={{ fontSize: 26, fontWeight: "800", color: colors.primary }}>{pct(d.modules.completion_percentage)}</P>
            </Row>
            <ProgressBar value={d.modules.completion_percentage} height={10} />
            <P muted small>{d.modules.completed} of {d.modules.total} modules completed{d.modules.needs_review ? ` · ${d.modules.needs_review} need review` : ""}</P>
          </Card>
          <Row style={{ gap: 12 }}>
            <Stat label="quiz attempts" icon="help-circle-outline" color={colors.accent} value={d.quizzes.attempts} />
            <Stat label="quiz average" icon="ribbon-outline" color={colors.purple} value={pct(d.quizzes.average_percentage)} />
            <Stat label="assignments" icon="create-outline" color={colors.warning} value={`${d.assignments.evaluated}/${d.assignments.submitted}`} helper="evaluated / submitted" />
          </Row>
          <Row style={{ gap: 12 }}>
            <Stat label="reading time" icon="book-outline" color={colors.primary} value={fmtSeconds(d.time.learning_seconds)} />
            <Stat label="quiz time" icon="timer-outline" color={colors.accent} value={fmtSeconds(d.time.quiz_seconds)} />
            <Stat label="app time" icon="phone-portrait-outline" color={colors.purple} value={fmtSeconds(d.time.session_seconds)} />
          </Row>
        </>
      ) : null}
      <H2 icon="library-outline">By subject</H2>
      {sessions.data?.map(({ s, a }) => {
        const done = a.modules.filter((m: any) => m.status === "completed").length;
        const total = a.modules.length;
        return (
          <Card key={s.id}>
            <Row style={{ justifyContent: "space-between" }}>
              <View style={{ flex: 1, minWidth: 0 }}><P style={{ fontWeight: "700" }}>{s.name}</P><P muted small>{s.code}</P></View>
              <P style={{ fontWeight: "800", color: colors.primary }}>{total ? pct((done / total) * 100) : "—"}</P>
            </Row>
            <ProgressBar value={total ? (done / total) * 100 : 0} height={6} />
            <P muted small>{done} of {total} modules completed · quiz average {pct(a.quiz_average)} · reading {fmtSeconds(a.time.learning_seconds)}</P>
          </Card>
        );
      })}
    </Screen>
  );
}
