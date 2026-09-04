import { useRouter } from "expo-router";
import React from "react";
import { student } from "@/api/endpoints";
import { useAsync } from "@/hooks/useAsync";
import { Badge, CardGrid, Empty, ErrorBanner, ListRow, Loading, Screen, colors, fmtDate } from "@/ui";

export default function Assignments() {
  const router = useRouter();
  const q = useAsync(() => student.assignments(), []);
  return (
    <Screen refreshing={q.loading} onRefresh={q.reload}>
      <ErrorBanner message={q.error} onRetry={q.reload} />
      {q.loading && !q.data ? <Loading /> : null}
      {q.data?.length === 0 ? <Empty text="No assignments are open right now." /> : null}
      <CardGrid>
      {q.data?.map((a) => {
        const sub = a.my_submission;
        const label = sub ? (sub.status === "evaluated" ? `${sub.score}/${a.max_score}` : sub.status) : a.due_at && new Date(a.due_at) < new Date() ? "past due" : "open";
        return (
          <ListRow
            key={a.id}
            icon="create-outline"
            title={a.title}
            subtitle={`${a.max_score} marks${a.due_at ? ` · due ${fmtDate(a.due_at)}` : ""}`}
            right={<Badge value={label} color={sub?.status === "evaluated" ? colors.success : label === "past due" ? colors.danger : colors.primary} />}
            onPress={() => router.push(`/student/assignment/${a.id}`)}
          />
        );
      })}
      </CardGrid>
    </Screen>
  );
}
