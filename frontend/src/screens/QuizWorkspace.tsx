import { useRouter } from "expo-router";
import React, { useEffect, useMemo, useState } from "react";
import { StyleSheet, Text, View } from "react-native";
import { manage } from "@/api/endpoints";
import type { Attempt, Question, Quiz } from "@/api/types";
import { useAction, useAsync } from "@/hooks/useAsync";
import { useDebounced } from "@/hooks/useDebounced";
import {
  Badge, Button, Chip, ErrorBanner, Input, Loading, Notice, P, Row, Screen,
  colors, confirmAsync, confirmDeleteAsync, fmtDate, fmtSeconds, pct, radiusSm, space,
} from "@/ui";
import { ModulePicker } from "@/ui/ModulePicker";
import { ResultsRelease, type ReleaseMode, releaseSummary } from "@/ui/ResultsRelease";
import {
  DetailPane, EmptyPane, Foot, FootState, Hint, ListItem, ListPane, PaneScroll, Rows, SectionLabel,
  SettingRow, Strip, Tabs, WorkspaceBody, useSplit,
} from "@/ui/workspace";

type Tab = "questions" | "sources" | "settings" | "attempts";
const STATUS_TABS = [
  { key: "", label: "All" }, { key: "draft", label: "Drafts" },
  { key: "published", label: "Published" }, { key: "closed", label: "Closed" },
];

/**
 * Every quiz in one screen: the list on the left, the open quiz on the right.
 *
 * The list and the editor used to be separate routes, which meant a round trip
 * through a list screen to look at the next quiz, and a "New quiz" form that
 * lived somewhere else again. Both routes still exist and both land here, with
 * the id preselected or the builder open.
 */
export default function QuizWorkspace({ initialId, startNew }: { initialId?: string; startNew?: boolean }) {
  const router = useRouter();
  const split = useSplit();
  const [status, setStatus] = useState("");
  const [search, setSearch] = useState("");
  const needle = useDebounced(search, 150).trim().toLowerCase();
  const list = useAsync(() => manage.quizzes({ status: status || undefined }), [status]);
  const [selected, setSelected] = useState<string | null>(initialId ?? (startNew ? "new" : null));
  useEffect(() => { if (initialId) setSelected(initialId); }, [initialId]);
  // On a wide window the right pane would sit empty, so the first quiz opens.
  useEffect(() => {
    if (!selected && split && list.data?.length) setSelected(list.data[0].id);
  }, [list.data, selected, split]);

  const rows = useMemo(() => {
    const all = list.data ?? [];
    if (!needle) return all;
    return all.filter((z) => z.title.toLowerCase().includes(needle));
  }, [list.data, needle]);

  const openDetail = !!selected && (!split ? true : true);
  const listPane = (
    <ListPane
      split={split}
      title="Quizzes"
      action={<Button title="New Quiz" icon="add-outline" small variant="ghost" onPress={() => setSelected("new")} />}
      meta={`${list.data?.length ?? 0} in the subjects you manage`}
      filters={
        <>
          <Input compact value={search} onChangeText={setSearch} placeholder="Search" />
          <Tabs tabs={STATUS_TABS} value={status} onChange={setStatus} />
        </>
      }
    >
      {list.loading && !list.data ? <Loading /> : null}
      {rows.length === 0 && !list.loading ? <Hint>No quizzes here yet.</Hint> : null}
      {rows.map((z) => (
        <ListItem
          key={z.id}
          title={z.title}
          meta={`${z.status} · ${z.question_count ?? 0} questions · ${z.attempt_count ?? 0} attempts`}
          warn={releaseSummary(z.results_release ?? "immediate", z.results_release_at, z.pending_release_count)}
          selected={selected === z.id}
          onPress={() => setSelected(z.id)}
        />
      ))}
    </ListPane>
  );

  const detail = (
    <DetailPane>
      {selected === "new" ? (
        <QuizBuilder
          onCancel={() => setSelected(list.data?.[0]?.id ?? null)}
          onCreated={async (id) => { await list.reload(); setSelected(id); }}
          onBack={split ? undefined : () => setSelected(null)}
        />
      ) : selected ? (
        <QuizDetail
          key={selected}
          id={selected}
          onChanged={list.reload}
          onDeleted={() => { setSelected(null); list.reload(); router.setParams?.({}); }}
          onBack={split ? undefined : () => setSelected(null)}
        />
      ) : (
        <EmptyPane title="Pick a quiz" text="Choose one on the left, or start a new one and select the modules it should be written from." icon="help-circle-outline" />
      )}
    </DetailPane>
  );

  return (
    <Screen scroll={false} padded={false} wide>
      <View style={{ flex: 1, minHeight: 0 }}>
        <ErrorBanner message={list.error} onRetry={list.reload} />
        <WorkspaceBody>
          {split ? <>{listPane}{detail}</> : (openDetail && selected ? detail : listPane)}
        </WorkspaceBody>
      </View>
    </Screen>
  );
}

