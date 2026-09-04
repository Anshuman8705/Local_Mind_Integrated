import React, { useState } from "react";
import { admin } from "@/api/endpoints";
import { useAsync } from "@/hooks/useAsync";
import { Button, Card, Empty, ErrorBanner, Input, Loading, P, Row, Screen, fmtDate } from "@/ui";

export default function Audit() {
  const [action, setAction] = useState(""); const [actor, setActor] = useState(""); const [page, setPage] = useState(1);
  const q = useAsync(() => admin.auditLogs({ action, actor_email: actor, page }), [action, actor, page]);
  return (
    <Screen
      refreshing={q.loading}
      onRefresh={q.reload}
      toolbar={
        <>
          <Input compact containerStyle={{ flex: 2, minWidth: 200 }} placeholder="Action (e.g. document.publish)" value={action} onChangeText={(t) => { setAction(t); setPage(1); }} />
          <Input compact containerStyle={{ flex: 1, minWidth: 160 }} placeholder="Actor email" value={actor} onChangeText={(t) => { setActor(t); setPage(1); }} />
        </>
      }
    >
      <ErrorBanner message={q.error} onRetry={q.reload} />
      {q.loading && !q.data ? <Loading /> : null}
      {q.data?.results.length === 0 ? <Empty text="No entries." /> : null}
      {q.data?.results.map((l) => (
        <Card key={l.id}>
          <P style={{ fontWeight: "600" }}>{l.action} <P muted small>· {l.target_type}{l.target_label ? ` · ${l.target_label}` : ""}</P></P>
          <P muted small>{l.actor_email} ({l.actor_role}) · {fmtDate(l.created_at)}</P>
          {Object.keys(l.summary ?? {}).length ? <P small muted>{JSON.stringify(l.summary)}</P> : null}
        </Card>
      ))}
      {q.data ? (
        <Row style={{ justifyContent: "space-between" }}>
          <P muted small>{q.data.count} entries · page {page}</P>
          <Row>
            {page > 1 ? <Button title="Previous" small variant="secondary" onPress={() => setPage((p) => p - 1)} /> : null}
            {q.data.next ? <Button title="Next" small variant="secondary" onPress={() => setPage((p) => p + 1)} /> : null}
          </Row>
        </Row>
      ) : null}
    </Screen>
  );
}
