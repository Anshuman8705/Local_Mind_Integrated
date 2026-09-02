import { useLocalSearchParams, useRouter } from "expo-router";
import React, { useState } from "react";
import { manage } from "@/api/endpoints";
import { useAsync } from "@/hooks/useAsync";
import { Button, Chip, Empty, ErrorBanner, ListRow, Loading, P, Row, Screen } from "@/ui";

export default function Quizzes() {
  const router = useRouter();
  const { subject } = useLocalSearchParams<{ subject?: string }>();
  const [status, setStatus] = useState("");
  const q = useAsync(() => manage.quizzes({ subject, status }), [subject, status]);
  return (
    <Screen refreshing={q.loading} onRefresh={q.reload}>
      <Row style={{ justifyContent: "space-between" }}><P muted style={{ flex: 1, minWidth: 200 }}>Quizzes you have created, by status.</P><Button title="New quiz" icon="add-outline" small onPress={() => router.push("/(manage)/quiz/new")} /></Row>
      <Row>{["", "draft", "published", "closed", "superseded"].map((s) => <Chip key={s} label={s || "all"} selected={status === s} onPress={() => setStatus(s)} />)}</Row>
      <ErrorBanner message={q.error} onRetry={q.reload} />
      {q.loading && !q.data ? <Loading /> : null}
      {q.data?.length === 0 ? <Empty text="No quizzes." /> : null}
      {q.data?.map((z) => <ListRow key={z.id} title={z.title} subtitle={`${z.kind} quiz · ${z.question_count} questions · ${z.attempt_count ?? 0} attempts · ${z.generator}${z.version > 1 ? ` · v${z.version}` : ""}`} badge={z.status} onPress={() => router.push(`/(manage)/quiz/${z.id}`)} />)}
    </Screen>
  );
}
