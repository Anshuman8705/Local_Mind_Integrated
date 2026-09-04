import { useLocalSearchParams, useRouter } from "expo-router";
import React, { useState } from "react";
import { View } from "react-native";
import { admin } from "@/api/endpoints";
import { useAction, useAsync } from "@/hooks/useAsync";
import { Badge, Button, Card, ErrorBanner, H1, H2, Input, ListRow, Loading, Notice, P, Row, Screen, confirmDeleteAsync } from "@/ui";

export default function AdminSubject() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const q = useAsync(() => admin.subject(id), [id]);
  const students = useAsync(() => admin.subjectStudents(id), [id]);
  const allFaculty = useAsync(() => admin.users("faculty", { status: "active" }), []);
  const status = useAction(async (s: string) => { await admin.subjectStatus(id, s); await q.reload(); });
  // Deleting a subject removes its books, quizzes, assignments and enrolments
  // with it, so the warning names the subject and says what goes with it.
  const remove = useAction(async () => {
    const subject = q.data;
    if (!subject) return;
    const ok = await confirmDeleteAsync(
      "Delete this subject?",
      "This permanently removes the subject along with its books, modules, quizzes, assignments, submissions and enrolment records. It cannot be undone.",
      { detail: `${subject.code} · ${subject.name}`, okLabel: "Delete Subject" },
    );
    if (!ok) return;
    await admin.deleteSubject(id);
    router.replace({ pathname: "/admin/subjects", params: { notice: `${subject.code} · ${subject.name} was deleted.` } });
  });
  const assign = useAction(async (fid: string) => { await admin.assignFaculty(id, [fid]); await q.reload(); });
  const unassign = useAction(async (fid: string) => { await admin.unassignFaculty(id, fid); await q.reload(); });
  const [search, setSearch] = useState(""); const [found, setFound] = useState<{ id: string; full_name: string; email: string; roll_number: string }[]>([]);
  const doSearch = useAction(async () => setFound(await admin.searchStudents(search)));
  const enroll = useAction(async (sid: string) => { await admin.enroll(id, [sid]); setFound((f) => f.filter((x) => x.id !== sid)); await students.reload(); });
  const drop = useAction(async (sid: string) => { await admin.discontinueEnrollment(id, sid); await students.reload(); });
  const s = q.data;
  const assigned = new Set((s?.faculty ?? []).filter((f) => f.status === "active").map((f) => f.faculty_id));
  return (
    <Screen refreshing={q.loading} onRefresh={() => { q.reload(); students.reload(); }}>
      <ErrorBanner message={q.error} onRetry={q.reload} />
      {q.loading && !s ? <Loading /> : null}
      {s ? (
        <>
          <Row style={{ justifyContent: "space-between" }}><H1>{s.code} · {s.name}</H1><Badge value={s.status} /></Row>
          <ErrorBanner message={status.error ?? remove.error} />
          <Row>
            {s.status === "active" ? <Button title="Discontinue" small variant="secondary" onPress={() => status.run("discontinued")} busy={status.busy} /> : null}
            {s.status === "discontinued" ? <Button title="Reactivate" small onPress={() => status.run("active")} busy={status.busy} /> : null}
            <Button title="Delete" icon="trash-outline" small variant="danger" onPress={() => remove.run()} busy={remove.busy} />
          </Row>
          {s.status === "archived" ? <Notice tone="warning" message="Archived subjects are read-only. Delete removes the subject and its content for good." /> : null}
          <H2>Faculty</H2>
          <ErrorBanner message={assign.error ?? unassign.error} />
          {(s.faculty ?? []).filter((f) => f.status === "active").map((f) => <ListRow key={f.faculty_id} title={f.full_name} subtitle={f.email} right={<Button title="Remove" small variant="ghost" onPress={() => unassign.run(f.faculty_id)} />} />)}
          <Card>
            <P muted small>Assign faculty</P>
            <Row>{allFaculty.data?.filter((f) => !assigned.has(f.id)).map((f) => <Button key={f.id} title={`+ ${f.full_name}`} small variant="secondary" onPress={() => assign.run(f.id)} />)}</Row>
          </Card>
          <H2>Students ({students.data?.filter((e) => e.status === "active").length ?? 0})</H2>
          <Card>
            <Row><View style={{ flex: 1 }}><Input placeholder="Search students to enrol" value={search} onChangeText={setSearch} onSubmitEditing={() => doSearch.run()} /></View><Button title="Search" small onPress={() => doSearch.run()} busy={doSearch.busy} disabled={search.length < 2} /></Row>
            <ErrorBanner message={doSearch.error ?? enroll.error ?? drop.error} />
            {found.map((f) => <ListRow key={f.id} title={f.full_name} subtitle={f.email} right={<Button title="Enrol" small onPress={() => enroll.run(f.id)} />} />)}
          </Card>
          {students.data?.filter((e) => e.status === "active").map((e) => <ListRow key={e.id} title={e.student_name} subtitle={e.student_email} right={<Button title="Remove" small variant="ghost" onPress={() => drop.run(e.student_id)} />} />)}
        </>
      ) : null}
    </Screen>
  );
}
