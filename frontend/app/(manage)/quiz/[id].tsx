import { useLocalSearchParams, useRouter } from "expo-router";
import React, { useEffect, useState } from "react";
import { Text, View } from "react-native";
import { manage } from "@/api/endpoints";
import type { Question, Quiz } from "@/api/types";
import { useAction, useAsync } from "@/hooks/useAsync";
import { Badge, Button, Card, Chip, ErrorBanner, H1, Input, Label, Loading, Notice, P, Row, Screen, colors, fmtDate, fmtSeconds, pct } from "@/ui";

export default function QuizScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const q = useAsync(() => manage.quiz(id), [id]);
  const [tab, setTab] = useState<"questions" | "settings" | "attempts">("questions");
  const [draft, setDraft] = useState<Quiz | null>(null);
  const [dirty, setDirty] = useState(false);
  useEffect(() => { if (q.data) { setDraft(JSON.parse(JSON.stringify(q.data))); setDirty(false); } }, [q.data]);
  const save = useAction(async () => {
    if (!draft) return;
    const res = await manage.updateQuiz(id, { title: draft.title, instructions: draft.instructions, questions: draft.questions, pass_percentage: draft.pass_percentage, max_attempts: draft.max_attempts, time_limit_minutes: draft.time_limit_minutes, due_at: draft.due_at || null, available_from: draft.available_from || null });
    if (res.id !== id) router.replace(`/(manage)/quiz/${res.id}`); else await q.reload();
  });
  const status = useAction(async (s: string) => { await manage.quizStatus(id, s); await q.reload(); });
  const d = draft;
  const edit = (fn: (z: Quiz) => Quiz) => { setDraft((z) => (z ? fn(z) : z)); setDirty(true); };
  const editQ = (i: number, fn: (x: Question) => Question) => edit((z) => ({ ...z, questions: z.questions!.map((x, j) => (j === i ? fn(x) : x)) }));
  const editable = d?.status !== "superseded";
  return (
    <Screen refreshing={q.loading} onRefresh={q.reload}>
      <ErrorBanner message={q.error} onRetry={q.reload} />
      {q.loading && !d ? <Loading /> : null}
      {d ? (
        <>
          <Row style={{ justifyContent: "space-between" }}><H1>{d.title}</H1><Badge value={d.status} /></Row>
          <P muted small>{d.kind} quiz · {d.generator} · version {d.version} · {d.attempt_count ?? 0} attempts</P>
          {d.generator === "fallback" ? <Notice tone="warning" message="This draft was produced without the AI. Placeholder options are marked; rewrite them before publishing." /> : null}
          {(d.attempt_count ?? 0) > 0 && d.status !== "superseded" ? <Notice message="Students have attempted this version. Saving question changes creates a new version; their results stay attached to this one." /> : null}
          <Row>
            <Chip label="Questions" selected={tab === "questions"} onPress={() => setTab("questions")} />
            <Chip label="Settings" selected={tab === "settings"} onPress={() => setTab("settings")} />
            <Chip label="Attempts" selected={tab === "attempts"} onPress={() => setTab("attempts")} />
          </Row>
          {d.status === "draft" || d.status === "closed" ? <Notice message="Publishing shows this quiz to enrolled students right away; if its module is still locked, publishing opens it." /> : null}
          <ErrorBanner message={status.error ?? save.error} />
          <Row>
            {d.status === "draft" || d.status === "closed" ? <Button title="Publish" small onPress={() => status.run("published")} busy={status.busy} disabled={dirty} /> : null}
            {d.status === "published" ? <Button title="Close" small variant="secondary" onPress={() => status.run("closed")} busy={status.busy} /> : null}
            {dirty && editable ? <Button title="Save changes" small onPress={() => save.run()} busy={save.busy} /> : null}
          </Row>
          {tab === "questions" ? (
            <>
              {d.questions?.map((qq, i) => (
                <Card key={qq.id}>
                  <Row style={{ justifyContent: "space-between" }}><Label>Q{i + 1} · {qq.type}</Label>{editable ? <Button title="Remove" small variant="ghost" onPress={() => edit((z) => ({ ...z, questions: z.questions!.filter((_, j) => j !== i) }))} /> : null}</Row>
                  <Input multiline value={qq.question} editable={editable} onChangeText={(t) => editQ(i, (x) => ({ ...x, question: t }))} />
                  {qq.type === "mcq" ? (
                    <>
                      {qq.options?.map((o, oi) => (
                        <Row key={o.key}>
                          <Chip label={o.key} selected={qq.correct_answer === o.key} onPress={() => editable && editQ(i, (x) => ({ ...x, correct_answer: o.key }))} />
                          <View style={{ flex: 1 }}><Input value={o.text} editable={editable} onChangeText={(t) => editQ(i, (x) => ({ ...x, options: x.options!.map((p, pj) => (pj === oi ? { ...p, text: t } : p)) }))} /></View>
                        </Row>
                      ))}
                      <P muted small>Tap a letter to mark it correct.</P>
                      <Input label="Explanation" value={qq.explanation ?? ""} editable={editable} onChangeText={(t) => editQ(i, (x) => ({ ...x, explanation: t }))} />
                    </>
                  ) : <Input label="Expected rubric" multiline value={qq.expected_rubric ?? ""} editable={editable} onChangeText={(t) => editQ(i, (x) => ({ ...x, expected_rubric: t }))} />}
                  {qq.source_reference ? <P muted small>Source: {qq.source_reference}</P> : null}
                </Card>
              ))}
              {editable ? <Row>
                <Button title="Add MCQ" small variant="secondary" onPress={() => edit((z) => ({ ...z, questions: [...(z.questions ?? []), { id: `q${Date.now()}`, type: "mcq", question: "", options: ["A", "B", "C", "D"].map((k) => ({ key: k, text: "" })), correct_answer: "A", explanation: "" }] }))} />
                <Button title="Add written question" small variant="secondary" onPress={() => edit((z) => ({ ...z, questions: [...(z.questions ?? []), { id: `q${Date.now()}`, type: "subjective", question: "", expected_rubric: "" }] }))} />
              </Row> : null}
            </>
          ) : tab === "settings" ? (
            <Card>
              <Input label="Title" value={d.title} editable={editable} onChangeText={(t) => edit((z) => ({ ...z, title: t }))} />
              <Input label="Instructions" multiline value={d.instructions ?? ""} editable={editable} onChangeText={(t) => edit((z) => ({ ...z, instructions: t }))} />
              <Row>
                <Input label="Pass %" value={String(d.pass_percentage)} keyboardType="number-pad" style={{ width: 90 }} onChangeText={(t) => edit((z) => ({ ...z, pass_percentage: Number(t) || 0 }))} />
                <Input label="Max attempts (0 = unlimited)" value={String(d.max_attempts)} keyboardType="number-pad" style={{ width: 90 }} onChangeText={(t) => edit((z) => ({ ...z, max_attempts: Number(t) || 0 }))} />
                <Input label="Time limit (min)" value={d.time_limit_minutes ? String(d.time_limit_minutes) : ""} keyboardType="number-pad" style={{ width: 90 }} onChangeText={(t) => edit((z) => ({ ...z, time_limit_minutes: Number(t) || null }))} />
              </Row>
              <Input label="Available from (ISO date-time, optional)" value={d.available_from ?? ""} onChangeText={(t) => edit((z) => ({ ...z, available_from: t || null }))} placeholder="2026-09-10T09:00:00Z" />
              <Input label="Due at (ISO date-time, optional)" value={d.due_at ?? ""} onChangeText={(t) => edit((z) => ({ ...z, due_at: t || null }))} placeholder="2026-09-30T23:59:00Z" />
            </Card>
          ) : <AttemptsTab quizId={id} />}
        </>
      ) : null}
    </Screen>
  );
}