/* ------------------------------------------------------------------ */
/* One quiz                                                            */
/* ------------------------------------------------------------------ */

function QuizDetail({ id, onChanged, onDeleted, onBack }: { id: string; onChanged: () => void; onDeleted: () => void; onBack?: () => void }) {
  const router = useRouter();
  const q = useAsync(() => manage.quiz(id), [id]);
  const [tab, setTab] = useState<Tab>("questions");
  const [draft, setDraft] = useState<Quiz | null>(null);
  const [dirty, setDirty] = useState(false);
  useEffect(() => { if (q.data) { setDraft(JSON.parse(JSON.stringify(q.data))); setDirty(false); } }, [q.data]);

  const edit = (fn: (z: Quiz) => Quiz) => { setDraft((z) => (z ? fn(z) : z)); setDirty(true); };
  const editQ = (i: number, fn: (x: Question) => Question) =>
    edit((z) => ({ ...z, questions: (z.questions ?? []).map((x, j) => (j === i ? fn(x) : x)) }));

  const save = useAction(async () => {
    if (!draft) return;
    const res = await manage.updateQuiz(id, {
      title: draft.title, instructions: draft.instructions, questions: draft.questions,
      pass_percentage: draft.pass_percentage, max_attempts: draft.max_attempts,
      time_limit_minutes: draft.time_limit_minutes, due_at: draft.due_at || null,
      available_from: draft.available_from || null,
      results_release: draft.results_release, results_release_at: draft.results_release_at || null,
    });
    onChanged();
    // Editing questions on a quiz with attempts mints a new version row.
    if (res.id !== id) router.replace(`/manage/quiz/${res.id}`); else await q.reload();
  });
  const setStatus = useAction(async (s: string) => { await manage.quizStatus(id, s); onChanged(); await q.reload(); });
  const release = useAction(async (attemptId?: string) => {
    const d = q.data;
    if (!d) return;
    if (!attemptId) {
      const ok = await confirmAsync(
        "Release results to everyone?",
        `${d.pending_release_count ?? 0} attempt${(d.pending_release_count ?? 0) === 1 ? "" : "s"} will become visible to the students who made them. Releasing cannot be undone.`,
        "Release Results", "Not Yet",
      );
      if (!ok) return;
    }
    await manage.releaseQuizResults(id, attemptId);
    onChanged();
    await q.reload();
  });
  const remove = useAction(async () => {
    const d = q.data;
    if (!d) return;
    const attempts = d.attempt_count ?? 0;
    const ok = await confirmDeleteAsync(
      "Delete this quiz?",
      attempts
        ? `This permanently removes the quiz and the ${attempts} student attempt${attempts === 1 ? "" : "s"} recorded against it, including their scores. It cannot be undone.`
        : "This permanently removes the quiz and any results recorded against it. It cannot be undone.",
      { detail: d.title, okLabel: "Delete Quiz" },
    );
    if (!ok) return;
    await manage.deleteQuiz(id);
    onDeleted();
  });

  if (q.loading && !draft) return <Loading />;
  if (!draft) return <ErrorBanner message={q.error} onRetry={q.reload} />;
  const d = draft;
  const editable = d.status !== "superseded";
  const pending = q.data?.pending_release_count ?? 0;
  const mode = (d.results_release ?? "immediate") as ReleaseMode;

  return (
    <>
      <View style={qs.head}>
        <Row>
          {onBack ? <Button title="Quizzes" icon="chevron-back" small variant="ghost" onPress={onBack} /> : null}
          <View style={{ flex: 1, minWidth: 200 }}>
            <Input value={d.title} onChangeText={(t) => edit((z) => ({ ...z, title: t }))} editable={editable} />
          </View>
          <Badge value={d.status} />
          {mode !== "immediate" ? <Badge value={mode === "held" ? "results held" : "results scheduled"} color={colors.warning} /> : null}
        </Row>
        <Text style={qs.where}>
          {sourceLine(d)} · {d.generator === "ai" ? "written by the tutor model" : d.generator === "fallback" ? "placeholder questions, edit before publishing" : "written by hand"}
          {d.version > 1 ? ` · version ${d.version}` : ""}
        </Text>
        <Tabs
          big
          value={tab}
          onChange={(k) => setTab(k as Tab)}
          tabs={[
            { key: "questions", label: "Questions", count: d.questions?.length ?? 0 },
            { key: "sources", label: "Sources", count: (d.source_module_ids?.length ?? 0) || null },
            { key: "settings", label: "Settings" },
            { key: "attempts", label: "Attempts", count: d.attempt_count ?? 0 },
          ]}
        />
      </View>

      <PaneScroll>
        <ErrorBanner message={save.error ?? setStatus.error ?? release.error ?? remove.error} />
        {pending ? (
          <Strip
            text={`${pending} attempt${pending === 1 ? "" : "s"} waiting for you to release results.`}
            action={<Button title="Release results" small onPress={() => release.run()} busy={release.busy} />}
          />
        ) : null}
        {d.generator === "fallback" ? <Notice tone="warning" message="This draft was produced without the AI. Placeholder options are marked; rewrite them before publishing." /> : null}

        {tab === "questions" ? <QuestionsTab quiz={d} editable={editable} edit={edit} editQ={editQ} /> : null}
        {tab === "sources" ? <SourcesTab quiz={d} /> : null}
        {tab === "settings" ? <SettingsTab quiz={d} editable={editable} edit={edit} /> : null}
        {tab === "attempts" ? <AttemptsTab quizId={id} mode={mode} onRelease={(a) => release.run(a)} /> : null}
      </PaneScroll>

      <Foot>
        <Button title="Save Changes" icon="save-outline" small onPress={() => save.run()} busy={save.busy} disabled={!dirty || !editable} />
        {d.status === "draft" || d.status === "closed" ? <Button title="Publish" small variant="secondary" onPress={() => setStatus.run("published")} busy={setStatus.busy} disabled={dirty} /> : null}
        {d.status === "published" ? <Button title="Close" small variant="secondary" onPress={() => setStatus.run("closed")} busy={setStatus.busy} /> : null}
        <FootState dirty={dirty} text={dirty ? "Unsaved changes" : d.status === "published" ? "Live for enrolled students" : d.status === "draft" ? "Not visible to students" : "Everything saved"} />
        <View style={{ flex: 1 }} />
        <Button title="Delete" icon="trash-outline" small variant="danger" onPress={() => remove.run()} busy={remove.busy} />
      </Foot>
    </>
  );
}

