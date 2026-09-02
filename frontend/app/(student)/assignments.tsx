import { useRouter } from "expo-router";
import React from "react";
import { student } from "@/api/endpoints";
import { useAsync } from "@/hooks/useAsync";
import { Badge, Card, Empty, ErrorBanner, Loading, P, Screen, colors, fmtDate } from "@/ui";

export default function Assignments() {
  const router = useRouter();
  const q = useAsync(() => student.assignments(), []);
  return (
    <Screen refreshing={q.loading} onRefresh={q.reload}>
      <ErrorBanner message={q.error} onRetry={q.reload} />
      {q.loading && !q.data ? <Loading /> : null}
      {q.data?.length === 0 ? <Empty text="No assignments are open right now." /> : null}
      {q.data?.map((a) => {
        const sub = a.my_submission;
        const label = sub ? (sub.status === "evaluated" ? `${sub.score}/${a.max_score}` : sub.status) : a.due_at && new Date(a.due_at) < new Date() ? "past due" : "open";
        return (
          <Card key={a.id} onPress={() => router.push(`/(student)/assignment/${a.id}`)} style={{ flexDirection: "row", alignItems: "center", gap: 12 }}>
            <P style={{ flex: 1 }}>{a.title}{"\n"}<P muted small>{a.max_score} marks{a.due_at ? ` · due ${fmtDate(a.due_at)}` : ""}</P></P>
            <Badge value={label} color={sub?.status === "evaluated" ? colors.success : label === "past due" ? colors.danger : colors.primary} />
          </Card>
        );
      })}
    </Screen>
  );
}