function AttemptsTab({ quizId }: { quizId: string }) {
  const q = useAsync(() => manage.quizAttempts(quizId), [quizId]);
  const [openId, setOpenId] = useState<string | null>(null);
  const [overrides, setOverrides] = useState<Record<string, { score_awarded: number; feedback?: string }>>({});
  const re = useAction(async (attemptId: string, withOverrides: boolean) => { await manage.reEvaluate(attemptId, withOverrides ? overrides : undefined); setOverrides({}); await q.reload(); });
  return (
    <>
      <ErrorBanner message={q.error ?? re.error} onRetry={q.reload} />
      {q.loading ? <Loading /> : null}
      {q.data?.length === 0 ? <P muted>No attempts yet.</P> : null}
      {q.data?.map((a) => (
        <Card key={a.id}>
          <Row style={{ justifyContent: "space-between" }}>
            <View style={{ flex: 1 }}><P style={{ fontWeight: "600" }}>{a.student_email}</P><P muted small>attempt {a.attempt_number} · {fmtDate(a.submitted_at)} · {fmtSeconds(a.time_taken_seconds)}</P></View>
            <Badge value={a.status === "evaluated" ? `${pct(a.percentage)} ${a.passed ? "pass" : "fail"}` : a.status} color={a.status !== "evaluated" ? colors.warning : a.passed ? colors.success : colors.danger} />
            <Button title={openId === a.id ? "Hide" : "Review"} small variant="ghost" onPress={() => setOpenId(openId === a.id ? null : a.id)} />
          </Row>
          {openId === a.id ? (
            <>
              {a.detailed_results.map((r, i) => (
                <View key={r.question_id} style={{ borderTopWidth: 1, borderColor: colors.border, paddingTop: 8, gap: 4 }}>
                  <P small><Text style={{ fontWeight: "700" }}>{i + 1}.</Text> {r.question}</P>
                  {r.type === "mcq" ? <P muted small>Selected {r.selected_option ?? "—"} · correct {r.correct_option} · {r.is_correct ? "correct" : "wrong"}</P> : (
                    <>
                      <P small>{r.student_answer || "(blank)"}</P>
                      <P muted small>Awarded: {r.score_awarded ?? "pending"} {r.feedback ? `· ${r.feedback}` : ""}</P>
                      <Row>
                        {[0, 0.5, 1].map((v) => <Chip key={v} label={`${v}`} selected={overrides[r.question_id]?.score_awarded === v} onPress={() => setOverrides((o) => ({ ...o, [r.question_id]: { ...o[r.question_id], score_awarded: v } }))} />)}
                        <View style={{ flex: 1 }}><Input placeholder="Feedback" value={overrides[r.question_id]?.feedback ?? ""} onChangeText={(t) => setOverrides((o) => ({ ...o, [r.question_id]: { score_awarded: o[r.question_id]?.score_awarded ?? 0, feedback: t } }))} /></View>
                      </Row>
                    </>
                  )}
                </View>
              ))}
              <Row>
                {Object.keys(overrides).length ? <Button title="Apply overrides" small onPress={() => re.run(a.id, true)} busy={re.busy} /> : null}
                <Button title="Re-run AI evaluation" small variant="secondary" onPress={() => re.run(a.id, false)} busy={re.busy} />
              </Row>
            </>
          ) : null}
        </Card>
      ))}
    </>
  );
}