function sourceLine(d: Quiz) {
  const n = d.source_module_ids?.length ?? 0;
  if (n > 1) return `${n} modules`;
  if (d.kind === "chapter") return "whole chapter";
  return "one module";
}

/* ---------- tabs ---------- */

function QuestionsTab({ quiz, editable, edit, editQ }: {
  quiz: Quiz; editable: boolean; edit: (fn: (z: Quiz) => Quiz) => void; editQ: (i: number, fn: (x: Question) => Question) => void;
}) {
  const questions = quiz.questions ?? [];
  const add = (type: "mcq" | "subjective") => edit((z) => ({
    ...z,
    questions: [...(z.questions ?? []), type === "mcq"
      ? { id: `q${Date.now()}`, type, question: "", options: ["A", "B", "C", "D"].map((k) => ({ key: k, text: "" })), correct_answer: "A", explanation: "" }
      : { id: `q${Date.now()}`, type, question: "", expected_rubric: "" }],
  }));
  return (
    <>
      {questions.length === 0 ? <Hint>No questions yet. Add one, or start again from the Sources tab.</Hint> : null}
      {questions.map((qq, i) => (
        <View key={qq.id} style={qs.card}>
          <Row style={{ justifyContent: "space-between" }}>
            <Text style={qs.qid}>Q{i + 1} · {qq.type === "mcq" ? "multiple choice" : "open ended"}</Text>
            {editable ? <Button title="Remove" small variant="ghost" onPress={() => edit((z) => ({ ...z, questions: (z.questions ?? []).filter((_, j) => j !== i) }))} /> : null}
          </Row>
          <Input multiline value={qq.question} editable={editable} onChangeText={(t) => editQ(i, (x) => ({ ...x, question: t }))} style={{ minHeight: 64 }} />
          {qq.type === "mcq" ? (
            <>
              {qq.options?.map((o, oi) => (
                <Row key={o.key}>
                  <Chip label={o.key} selected={qq.correct_answer === o.key} onPress={() => editable && editQ(i, (x) => ({ ...x, correct_answer: o.key }))} />
                  <View style={{ flex: 1, minWidth: 160 }}>
                    <Input value={o.text} editable={editable}
                      onChangeText={(t) => editQ(i, (x) => ({ ...x, options: (x.options ?? []).map((p, pj) => (pj === oi ? { ...p, text: t } : p)) }))} />
                  </View>
                </Row>
              ))}
              <Hint>Tap a letter to mark it correct.</Hint>
              <Input label="Explanation shown after marking" value={qq.explanation ?? ""} editable={editable} onChangeText={(t) => editQ(i, (x) => ({ ...x, explanation: t }))} />
            </>
          ) : (
            <Input label="Rubric the model marks against" multiline value={qq.expected_rubric ?? ""} editable={editable} onChangeText={(t) => editQ(i, (x) => ({ ...x, expected_rubric: t }))} />
          )}
          {qq.source_reference ? <Text style={qs.src}>Source: {qq.source_reference}</Text> : null}
        </View>
      ))}
      {editable ? (
        <Row>
          <Button title="Add multiple choice" small variant="secondary" onPress={() => add("mcq")} />
          <Button title="Add open ended" small variant="secondary" onPress={() => add("subjective")} />
        </Row>
      ) : null}
    </>
  );
}

