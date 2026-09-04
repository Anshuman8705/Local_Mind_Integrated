import { useLocalSearchParams, useRouter } from "expo-router";
import React, { useState } from "react";
import { manage } from "@/api/endpoints";
import { useAsync } from "@/hooks/useAsync";
import { useFilterChoices } from "@/hooks/useChoices";
import { Button, CardGrid, Chip, Empty, ErrorBanner, ListRow, Loading, Screen, fmtDate } from "@/ui";

export default function Assignments() {
  const router = useRouter();
  const { subject } = useLocalSearchParams<{ subject?: string }>();
  const [status, setStatus] = useState("");
  // Filters come from the server, which reads them off the model.
  const filters = useFilterChoices("assignment_status");
  const q = useAsync(() => manage.assignments({ subject, status }), [subject, status]);
  return (
    <Screen
      refreshing={q.loading}
      onRefresh={q.reload}
      toolbar={filters.map((f) => <Chip key={f.value} label={f.label} selected={status === f.value} onPress={() => setStatus(f.value)} />)}
      actions={<Button title="New Assignment" icon="add-outline" small onPress={() => router.push("/manage/assignment/new")} />}
    >
      <ErrorBanner message={q.error} onRetry={q.reload} />
      {q.loading && !q.data ? <Loading /> : null}
      {q.data?.length === 0 ? <Empty text="No assignments." /> : null}
      <CardGrid>
      {q.data?.map((a) => <ListRow key={a.id} title={a.title} subtitle={`${a.max_score} marks · ${a.submission_count ?? 0} submissions${a.due_at ? ` · due ${fmtDate(a.due_at)}` : ""}`} badge={a.status} onPress={() => router.push(`/manage/assignment/${a.id}`)} />)}
      </CardGrid>
    </Screen>
  );
}
