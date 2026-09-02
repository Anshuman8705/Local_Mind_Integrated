import { useLocalSearchParams, useRouter } from "expo-router";
import React, { useState } from "react";
import { manage } from "@/api/endpoints";
import { useAsync } from "@/hooks/useAsync";
import { Button, Chip, Empty, ErrorBanner, ListRow, Loading, P, Row, Screen } from "@/ui";

const STATUSES = ["", "under_review", "ready", "published", "unpublished", "processing", "error", "archived"];

export default function Books() {
  const router = useRouter();
  const { subject } = useLocalSearchParams<{ subject?: string }>();
  const [status, setStatus] = useState("");
  const q = useAsync(() => manage.documents({ subject, status }), [subject, status]);
  return (
    <Screen refreshing={q.loading} onRefresh={q.reload}>
      <Row style={{ justifyContent: "space-between" }}><P muted style={{ flex: 1, minWidth: 200 }}>Uploaded books and their processing status.</P><Button title="Upload a book" icon="cloud-upload-outline" small onPress={() => router.push({ pathname: "/(manage)/document/upload", params: { subject } })} /></Row>
      <Row>{STATUSES.map((s) => <Chip key={s} label={s ? s.replace("_", " ") : "all"} selected={status === s} onPress={() => setStatus(s)} />)}</Row>
      <ErrorBanner message={q.error} onRetry={q.reload} />
      {q.loading && !q.data ? <Loading /> : null}
      {q.data?.length === 0 ? <Empty text="No books match." /> : null}
      {q.data?.map((d) => <ListRow key={d.id} title={d.title} subtitle={`${d.subject_code ?? ""} · ${d.chapter_count ?? 0} chapters · ${d.module_count ?? 0} modules${d.missing_source_modules ? ` · ${d.missing_source_modules} missing source` : ""}`} badge={d.status} onPress={() => router.push(`/(manage)/document/${d.id}`)} />)}
    </Screen>
  );
}
