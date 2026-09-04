import { useLocalSearchParams, useRouter } from "expo-router";
import React, { useEffect, useState } from "react";
import { manage } from "@/api/endpoints";
import { useAsync } from "@/hooks/useAsync";
import { useFilterChoices } from "@/hooks/useChoices";
import { Button, CardGrid, Chip, Empty, ErrorBanner, ListRow, Loading, Screen } from "@/ui";

export default function Books() {
  const router = useRouter();
  const { subject } = useLocalSearchParams<{ subject?: string }>();
  const [status, setStatus] = useState("");
  // Filters come from the server, which reads them off the model.
  const filters = useFilterChoices("document_status");
  const q = useAsync(() => manage.documents({ subject, status }), [subject, status]);
  // Keep the stage line moving while anything in the list is still being read.
  const busy = q.data?.some((d) => d.status === "processing") ?? false;
  useEffect(() => {
    if (!busy) return;
    const t = setInterval(q.reload, 4000);
    return () => clearInterval(t);
  }, [busy, q.reload]);
  return (
    <Screen
      refreshing={q.loading}
      onRefresh={q.reload}
      toolbar={filters.map((f) => <Chip key={f.value} label={f.label} selected={status === f.value} onPress={() => setStatus(f.value)} />)}
      actions={<Button title="Upload a Book" icon="cloud-upload-outline" small onPress={() => router.push({ pathname: "/(manage)/document/upload", params: { subject } })} />}
    >
      <ErrorBanner message={q.error} onRetry={q.reload} />
      {q.loading && !q.data ? <Loading /> : null}
      {q.data?.length === 0 ? <Empty text="No books match." /> : null}
      {/* A book in flight shows the stage it has reached instead of counts it
          does not have yet. */}
      <CardGrid>
      {q.data?.map((d) => <ListRow key={d.id} title={d.title} subtitle={d.status === "processing" && d.progress ? `${d.progress.detail} · step ${d.progress.step} of ${d.progress.total_steps}` : `${d.subject_code ?? ""} · ${d.chapter_count ?? 0} chapters · ${d.module_count ?? 0} modules${d.missing_source_modules ? ` · ${d.missing_source_modules} missing source` : ""}`} badge={d.status} onPress={() => router.push(`/(manage)/document/${d.id}`)} />)}
      </CardGrid>
    </Screen>
  );
}
