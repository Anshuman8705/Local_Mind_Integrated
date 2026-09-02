import { useLocalSearchParams } from "expo-router";
import React, { useEffect, useState } from "react";
import { View } from "react-native";
import { manage } from "@/api/endpoints";
import type { Assignment } from "@/api/types";
import { useAction, useAsync } from "@/hooks/useAsync";
import { Badge, Button, Card, Chip, ErrorBanner, H1, H2, Input, Label, Loading, Notice, P, Row, Screen, colors, fmtDate } from "@/ui";

export default function AssignmentScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const q = useAsync(() => manage.assignment(id), [id]);
  const [tab, setTab] = useState<"edit" | "submissions">("edit");
  const [d, setD] = useState<Assignment | null>(null);
  const [dirty, setDirty] = useState(false);
  useEffect(() => { if (q.data) { setD(JSON.parse(JSON.stringify(q.data))); setDirty(false); } }, [q.data]);
  const edit = (fn: (a: Assignment) => Assignment) => { setD((a) => (a ? fn(a) : a)); setDirty(true); };
  const save = useAction(async () => { if (!d) return; await manage.updateAssignment(id, { title: d.title, description: d.description, instructions: d.instructions, rubric: d.rubric, max_score: d.max_score, due_at: d.due_at || null, available_from: d.available_from || null, allow_late: d.allow_late, allow_resubmission: d.allow_resubmission }); await q.reload(); });
  const status = useAction(async (s: string) => { await manage.assignmentStatus(id, s); await q.reload(); });
  const rubricTotal = d?.rubric.reduce((t, r) => t + (Number(r.points) || 0), 0) ?? 0;
  return (
    <Screen refreshing={q.loading} onRefresh={q.reload}>
      <ErrorBanner message={q.error} onRetry={q.reload} />
      {q.loading && !d ? <Loading /> : null}
      {d ? (
        <>
          <Row style={{ justifyContent: "space-between" }}><H1>{d.title}</H1><Badge value={d.status} /></Row>
          <Row><Chip label="Details" selected={tab === "edit"} onPress={() => setTab("edit")} /><Chip label={`Submissions (${d.submission_count ?? 0})`} selected={tab === "submissions"} onPress={() => setTab("submissions")} /></Row>
          <ErrorBanner message={status.error ?? save.error} />
          <Row>
            {d.status === "draft" ? <Button title="Publish" small onPress={() => status.run("published")} busy={status.busy} disabled={dirty} /> : null}
            {d.status === "published" ? <Button title="Close" small variant="secondary" onPress={() => status.run("closed")} busy={status.busy} /> : null}
            {dirty ? <Button title="Save changes" small onPress={() => save.run()} busy={save.busy} disabled={rubricTotal !== d.max_score} /> : null}
          </Row>
          {tab === "edit" ? (
            <Card>
              <Input label="Title" value={d.title} onChangeText={(t) => edit((a) => ({ ...a, title: t }))} />
              <Input label="Description" multiline value={d.description ?? ""} onChangeText={(t) => edit((a) => ({ ...a, description: t }))} />
              <Input label="Instructions" multiline value={d.instructions ?? ""} onChangeText={(t) => edit((a) => ({ ...a, instructions: t }))} />
              <Row><Input label="Max score" value={String(d.max_score)} keyboardType="number-pad" style={{ width: 90 }} onChangeText={(t) => edit((a) => ({ ...a, max_score: Number(t) || 0 }))} /><Input label="Due at (ISO, optional)" value={d.due_at ?? ""} onChangeText={(t) => edit((a) => ({ ...a, due_at: t || null }))} placeholder="2026-09-30T23:59:00Z" /></Row>
              <Row><Chip label={d.allow_late ? "Late allowed" : "No late submissions"} selected={d.allow_late} onPress={() => edit((a) => ({ ...a, allow_late: !a.allow_late }))} /><Chip label={d.allow_resubmission ? "Resubmission allowed" : "Single submission"} selected={d.allow_resubmission} onPress={() => edit((a) => ({ ...a, allow_resubmission: !a.allow_resubmission }))} /></Row>
              <Label>Rubric ({rubricTotal}/{d.max_score} points{rubricTotal !== d.max_score ? " — must match max score" : ""})</Label>
              {d.rubric.map((r, i) => (
                <Row key={i}>
                  <View style={{ flex: 1 }}><Input value={r.criterion} onChangeText={(t) => edit((a) => ({ ...a, rubric: a.rubric.map((x, j) => (j === i ? { ...x, criterion: t } : x)) }))} /></View>
                  <Input value={String(r.points)} keyboardType="number-pad" style={{ width: 70 }} onChangeText={(t) => edit((a) => ({ ...a, rubric: a.rubric.map((x, j) => (j === i ? { ...x, points: Number(t) || 0 } : x)) }))} />
                  <Button title="×" small variant="ghost" onPress={() => edit((a) => ({ ...a, rubric: a.rubric.filter((_, j) => j !== i) }))} />
                </Row>
              ))}
              <Button title="Add criterion" small variant="secondary" onPress={() => edit((a) => ({ ...a, rubric: [...a.rubric, { criterion: "", points: 0 }] }))} />
            </Card>
          ) : <SubmissionsTab assignment={d} />}
        </>
      ) : null}
    </Screen>
  );
}

