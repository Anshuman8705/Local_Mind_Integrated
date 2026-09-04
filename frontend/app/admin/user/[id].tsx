import { useLocalSearchParams, useRouter } from "expo-router";
import React, { useEffect, useState } from "react";
import { admin, manage } from "@/api/endpoints";
import { useAction, useAsync } from "@/hooks/useAsync";
import { Badge, Button, Card, ErrorBanner, H1, H2, Input, Loading, Notice, P, Row, Screen, Stat, confirmDeleteAsync, fmtSeconds, pct } from "@/ui";

export default function UserScreen() {
  const { id, kind: k } = useLocalSearchParams<{ id: string; kind?: string }>();
  const router = useRouter();
  const kind = k === "faculty" ? "faculty" : "students";
  const q = useAsync(() => admin.user(kind, id), [kind, id]);
  const [f, setF] = useState<Record<string, string>>({});
  const [reason, setReason] = useState("");
  useEffect(() => { if (q.data) setF({ full_name: q.data.full_name, ...(q.data.profile ?? {}) } as Record<string, string>); }, [q.data]);
  const save = useAction(async () => { const { full_name, ...profile } = f; await admin.updateUser(kind, id, { full_name, profile }); await q.reload(); });
  const act = useAction(async (a: "reactivate" | "reset-password") => { await admin.userAction(kind, id, a); await q.reload(); });
  // Deleting an account takes its enrolments, attempts, submissions and
  // progress with it, so the warning spells that out and names the person.
  const remove = useAction(async () => {
    const person = q.data;
    if (!person) return;
    const what = kind === "faculty" ? "faculty member" : "student";
    const ok = await confirmDeleteAsync(
      `Delete this ${what}?`,
      `This permanently removes the account and everything tied to it: enrolments or subject assignments, quiz attempts, assignment submissions and learning progress. It cannot be undone.`,
      { detail: `${person.full_name} · ${person.email}`, okLabel: "Delete Account" },
    );
    if (!ok) return;
    await admin.deleteUser(kind, id, reason);
    router.replace({ pathname: "/admin/users", params: { kind, notice: `${person.full_name} was deleted.` } });
  });
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
            <ErrorBanner message={act.error ?? remove.error} />
            {u.status === "discontinued" ? <Button title="Reactivate Account" small onPress={() => act.run("reactivate")} busy={act.busy} /> : null}
            <Notice message="Reset password sets the account back to the initial password and forces a change at next login." />
            <Button title="Reset Password" variant="secondary" small onPress={() => act.run("reset-password")} busy={act.busy} />
            <Input label="Reason (optional)" value={reason} onChangeText={setReason} />
            <Notice tone="warning" message="Deleting removes the account and all of its records from the database. The audit log keeps a note of who deleted it and when." />
            <Button title="Delete Account" icon="trash-outline" variant="danger" small onPress={() => remove.run()} busy={remove.busy} />
          </Card>
        </>
      ) : null}
    </Screen>
  );
}