function SourcesTab({ quiz }: { quiz: Quiz }) {
  const ids = quiz.source_module_ids ?? [];
  return (
    <>
      <SectionLabel>Modules the questions were written from</SectionLabel>
      {ids.length ? (
        <ModulePicker value={ids} onChange={() => {}} subjectId={quiz.subject_id} disabled />
      ) : (
        <Hint>
          {quiz.kind === "chapter"
            ? "This quiz was written from a whole chapter, so it follows that chapter as its modules change."
            : "This quiz was written from a single module."}
        </Hint>
      )}
      <Notice message="Changing what a quiz is written from does not rewrite its questions. Generate a new quiz from the modules you want instead." />
    </>
  );
}

function SettingsTab({ quiz, editable, edit }: { quiz: Quiz; editable: boolean; edit: (fn: (z: Quiz) => Quiz) => void }) {
  const mode = (quiz.results_release ?? "immediate") as ReleaseMode;
  return (
    <>
      <SectionLabel>Taking the quiz</SectionLabel>
      <Rows>
        <SettingRow label="Pass mark">
          <Input compact value={String(quiz.pass_percentage)} keyboardType="number-pad" containerStyle={{ width: 80 }}
            onChangeText={(t) => edit((z) => ({ ...z, pass_percentage: Number(t) || 0 }))} editable={editable} />
          <Hint>%</Hint>
        </SettingRow>
        <SettingRow label="Attempts allowed">
          <Input compact value={quiz.max_attempts ? String(quiz.max_attempts) : ""} placeholder="unlimited" keyboardType="number-pad" containerStyle={{ width: 110 }}
            onChangeText={(t) => edit((z) => ({ ...z, max_attempts: Number(t) || 0 }))} editable={editable} />
        </SettingRow>
        <SettingRow label="Time limit">
          <Input compact value={quiz.time_limit_minutes ? String(quiz.time_limit_minutes) : ""} placeholder="none" keyboardType="number-pad" containerStyle={{ width: 110 }}
            onChangeText={(t) => edit((z) => ({ ...z, time_limit_minutes: Number(t) || null }))} editable={editable} />
          <Hint>minutes</Hint>
        </SettingRow>
        <SettingRow label="Available from">
          <Input compact value={quiz.available_from ?? ""} placeholder="2026-09-10T09:00:00Z" containerStyle={{ flex: 1, minWidth: 200 }}
            onChangeText={(t) => edit((z) => ({ ...z, available_from: t || null }))} editable={editable} />
        </SettingRow>
        <SettingRow label="Due">
          <Input compact value={quiz.due_at ?? ""} placeholder="2026-09-30T23:59:00Z" containerStyle={{ flex: 1, minWidth: 200 }}
            onChangeText={(t) => edit((z) => ({ ...z, due_at: t || null }))} editable={editable} />
        </SettingRow>
        <SettingRow label="Instructions">
          <Input compact multiline value={quiz.instructions ?? ""} containerStyle={{ flex: 1, minWidth: 200 }}
            onChangeText={(t) => edit((z) => ({ ...z, instructions: t }))} editable={editable} />
        </SettingRow>
      </Rows>

      <SectionLabel>Results</SectionLabel>
      <Rows>
        <SettingRow label="Students see results" top>
          <ResultsRelease
            value={mode}
            at={quiz.results_release_at ?? null}
            disabled={!editable}
            onChange={(m, at) => edit((z) => ({ ...z, results_release: m, results_release_at: at }))}
          />
        </SettingRow>
      </Rows>
    </>
  );
}