function SubmissionsTab({ assignment }: { assignment: Assignment }) {
  const q = useAsync(() => manage.submissions(assignment.id), [assignment.id]);
  const [scores, setScores] = useState<Record<string, { score: string; feedback: string }>>({});
  const evaluate = useAction(async (subId: string) => { const v = scores[subId]; await manage.evaluate(subId, { score: Number(v?.score ?? 0), feedback: v?.feedback ?? "" }); await q.reload(); });
  return (
    <>
      <ErrorBanner message={q.error ?? evaluate.error} onRetry={q.reload} />
      {q.loading ? <Loading /> : null}
      {q.data?.length === 0 ? <P muted>No submissions yet.</P> : null}
      {q.data?.map((s) => (
        <Card key={s.id}>
          <Row style={{ justifyContent: "space-between" }}>
            <View style={{ flex: 1 }}><P style={{ fontWeight: "600" }}>{s.student_email}</P><P muted small>{fmtDate(s.submitted_at)}{s.is_late ? " · late" : ""} · attempt {s.attempt_number}</P></View>
            <Badge value={s.status === "evaluated" ? `${s.score}/${assignment.max_score}` : s.status} color={s.status === "evaluated" ? colors.success : colors.warning} />
          </Row>
          <P>{s.content}</P>
          {s.status === "evaluated" ? (s.feedback ? <Notice tone="success" message={s.feedback} /> : null) : null}
          <H2>{s.status === "evaluated" ? "Re-evaluate" : "Evaluate"}</H2>
          <Row>
            <Input label={`Score (0–${assignment.max_score})`} value={scores[s.id]?.score ?? (s.score != null ? String(s.score) : "")} keyboardType="decimal-pad" style={{ width: 90 }} onChangeText={(t) => setScores((x) => ({ ...x, [s.id]: { score: t, feedback: x[s.id]?.feedback ?? s.feedback ?? "" } }))} />
            <View style={{ flex: 1 }}><Input label="Feedback" value={scores[s.id]?.feedback ?? s.feedback ?? ""} onChangeText={(t) => setScores((x) => ({ ...x, [s.id]: { score: x[s.id]?.score ?? (s.score != null ? String(s.score) : ""), feedback: t } }))} /></View>
          </Row>
          <Button title="Save evaluation" small onPress={() => evaluate.run(s.id)} busy={evaluate.busy} disabled={!scores[s.id]?.score} />
        </Card>
      ))}
    </>
  );
}
