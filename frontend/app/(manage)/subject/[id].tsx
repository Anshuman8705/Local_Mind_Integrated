import { useLocalSearchParams, useRouter } from "expo-router";
import React, { useState } from "react";
import { View } from "react-native";
import { manage } from "@/api/endpoints";
import { useAction, useAsync } from "@/hooks/useAsync";
import { Badge, Button, Card, Chip, Empty, ErrorBanner, H1, H2, Input, ListRow, Loading, Notice, P, Row, Screen, Stat, fmtSeconds, pct } from "@/ui";

type Tab = "overview" | "students" | "modules";

export default function SubjectScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const [tab, setTab] = useState<Tab>("overview");
  const summary = useAsync(() => manage.subjectSummary(id), [id]);
  const s = summary.data;
  return (
    <Screen refreshing={summary.loading} onRefresh={summary.reload}>
      <ErrorBanner message={summary.error} onRetry={summary.reload} />
      {summary.loading && !s ? <Loading /> : null}
      {s ? (
        <>
          <H1>{s.subject.code} · {s.subject.name}</H1>
          <Row>
            <Chip label="Overview" selected={tab === "overview"} onPress={() => setTab("overview")} />
            <Chip label="Students" selected={tab === "students"} onPress={() => setTab("students")} />
            <Chip label="Modules" selected={tab === "modules"} onPress={() => setTab("modules")} />
          </Row>
          {tab === "overview" ? (
            <>
              <Row><Stat label="students" value={s.students_enrolled} /><Stat label="active recently" value={s.students_active_in_window} /><Stat label="completion" value={pct(s.modules.completion_percentage)} /></Row>
              <Row><Stat label="books published" value={`${s.documents.published}/${s.documents.total}`} /><Stat label="modules open" value={`${s.modules.open}/${s.modules.total}`} /></Row>
              <Row><Stat label="quiz attempts" value={s.quizzes.attempts} /><Stat label="quiz average" value={pct(s.quizzes.average_percentage)} /><Stat label="pending eval" value={s.quizzes.pending_evaluation} /></Row>
              <Row><Stat label="submissions" value={s.assignments.submissions} /><Stat label="to evaluate" value={s.assignments.awaiting_evaluation} /><Stat label="reading time" value={fmtSeconds(s.time.learning_seconds)} /></Row>
              <Row>
                <Button title="Books" variant="secondary" small onPress={() => router.push({ pathname: "/(manage)/books", params: { subject: id } })} />
                <Button title="Quizzes" variant="secondary" small onPress={() => router.push({ pathname: "/(manage)/quizzes", params: { subject: id } })} />
                <Button title="Assignments" variant="secondary" small onPress={() => router.push({ pathname: "/(manage)/assignments", params: { subject: id } })} />
              </Row>
            </>
          ) : tab === "students" ? <StudentsTab subjectId={id} /> : <ModulesTab subjectId={id} />}
        </>
      ) : null}
    </Screen>
  );
}

function StudentsTab({ subjectId }: { subjectId: string }) {
  const rows = useAsync(() => manage.subjectStudentsAnalytics(subjectId), [subjectId]);
  const [q, setQ] = useState("");
  const [found, setFound] = useState<{ id: string; email: string; full_name: string; roll_number: string }[]>([]);
  const search = useAction(async () => { setFound(await manage.searchStudents(q)); });
  const enroll = useAction(async (sid: string) => { await manage.enroll(subjectId, [sid]); setFound((f) => f.filter((x) => x.id !== sid)); await rows.reload(); });
  const drop = useAction(async (sid: string) => { await manage.discontinueEnrollment(subjectId, sid); await rows.reload(); });
  return (
    <>
      <Card>
        <H2>Enrol a student</H2>
        <Row><View style={{ flex: 1 }}><Input value={q} onChangeText={setQ} placeholder="Name, email or roll number" onSubmitEditing={() => search.run()} /></View><Button title="Search" small onPress={() => search.run()} busy={search.busy} disabled={q.length < 2} /></Row>
        <ErrorBanner message={search.error ?? enroll.error} />
        {found.map((f) => <ListRow key={f.id} title={f.full_name} subtitle={`${f.email}${f.roll_number ? ` · ${f.roll_number}` : ""}`} right={<Button title="Enrol" small onPress={() => enroll.run(f.id)} busy={enroll.busy} />} />)}
      </Card>
      <H2>Enrolled students</H2>
      <ErrorBanner message={rows.error ?? drop.error} onRetry={rows.reload} />
      {rows.loading ? <Loading /> : null}
      {rows.data?.students?.length === 0 ? <Empty text="No students enrolled." /> : null}
      {rows.data?.students?.map((r: any) => (
        <Card key={r.student_id}>
          <Row style={{ justifyContent: "space-between" }}>
            <View style={{ flex: 1 }}><P style={{ fontWeight: "600" }}>{r.full_name}</P><P muted small>{r.email}{r.roll_number ? ` · ${r.roll_number}` : ""}</P></View>
            <Button title="Remove" variant="ghost" small onPress={() => drop.run(r.student_id)} />
          </Row>
          <P muted small>{r.modules_completed}/{r.modules_total} modules · quiz avg {pct(r.quiz_average)} ({r.quiz_attempts} attempts) · assignments {r.assignments_submitted} (avg {r.assignment_average ?? "—"})</P>
          <P muted small>App time {fmtSeconds(r.session_seconds)} over {r.sessions} sessions · reading {fmtSeconds(r.learning_seconds)} · quizzes {fmtSeconds(r.quiz_seconds)} · last login {r.last_login_at ? new Date(r.last_login_at).toLocaleDateString() : "never"}</P>
        </Card>
      ))}
    </>
  );
}

function ModulesTab({ subjectId }: { subjectId: string }) {
  const rows = useAsync(() => manage.subjectModules(subjectId), [subjectId]);
  const toggle = useAction(async (m: any) => { await manage.moduleAvailability(m.module_id, m.availability === "open" ? "locked" : "open"); await rows.reload(); });
  return (
    <>
      <Notice message="Students only see open modules. Locking a module hides its content and quizzes immediately." />
      <ErrorBanner message={rows.error ?? toggle.error} onRetry={rows.reload} />
      {rows.loading ? <Loading /> : null}
      {rows.data?.modules?.length === 0 ? <Empty text="No published modules yet." /> : null}
      {rows.data?.modules?.map((m: any) => (
        <Card key={m.module_id}>
          <Row style={{ justifyContent: "space-between" }}>
            <View style={{ flex: 1 }}><P style={{ fontWeight: "600" }}>{m.title}</P><P muted small>{m.document} · {m.chapter}</P></View>
            <Badge value={m.availability} />
            <Button title={m.availability === "open" ? "Lock" : "Open"} small variant={m.availability === "open" ? "secondary" : "primary"} onPress={() => toggle.run(m)} busy={toggle.busy} disabled={m.source_missing} />
          </Row>
          <P muted small>{m.students_completed} completed · {m.students_started - m.students_completed} in progress · {m.students_not_started} not started · quiz pass rate {pct(m.quiz_pass_rate)} · avg reading {fmtSeconds(m.avg_learning_seconds)}</P>
        </Card>
      ))}
    </>
  );
}
