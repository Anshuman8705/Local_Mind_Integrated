import { useLocalSearchParams } from "expo-router";
import React, { useEffect, useState } from "react";
import { admin, manage } from "@/api/endpoints";
import { useAction, useAsync } from "@/hooks/useAsync";
import { Badge, Button, Card, ErrorBanner, H1, H2, Input, Loading, Notice, P, Row, Screen, Stat, fmtSeconds, pct } from "@/ui";

export default function UserScreen() {
  const { id, kind: k } = useLocalSearchParams<{ id: string; kind?: string }>();
  const kind = k === "faculty" ? "faculty" : "students";
  const q = useAsync(() => admin.user(kind, id), [kind, id]);
  const [f, setF] = useState<Record<string, string>>({});
  const [reason, setReason] = useState("");
  useEffect(() => { if (q.data) setF({ full_name: q.data.full_name, ...(q.data.profile ?? {}) } as Record<string, string>); }, [q.data]);
  const save = useAction(async () => { const { full_name, ...profile } = f; await admin.updateUser(kind, id, { full_name, profile }); await q.reload(); });
  const act = useAction(async (a: "discontinue" | "reactivate" | "reset-password") => { await admin.userAction(kind, id, a, a === "discontinue" ? { reason } : {}); await q.reload(); });
  const analytics = useAsync(() => (kind === "students" ? manage.studentAnalytics(id) : Promise.resolve(null)), [kind, id]);
  const u = q.data;
  return (
    <Screen refreshing={q.loading} onRefresh={q.reload}>
      <ErrorBanner message={q.error} onRetry={q.reload} />
      {q.loading && !u ? <Loading /> : null}
      {u ? (
        <>
          <Row style={{ justifyContent: "space-between" }}><H1>{u.full_name}</H1><Badge value={u.status} /></Row>
          <P muted>{u.email} · {u.role}{u.must_change_password ? " · still on initial password" : ""}</P>
          {analytics.data ? <Row><Stat label="modules done" value={`${analytics.data.modules.completed}/${analytics.data.modules.total}`} /><Stat label="quiz average" value={pct(analytics.data.quizzes.average_percentage)} /><Stat label="app time" value={fmtSeconds(analytics.data.time.session_seconds)} /></Row> : null}
          <Card>
            <H2>Details</H2>
            {Object.keys(f).map((key) => <Input key={key} label={key.replace(/_/g, " ")} value={f[key] ?? ""} onChangeText={(v) => setF((x) => ({ ...x, [key]: v }))} />)}
            <ErrorBanner message={save.error} />
            <Button title="Save" small onPress={() => save.run()} busy={save.busy} />
          </Card>
          <Card>
            <H2>Account</H2>
            <ErrorBanner message={act.error} />
            {u.status === "active" ? <><Input label="Reason (optional)" value={reason} onChangeText={setReason} /><Button title="Discontinue account" variant="danger" small onPress={() => act.run("discontinue")} busy={act.busy} /></> : <Button title="Reactivate account" small onPress={() => act.run("reactivate")} busy={act.busy} />}
            <Notice message="Reset password sets the account back to the initial password and forces a change at next login." />
            <Button title="Reset password" variant="secondary" small onPress={() => act.run("reset-password")} busy={act.busy} />
          </Card>
        </>
      ) : null}
    </Screen>
  );
}
