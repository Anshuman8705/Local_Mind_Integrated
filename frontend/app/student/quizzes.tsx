import { useRouter } from "expo-router";
import React from "react";
import { student } from "@/api/endpoints";
import { useAsync } from "@/hooks/useAsync";
import { Badge, CardGrid, Empty, ErrorBanner, H2, ListRow, Loading, Screen, colors, fmtDate, pct } from "@/ui";

export default function Quizzes() {
  const router = useRouter();
  const q = useAsync(() => student.quizzes(), []);
  const scores = useAsync(() => student.scores(), []);
  return (
    <Screen refreshing={q.loading} onRefresh={() => { q.reload(); scores.reload(); }}>
      <ErrorBanner message={q.error} onRetry={q.reload} />
      {q.loading && !q.data ? <Loading /> : null}
      {q.data?.length === 0 ? <Empty text="No quizzes are open right now." /> : null}
      <CardGrid>
        {q.data?.map((qz) => (
          <ListRow
            key={qz.id}
            icon="help-circle-outline"
            title={qz.title}
            subtitle={`${qz.question_count} questions · attempts ${qz.attempts_used ?? 0}${qz.max_attempts ? `/${qz.max_attempts}` : ""} · best ${pct(qz.best_percentage)}${qz.due_at ? ` · due ${fmtDate(qz.due_at)}` : ""}`}
            right={<Badge value={qz.passed ? "passed" : qz.attempts_used ? "attempted" : "new"} color={qz.passed ? colors.success : colors.primary} />}
            onPress={() => router.push(`/student/quiz/${qz.id}`)}
          />
        ))}
      </CardGrid>
      <H2>Recent results</H2>
      {scores.data?.length === 0 ? <Empty text="No attempts yet." /> : null}
      <CardGrid>
        {scores.data?.slice(0, 20).map((a) => (
          <ListRow
            key={a.id}
            icon="ribbon-outline"
            title={`${a.assessment_title ?? "Quiz"} · attempt ${a.attempt_number}`}
            subtitle={fmtDate(a.submitted_at)}
            right={<Badge value={a.status === "evaluated" ? (a.passed ? `${pct(a.percentage)} pass` : `${pct(a.percentage)} fail`) : a.status} color={a.status !== "evaluated" ? colors.warning : a.passed ? colors.success : colors.danger} />}
            onPress={() => router.push(`/student/attempt/${a.id}`)}
          />
        ))}
      </CardGrid>
    </Screen>
  );
}
