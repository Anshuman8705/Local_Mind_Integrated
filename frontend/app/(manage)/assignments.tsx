import { useLocalSearchParams, useRouter } from "expo-router";
import React, { useState } from "react";
import { manage } from "@/api/endpoints";
import { useAsync } from "@/hooks/useAsync";
import { Button, Chip, Empty, ErrorBanner, ListRow, Loading, P, Row, Screen, fmtDate } from "@/ui";

export default function Assignments() {
  const router = useRouter();
  const { subject } = useLocalSearchParams<{ subject?: string }>();
  const [status, setStatus] = useState("");
  const q = useAsync(() => manage.assignments({ subject, status }), [subject, status]);
  return (
    <Screen refreshing={q.loading} onRefresh={q.reload}>
      <Row style={{ justifyContent: "space-between" }}><P muted style={{ flex: 1, minWidth: 200 }}>Assignments you have set, by status.</P><Button title="New assignment" icon="add-outline" small onPress={() => router.push("/(manage)/assignment/new")} /></Row>
      <Row>{["", "draft", "published", "closed"].map((s) => <Chip key={s} label={s || "all"} selected={status === s} onPress={() => setStatus(s)} />)}</Row>
      <ErrorBanner message={q.error} onRetry={q.reload} />
      {q.loading && !q.data ? <Loading /> : null}
      {q.data?.length === 0 ? <Empty text="No assignments." /> : null}
      {q.data?.map((a) => <ListRow key={a.id} title={a.title} subtitle={`${a.max_score} marks · ${a.submission_count ?? 0} submissions${a.due_at ? ` · due ${fmtDate(a.due_at)}` : ""}`} badge={a.status} onPress={() => router.push(`/(manage)/assignment/${a.id}`)} />)}
    </Screen>
  );
}
