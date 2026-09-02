import { useLocalSearchParams } from "expo-router";
import React from "react";
import { Text, View } from "react-native";
import { student } from "@/api/endpoints";
import { useAction, useAsync } from "@/hooks/useAsync";
import { Badge, Button, Card, ErrorBanner, H1, H2, Loading, Notice, P, Row, Screen, Stat, colors, fmtSeconds, pct } from "@/ui";

export default function AttemptScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const q = useAsync(() => student.attempt(id), [id]);
  const [rem, setRem] = React.useState<any>(null);
  const remediate = useAction(async () => { setRem(await student.remediation(id)); });
  const a = q.data;
  return (
    <Screen refreshing={q.loading} onRefresh={q.reload}>
      <ErrorBanner message={q.error} onRetry={q.reload} />
      {q.loading && !a ? <Loading /> : null}
      {a ? (
        <>
          <H1>{a.assessment_title ?? "Quiz result"}</H1>
          {a.status === "pending_evaluation" ? <Notice tone="warning" message="Your written answers are awaiting evaluation. Multiple-choice questions are already scored; pull to refresh later." /> : null}
          <Row>
            <Stat label="score" value={a.score != null ? `${a.score}/${a.total_questions}` : "—"} />
            <Stat label="percentage" value={pct(a.percentage)} />
            <Stat label="time" value={fmtSeconds(a.time_taken_seconds)} />
          </Row>
          {a.status === "evaluated" ? <Badge value={a.passed ? "passed" : "not passed"} color={a.passed ? colors.success : colors.danger} /> : null}
          {a.status === "evaluated" && !a.passed ? (
            <>
              <Button title="Show me what to review" variant="secondary" onPress={() => remediate.run()} busy={remediate.busy} />
              <ErrorBanner message={remediate.error} />
            </>
          ) : null}
          {rem ? (
            <Card>
              <H2>Review</H2><P>{rem.overview}</P>
              {rem.items?.map((it: any, i: number) => <View key={i} style={{ gap: 4, marginTop: 8 }}><P><Text style={{ fontWeight: "700" }}>{it.question}</Text></P><P>{it.explanation}</P>{it.source_reference ? <P muted small>Source: {it.source_reference}</P> : null}</View>)}
            </Card>
          ) : null}
          <H2>Questions</H2>
          {a.detailed_results.map((r, i) => (
            <Card key={r.question_id} style={{ borderLeftWidth: 4, borderLeftColor: r.is_correct === null ? colors.warning : r.is_correct ? colors.success : colors.danger }}>
              <P><Text style={{ fontWeight: "700" }}>{i + 1}. </Text>{r.question}</P>
              {r.type === "mcq" ? <P muted small>Your answer: {r.selected_option ?? "—"} · Correct: {r.correct_option}</P> : <P muted small>Your answer: {r.student_answer || "—"}</P>}
              {r.explanation ? <P small>{r.explanation}</P> : null}
              {r.feedback ? <P small>{r.feedback}</P> : null}
              {r.missing_points?.length ? <P small muted>Missing: {r.missing_points.join("; ")}</P> : null}
            </Card>
          ))}
        </>
      ) : null}
    </Screen>
  );
}