function AttemptsTab({ quizId, mode, onRelease }: { quizId: string; mode: ReleaseMode; onRelease: (attemptId: string) => void }) {
  const q = useAsync(() => manage.quizAttempts(quizId), [quizId]);
  const [openId, setOpenId] = useState<string | null>(null);
  const [overrides, setOverrides] = useState<Record<string, { score_awarded: number; feedback?: string }>>({});
  const re = useAction(async (attemptId: string, withOverrides: boolean) => {
    await manage.reEvaluate(attemptId, withOverrides ? overrides : undefined);
    setOverrides({});
    await q.reload();
  });
  return (
    <>
      <ErrorBanner message={q.error ?? re.error} onRetry={q.reload} />
      {q.loading && !q.data ? <Loading /> : null}
      {q.data?.length === 0 ? <Hint>No attempts yet.</Hint> : null}
      {q.data?.map((a: Attempt) => (
        <View key={a.id} style={qs.card}>
          <Row style={{ justifyContent: "space-between" }}>
            <View style={{ flex: 1, minWidth: 160 }}>
              <P style={{ fontWeight: "600" }}>{a.student_email}</P>
              <P muted small>attempt {a.attempt_number} · {fmtDate(a.submitted_at)} · {fmtSeconds(a.time_taken_seconds)}</P>
            </View>
            <Badge
              value={a.status === "evaluated" ? `${pct(a.percentage)} ${a.passed ? "pass" : "fail"}` : a.status}
              color={a.status !== "evaluated" ? colors.warning : a.passed ? colors.success : colors.danger}
            />
            {mode !== "immediate" && !a.results_released_at ? (
              <Button title="Release" small variant="secondary" onPress={() => onRelease(a.id)} />
            ) : null}
            <Button title={openId === a.id ? "Hide" : "Review"} small variant="ghost" onPress={() => setOpenId(openId === a.id ? null : a.id)} />
          </Row>
          {openId === a.id ? (
            <>
              {a.detailed_results.map((r, i) => (
                <View key={r.question_id} style={qs.result}>
                  <P small><Text style={{ fontWeight: "700" }}>{i + 1}.</Text> {r.question}</P>
                  {r.type === "mcq" ? (
                    <P muted small>Selected {r.selected_option ?? "—"} · correct {r.correct_option} · {r.is_correct ? "correct" : "wrong"}</P>
                  ) : (
                    <>
                      <P small>{r.student_answer || "(blank)"}</P>
                      <P muted small>Awarded: {r.score_awarded ?? "pending"} {r.feedback ? `· ${r.feedback}` : ""}</P>
                      <Row>
                        {[0, 0.5, 1].map((v) => (
                          <Chip key={v} label={`${v}`} selected={overrides[r.question_id]?.score_awarded === v}
                            onPress={() => setOverrides((o) => ({ ...o, [r.question_id]: { ...o[r.question_id], score_awarded: v } }))} />
                        ))}
                        <View style={{ flex: 1, minWidth: 160 }}>
                          <Input compact placeholder="Feedback" value={overrides[r.question_id]?.feedback ?? ""}
                            onChangeText={(t) => setOverrides((o) => ({ ...o, [r.question_id]: { score_awarded: o[r.question_id]?.score_awarded ?? 0, feedback: t } }))} />
                        </View>
                      </Row>
                    </>
                  )}
                </View>
              ))}
              <Row>
                {Object.keys(overrides).length ? <Button title="Apply Overrides" small onPress={() => re.run(a.id, true)} busy={re.busy} /> : null}
                <Button title="Re-Run AI Evaluation" small variant="secondary" onPress={() => re.run(a.id, false)} busy={re.busy} />
              </Row>
            </>
          ) : null}
        </View>
      ))}
    </>
  );
}

