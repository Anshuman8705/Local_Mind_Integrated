import { useLocalSearchParams, useRouter } from "expo-router";
import React, { useState } from "react";
import { manage } from "@/api/endpoints";
import { useAsync } from "@/hooks/useAsync";
import { useFilterChoices } from "@/hooks/useChoices";
import { Button, CardGrid, Chip, Empty, ErrorBanner, ListRow, Loading, Screen } from "@/ui";

export default function Quizzes() {
  const router = useRouter();
  const { subject } = useLocalSearchParams<{ subject?: string }>();
  const [status, setStatus] = useState("");
  // Filters come from the server, which reads them off the model.
  const filters = useFilterChoices("quiz_status");
  const q = useAsync(() => manage.quizzes({ subject, status }), [subject, status]);
  return (
    <Screen
      refreshing={q.loading}
      onRefresh={q.reload}
      toolbar={filters.map((f) => <Chip key={f.value} label={f.label} selected={status === f.value} onPress={() => setStatus(f.value)} />)}
      actions={<Button title="New Quiz" icon="add-outline" small onPress={() => router.push("/(manage)/quiz/new")} />}
    >
      <ErrorBanner message={q.error} onRetry={q.reload} />
      {q.loading && !q.data ? <Loading /> : null}
      {q.data?.length === 0 ? <Empty text="No quizzes." /> : null}
      <CardGrid>
      {q.data?.map((z) => <ListRow key={z.id} title={z.title} subtitle={`${z.kind} quiz · ${z.question_count} questions · ${z.attempt_count ?? 0} attempts · ${z.generator}${z.version > 1 ? ` · v${z.version}` : ""}`} badge={z.status} onPress={() => router.push(`/(manage)/quiz/${z.id}`)} />)}
      </CardGrid>
    </Screen>
  );
}
