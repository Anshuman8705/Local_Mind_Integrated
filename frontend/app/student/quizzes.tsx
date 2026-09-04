import { useRouter } from "expo-router";
import React from "react";
import { student } from "@/api/endpoints";
import { useAsync } from "@/hooks/useAsync";
import { Badge, Card, Empty, ErrorBanner, H2, Loading, P, Screen, colors, fmtDate, pct } from "@/ui";

export default function Quizzes() {
  const router = useRouter();
  const q = useAsync(() => student.quizzes(), []);
  const scores = useAsync(() => student.scores(), []);
  return (
    <Screen refreshing={q.loading} onRefresh={() => { q.reload(); scores.reload(); }}>
      <ErrorBanner message={q.error} onRetry={q.reload} />
      {q.loading && !q.data ? <Loading /> : null}
      {q.data?.length === 0 ? <Empty text="No quizzes are open right now." /> : null}
      {q.data?.map((qz) => (
        <Card key={qz.id} onPress={() => router.push(`/student/quiz/${qz.id}`)} style={{ flexDirection: "row", alignItems: "center", gap: 12 }}>
          <React.Fragment>
            <P style={{ flex: 1 }}>{qz.title}{"\n"}<P muted small>{qz.question_count} questions · attempts {qz.attempts_used ?? 0}{qz.max_attempts ? `/${qz.max_attempts}` : ""} · best {pct(qz.best_percentage)}{qz.due_at ? ` · due ${fmtDate(qz.due_at)}` : ""}</P></P>
            <Badge value={qz.passed ? "passed" : qz.attempts_used ? "attempted" : "new"} color={qz.passed ? colors.success : colors.primary} />
          </React.Fragment>
        </Card>
      ))}
      <H2>Recent results</H2>
      {scores.data?.length === 0 ? <Empty text="No attempts yet." /> : null}
      {scores.data?.slice(0, 20).map((a) => (
        <Card key={a.id} onPress={() => router.push(`/student/attempt/${a.id}`)} style={{ flexDirection: "row", alignItems: "center", gap: 12 }}>
          <P style={{ flex: 1 }}>{a.assessment_title ?? "Quiz"} · attempt {a.attempt_number}{"\n"}<P muted small>{fmtDate(a.submitted_at)}</P></P>
          <Badge value={a.status === "evaluated" ? (a.passed ? `${pct(a.percentage)} pass` : `${pct(a.percentage)} fail`) : a.status} color={a.status !== "evaluated" ? colors.warning : a.passed ? colors.success : colors.danger} />
        </Card>
      ))}
    </Screen>
  );
}