/* ------------------------------------------------------------------ */
/* New quiz                                                            */
/* ------------------------------------------------------------------ */

function QuizBuilder({ onCancel, onCreated, onBack }: { onCancel: () => void; onCreated: (id: string) => void; onBack?: () => void }) {
  const [modules, setModules] = useState<string[]>([]);
  const [title, setTitle] = useState("");
  const [mcqs, setMcqs] = useState("6");
  const [written, setWritten] = useState("2");
  const [pass, setPass] = useState("65");
  const [attempts, setAttempts] = useState("3");
  const [limit, setLimit] = useState("");
  const [due, setDue] = useState("");
  const [release, setRelease] = useState<ReleaseMode>("immediate");
  const [releaseAt, setReleaseAt] = useState<string | null>(null);

  const common = () => ({
    module_ids: modules,
    title: title || undefined,
    pass_percentage: Number(pass) || undefined,
    max_attempts: Number(attempts) || undefined,
    time_limit_minutes: Number(limit) || undefined,
    due_at: due || undefined,
    results_release: release,
    results_release_at: release === "scheduled" ? releaseAt : undefined,
  });
  const generate = useAction(async () => {
    const quiz = await manage.generateQuiz({ ...common(), num_mcqs: Number(mcqs), num_subjective: Number(written) });
    onCreated(quiz.id);
  });
  const blank = useAction(async () => {
    const quiz = await manage.createQuiz({
      ...common(),
      title: title || "Untitled quiz",
      questions: [{ type: "mcq", question: "Replace this question", options: ["A", "B", "C", "D"].map((k) => ({ key: k, text: `Option ${k}` })), correct_answer: "A", explanation: "" }],
    });
    onCreated(quiz.id);
  });
  const ready = modules.length > 0 && (release !== "scheduled" || !!releaseAt);

  return (
    <>
      <View style={qs.head}>
        <Row>
          {onBack ? <Button title="Quizzes" icon="chevron-back" small variant="ghost" onPress={onBack} /> : null}
          <View style={{ flex: 1, minWidth: 200 }}>
            <Input value={title} onChangeText={setTitle} placeholder="New quiz — leave blank and the modules name it" />
          </View>
        </Row>
      </View>
      <PaneScroll>
        <ErrorBanner message={generate.error ?? blank.error} />
        <SectionLabel>Written from</SectionLabel>
        <ModulePicker value={modules} onChange={setModules} />
        <Hint>Questions are grounded only in the text of the modules you tick, sampled evenly so no one module dominates.</Hint>

        <SectionLabel>Questions to generate</SectionLabel>
        <Rows>
          <SettingRow label="Multiple choice"><Input compact value={mcqs} onChangeText={setMcqs} keyboardType="number-pad" containerStyle={{ width: 80 }} /></SettingRow>
          <SettingRow label="Open ended">
            <Input compact value={written} onChangeText={setWritten} keyboardType="number-pad" containerStyle={{ width: 80 }} />
            <Hint>marked by the tutor model against a rubric</Hint>
          </SettingRow>
          <SettingRow label="Pass mark"><Input compact value={pass} onChangeText={setPass} keyboardType="number-pad" containerStyle={{ width: 80 }} /><Hint>%</Hint></SettingRow>
          <SettingRow label="Attempts allowed"><Input compact value={attempts} onChangeText={setAttempts} keyboardType="number-pad" containerStyle={{ width: 80 }} /></SettingRow>
          <SettingRow label="Time limit">
            <Input compact value={limit} onChangeText={setLimit} placeholder="none" keyboardType="number-pad" containerStyle={{ width: 110 }} />
            <Hint>minutes</Hint>
          </SettingRow>
          <SettingRow label="Due"><Input compact value={due} onChangeText={setDue} placeholder="2026-09-30T23:59:00Z" containerStyle={{ flex: 1, minWidth: 200 }} /></SettingRow>
        </Rows>

        <SectionLabel>Results</SectionLabel>
        <Rows>
          <SettingRow label="Students see results" top>
            <ResultsRelease value={release} at={releaseAt} onChange={(m, at) => { setRelease(m); setReleaseAt(at); }} />
          </SettingRow>
        </Rows>

        <Notice message="If the AI is unavailable you get a clearly labelled placeholder draft to edit; it cannot be published as it stands." />
      </PaneScroll>
      <Foot>
        <Button title="Generate Questions" small onPress={() => generate.run()} busy={generate.busy} disabled={!ready} />
        <Button title="Write Them Myself" small variant="secondary" onPress={() => blank.run()} busy={blank.busy} disabled={!ready} />
        <FootState text={modules.length ? `${modules.length} module${modules.length === 1 ? "" : "s"} selected` : "Select at least one module"} />
        <View style={{ flex: 1 }} />
        <Button title="Cancel" small variant="ghost" onPress={onCancel} />
      </Foot>
    </>
  );
}

const qs = StyleSheet.create({
  head: { paddingHorizontal: space.lg, paddingTop: space.md, gap: space.sm },
  where: { fontSize: 12.5, color: colors.faint },
  card: { borderWidth: 1, borderColor: colors.border, borderRadius: 12, padding: space.md, gap: space.sm, backgroundColor: colors.surface },
  qid: { fontSize: 12, color: colors.faint, fontWeight: "600" },
  src: { fontSize: 12.5, color: colors.faint },
  result: { borderTopWidth: 1, borderColor: colors.border, paddingTop: 8, gap: 4, marginTop: 4 },
  chip: { borderRadius: radiusSm },
});
