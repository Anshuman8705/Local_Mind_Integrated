import { useRouter } from "expo-router";
import React, { useEffect, useMemo, useState } from "react";
import { StyleSheet, Text, View } from "react-native";
import { manage } from "@/api/endpoints";
import type { Assignment } from "@/api/types";
import { useAction, useAsync } from "@/hooks/useAsync";
import { useDebounced } from "@/hooks/useDebounced";
import {
  Badge, Button, Chip, ErrorBanner, Input, Loading, Notice, P, Row, Screen,
  colors, confirmAsync, confirmDeleteAsync, fmtDate, space,
} from "@/ui";
import { ModulePicker } from "@/ui/ModulePicker";
import { ResultsRelease, type ReleaseMode, releaseSummary } from "@/ui/ResultsRelease";
import {
  DetailPane, EmptyPane, Foot, FootState, Hint, ListItem, ListPane, PaneScroll, Rows, SectionLabel,
  SettingRow, Strip, Tabs, WorkspaceBody, useSplit,
} from "@/ui/workspace";

type Tab = "brief" | "sources" | "settings" | "submissions";
const STATUS_TABS = [
  { key: "", label: "All" }, { key: "draft", label: "Drafts" },
  { key: "published", label: "Published" }, { key: "closed", label: "Closed" },
];

/**
 * Every assignment in one screen, laid out like the quizzes: list on the left,
 * the open assignment on the right. Both existing routes land here.
 */
export default function AssignmentWorkspace({ initialId, startNew }: { initialId?: string; startNew?: boolean }) {
  const split = useSplit();
  const [status, setStatus] = useState("");
  const [search, setSearch] = useState("");
  const needle = useDebounced(search, 150).trim().toLowerCase();
  const list = useAsync(() => manage.assignments({ status: status || undefined }), [status]);
  const [selected, setSelected] = useState<string | null>(initialId ?? (startNew ? "new" : null));
  useEffect(() => { if (initialId) setSelected(initialId); }, [initialId]);
  useEffect(() => {
    if (!selected && split && list.data?.length) setSelected(list.data[0].id);
  }, [list.data, selected, split]);

  const rows = useMemo(() => {
    const all = list.data ?? [];
    return needle ? all.filter((a) => a.title.toLowerCase().includes(needle)) : all;
  }, [list.data, needle]);

  const listPane = (
    <ListPane
      split={split}
      title="Assignments"
      action={<Button title="New" icon="add-outline" small variant="ghost" onPress={() => setSelected("new")} />}
      meta={`${list.data?.length ?? 0} in the subjects you manage`}
      filters={
        <>
          <Input compact value={search} onChangeText={setSearch} placeholder="Search" />
          <Tabs tabs={STATUS_TABS} value={status} onChange={setStatus} />
        </>
      }
    >
      {list.loading && !list.data ? <Loading /> : null}
      {rows.length === 0 && !list.loading ? <Hint>No assignments here yet.</Hint> : null}
      {rows.map((a) => (
        <ListItem
          key={a.id}
          title={a.title}
          meta={`${a.status} · ${a.max_score} points · ${a.submission_count ?? 0} submissions`}
          warn={releaseSummary(a.results_release ?? "immediate", a.results_release_at, a.pending_release_count)}
          selected={selected === a.id}
          onPress={() => setSelected(a.id)}
        />
      ))}
    </ListPane>
  );

  const detail = (
    <DetailPane>
      {selected === "new" ? (
        <AssignmentBuilder
          onCancel={() => setSelected(list.data?.[0]?.id ?? null)}
          onCreated={async (id) => { await list.reload(); setSelected(id); }}
          onBack={split ? undefined : () => setSelected(null)}
        />
      ) : selected ? (
        <AssignmentDetail
          key={selected}
          id={selected}
          onChanged={list.reload}
          onDeleted={() => { setSelected(null); list.reload(); }}
          onBack={split ? undefined : () => setSelected(null)}
        />
      ) : (
        <EmptyPane title="Pick an assignment" text="Choose one on the left, or start a new one and select the modules it should be drafted from." icon="create-outline" />
      )}
    </DetailPane>
  );

  return (
    <Screen scroll={false} padded={false} wide>
      <View style={{ flex: 1, minHeight: 0 }}>
        <ErrorBanner message={list.error} onRetry={list.reload} />
        <WorkspaceBody>
          {split ? <>{listPane}{detail}</> : (selected ? detail : listPane)}
        </WorkspaceBody>
      </View>
    </Screen>
  );
}

/* ------------------------------------------------------------------ */
/* One assignment                                                      */
/* ------------------------------------------------------------------ */

function AssignmentDetail({ id, onChanged, onDeleted, onBack }: { id: string; onChanged: () => void; onDeleted: () => void; onBack?: () => void }) {
  const q = useAsync(() => manage.assignment(id), [id]);
  const [tab, setTab] = useState<Tab>("brief");
  const [d, setD] = useState<Assignment | null>(null);
  const [dirty, setDirty] = useState(false);
  useEffect(() => { if (q.data) { setD(JSON.parse(JSON.stringify(q.data))); setDirty(false); } }, [q.data]);
  const edit = (fn: (a: Assignment) => Assignment) => { setD((a) => (a ? fn(a) : a)); setDirty(true); };

  const save = useAction(async () => {
    if (!d) return;
    await manage.updateAssignment(id, {
      title: d.title, description: d.description, instructions: d.instructions, rubric: d.rubric,
      max_score: d.max_score, due_at: d.due_at || null, available_from: d.available_from || null,
      allow_late: d.allow_late, allow_resubmission: d.allow_resubmission,
      results_release: d.results_release, results_release_at: d.results_release_at || null,
    });
    onChanged();
    await q.reload();
  });
  const setStatus = useAction(async (s: string) => { await manage.assignmentStatus(id, s); onChanged(); await q.reload(); });
  const release = useAction(async (submissionId?: string) => {
    if (!q.data) return;
    if (!submissionId) {
      const n = q.data.pending_release_count ?? 0;
      const ok = await confirmAsync(
        "Release marks to everyone?",
        `${n} submission${n === 1 ? "" : "s"} will become visible to the students who made them, with their score and feedback. Releasing cannot be undone.`,
        "Release Marks", "Not Yet",
      );
      if (!ok) return;
    }
    await manage.releaseAssignmentResults(id, submissionId);
    onChanged();
    await q.reload();
  });
  const remove = useAction(async () => {
    if (!q.data) return;
    const count = q.data.submission_count ?? 0;
    const ok = await confirmDeleteAsync(
      "Delete this assignment?",
      count
        ? `This permanently removes the assignment and the ${count} submission${count === 1 ? "" : "s"} against it, including any marks and feedback already given. It cannot be undone.`
        : "This permanently removes the assignment and any submissions against it. It cannot be undone.",
      { detail: q.data.title, okLabel: "Delete Assignment" },
    );
    if (!ok) return;
    await manage.deleteAssignment(id);
    onDeleted();
  });

  if (q.loading && !d) return <Loading />;
  if (!d) return <ErrorBanner message={q.error} onRetry={q.reload} />;
  const rubricTotal = d.rubric.reduce((t, r) => t + (Number(r.points) || 0), 0);
  const balanced = rubricTotal === d.max_score;
  const pending = q.data?.pending_release_count ?? 0;
  const mode = (d.results_release ?? "immediate") as ReleaseMode;
  const sources = d.source_module_ids?.length ?? 0;

  return (
    <>
      <View style={as.head}>
        <Row>
          {onBack ? <Button title="Assignments" icon="chevron-back" small variant="ghost" onPress={onBack} /> : null}
          <View style={{ flex: 1, minWidth: 200 }}>
            <Input value={d.title} onChangeText={(t) => edit((a) => ({ ...a, title: t }))} />
          </View>
          <Badge value={d.status} />
          {mode !== "immediate" ? <Badge value={mode === "held" ? "marks held" : "marks scheduled"} color={colors.warning} /> : null}
        </Row>
        <Text style={as.where}>
          {sources > 1 ? `${sources} modules` : d.chapter_id ? "whole chapter" : d.module_id ? "one module" : "whole subject"}
          {" · "}{d.generator === "ai" ? "drafted by the tutor model" : d.generator === "fallback" ? "fallback draft, review before publishing" : "written by hand"}
        </Text>
        <Tabs
          big
          value={tab}
          onChange={(k) => setTab(k as Tab)}
          tabs={[
            { key: "brief", label: "Brief" },
            { key: "sources", label: "Sources", count: sources || null },
            { key: "settings", label: "Settings" },
            { key: "submissions", label: "Submissions", count: d.submission_count ?? 0 },
          ]}
        />
      </View>

      <PaneScroll>
        <ErrorBanner message={save.error ?? setStatus.error ?? release.error ?? remove.error} />
        {pending ? (
          <Strip
            text={`${pending} marked submission${pending === 1 ? "" : "s"} waiting for you to release.`}
            action={<Button title="Release marks" small onPress={() => release.run()} busy={release.busy} />}
          />
        ) : null}
        {d.generator === "fallback" ? <Notice tone="warning" message="This draft was produced without the AI. Review the brief and rubric before publishing." /> : null}

        {tab === "brief" ? (
          <>
            <SectionLabel>What the student has to do</SectionLabel>
            <Input multiline value={d.description ?? ""} onChangeText={(t) => edit((a) => ({ ...a, description: t }))} style={{ minHeight: 110 }} />
            <SectionLabel>Instructions</SectionLabel>
            <Input multiline value={d.instructions ?? ""} onChangeText={(t) => edit((a) => ({ ...a, instructions: t }))} style={{ minHeight: 90 }} />
            <SectionLabel>Rubric</SectionLabel>
            <Rows>
              {d.rubric.map((r, i) => (
                <SettingRow key={i} label={`Criterion ${i + 1}`}>
                  <View style={{ flex: 1, minWidth: 160 }}>
                    <Input compact value={r.criterion} onChangeText={(t) => edit((a) => ({ ...a, rubric: a.rubric.map((x, j) => (j === i ? { ...x, criterion: t } : x)) }))} />
                  </View>
                  <Input compact value={String(r.points)} keyboardType="number-pad" containerStyle={{ width: 74 }}
                    onChangeText={(t) => edit((a) => ({ ...a, rubric: a.rubric.map((x, j) => (j === i ? { ...x, points: Number(t) || 0 } : x)) }))} />
                  <Button title="Remove" small variant="ghost" onPress={() => edit((a) => ({ ...a, rubric: a.rubric.filter((_, j) => j !== i) }))} />
                </SettingRow>
              ))}
              <SettingRow label="Total">
                <Text style={{ color: balanced ? colors.primary : colors.warning, fontWeight: "700" }}>{rubricTotal}</Text>
                <Hint>of {d.max_score} — they must match before this can be saved</Hint>
              </SettingRow>
            </Rows>
            <Row><Button title="Add Criterion" small variant="secondary" onPress={() => edit((a) => ({ ...a, rubric: [...a.rubric, { criterion: "", points: 0 }] }))} /></Row>
          </>
        ) : null}

        {tab === "sources" ? (
          <>
            <SectionLabel>Modules the brief was drafted from</SectionLabel>
            {sources ? (
              <ModulePicker value={d.source_module_ids ?? []} onChange={() => {}} subjectId={d.subject_id} disabled />
            ) : (
              <Hint>
                {d.chapter_id ? "This assignment was drafted from a whole chapter."
                  : d.module_id ? "This assignment was drafted from a single module."
                  : "This assignment is not tied to any book material."}
              </Hint>
            )}
            <Notice message="Changing what an assignment draws on does not rewrite its brief. Generate a new one from the modules you want instead." />
          </>
        ) : null}

        {tab === "settings" ? (
          <>
            <SectionLabel>Submitting</SectionLabel>
            <Rows>
              <SettingRow label="Maximum score">
                <Input compact value={String(d.max_score)} keyboardType="number-pad" containerStyle={{ width: 90 }}
                  onChangeText={(t) => edit((a) => ({ ...a, max_score: Number(t) || 0 }))} />
              </SettingRow>
              <SettingRow label="Available from">
                <Input compact value={d.available_from ?? ""} placeholder="2026-09-10T09:00:00Z" containerStyle={{ flex: 1, minWidth: 200 }}
                  onChangeText={(t) => edit((a) => ({ ...a, available_from: t || null }))} />
              </SettingRow>
              <SettingRow label="Due">
                <Input compact value={d.due_at ?? ""} placeholder="2026-09-30T23:59:00Z" containerStyle={{ flex: 1, minWidth: 200 }}
                  onChangeText={(t) => edit((a) => ({ ...a, due_at: t || null }))} />
              </SettingRow>
              <SettingRow label="Late submissions">
                <Chip label={d.allow_late ? "Allowed, flagged late" : "Refused after the due date"} selected={d.allow_late}
                  onPress={() => edit((a) => ({ ...a, allow_late: !a.allow_late }))} />
              </SettingRow>
              <SettingRow label="Resubmission">
                <Chip label={d.allow_resubmission ? "Allowed" : "Single submission"} selected={d.allow_resubmission}
                  onPress={() => edit((a) => ({ ...a, allow_resubmission: !a.allow_resubmission }))} />
              </SettingRow>
            </Rows>

            <SectionLabel>Results</SectionLabel>
            <Rows>
              <SettingRow label="Students see marks" top>
                <ResultsRelease
                  kind="assignment"
                  value={mode}
                  at={d.results_release_at ?? null}
                  onChange={(m, at) => edit((a) => ({ ...a, results_release: m, results_release_at: at }))}
                />
              </SettingRow>
            </Rows>
          </>
        ) : null}

        {tab === "submissions" ? <SubmissionsTab assignment={d} mode={mode} onRelease={(s) => release.run(s)} /> : null}
      </PaneScroll>

      <Foot>
        <Button title="Save Changes" icon="save-outline" small onPress={() => save.run()} busy={save.busy} disabled={!dirty || !balanced} />
        {d.status === "draft" ? <Button title="Publish" small variant="secondary" onPress={() => setStatus.run("published")} busy={setStatus.busy} disabled={dirty} /> : null}
        {d.status === "published" ? <Button title="Close" small variant="secondary" onPress={() => setStatus.run("closed")} busy={setStatus.busy} /> : null}
        <FootState
          dirty={dirty || !balanced}
          text={!balanced ? `Rubric adds up to ${rubricTotal}, not ${d.max_score}` : dirty ? "Unsaved changes" : d.status === "published" ? "Live for enrolled students" : d.status === "draft" ? "Not visible to students" : "Everything saved"}
        />
        <View style={{ flex: 1 }} />
        <Button title="Delete" icon="trash-outline" small variant="danger" onPress={() => remove.run()} busy={remove.busy} />
      </Foot>
    </>
  );
}

function SubmissionsTab({ assignment, mode, onRelease }: { assignment: Assignment; mode: ReleaseMode; onRelease: (id: string) => void }) {
  const q = useAsync(() => manage.submissions(assignment.id), [assignment.id]);
  const [scores, setScores] = useState<Record<string, { score: string; feedback: string }>>({});
  const evaluate = useAction(async (subId: string) => {
    const v = scores[subId];
    await manage.evaluate(subId, { score: Number(v?.score ?? 0), feedback: v?.feedback ?? "" });
    await q.reload();
  });
  return (
    <>
      <ErrorBanner message={q.error ?? evaluate.error} onRetry={q.reload} />
      {q.loading && !q.data ? <Loading /> : null}
      {q.data?.length === 0 ? <Hint>No submissions yet.</Hint> : null}
      {q.data?.map((s) => (
        <View key={s.id} style={as.card}>
          <Row style={{ justifyContent: "space-between" }}>
            <View style={{ flex: 1, minWidth: 160 }}>
              <P style={{ fontWeight: "600" }}>{s.student_email}</P>
              <P muted small>{fmtDate(s.submitted_at)}{s.is_late ? " · late" : ""} · attempt {s.attempt_number}</P>
            </View>
            <Badge value={s.status === "evaluated" ? `${s.score}/${assignment.max_score}` : s.status}
              color={s.status === "evaluated" ? colors.success : colors.warning} />
            {mode !== "immediate" && s.status === "evaluated" ? (
              <Button title="Release" small variant="secondary" onPress={() => onRelease(s.id)} />
            ) : null}
          </Row>
          <P>{s.content}</P>
          {s.status === "evaluated" && s.feedback ? <Notice tone="success" message={s.feedback} /> : null}
          <Row>
            <Input compact label={`Score (0–${assignment.max_score})`} keyboardType="decimal-pad" containerStyle={{ width: 110 }}
              value={scores[s.id]?.score ?? (s.score != null ? String(s.score) : "")}
              onChangeText={(t) => setScores((x) => ({ ...x, [s.id]: { score: t, feedback: x[s.id]?.feedback ?? s.feedback ?? "" } }))} />
            <View style={{ flex: 1, minWidth: 180 }}>
              <Input compact label="Feedback" value={scores[s.id]?.feedback ?? s.feedback ?? ""}
                onChangeText={(t) => setScores((x) => ({ ...x, [s.id]: { score: x[s.id]?.score ?? (s.score != null ? String(s.score) : ""), feedback: t } }))} />
            </View>
            <Button title="Save Mark" small onPress={() => evaluate.run(s.id)} busy={evaluate.busy} disabled={!scores[s.id]?.score} />
          </Row>
        </View>
      ))}
    </>
  );
}

/* ------------------------------------------------------------------ */
/* New assignment                                                      */
/* ------------------------------------------------------------------ */

function AssignmentBuilder({ onCancel, onCreated, onBack }: { onCancel: () => void; onCreated: (id: string) => void; onBack?: () => void }) {
  const [modules, setModules] = useState<string[]>([]);
  const [title, setTitle] = useState("");
  const [maxScore, setMaxScore] = useState("20");
  const [due, setDue] = useState("");
  const [late, setLate] = useState(true);
  const [resubmit, setResubmit] = useState(false);
  const [release, setRelease] = useState<ReleaseMode>("immediate");
  const [releaseAt, setReleaseAt] = useState<string | null>(null);

  const common = () => ({
    module_ids: modules,
    title: title || undefined,
    max_score: Number(maxScore) || 20,
    due_at: due || undefined,
    allow_late: late,
    allow_resubmission: resubmit,
    results_release: release,
    results_release_at: release === "scheduled" ? releaseAt : undefined,
  });
  const generate = useAction(async () => {
    const a = await manage.generateAssignment(common());
    onCreated(a.id);
  });
  const blank = useAction(async () => {
    const score = Number(maxScore) || 20;
    const a = await manage.createAssignment({
      ...common(),
      title: title || "Untitled assignment",
      rubric: [{ criterion: "Accuracy against the source", points: Math.ceil(score / 2) }, { criterion: "Clarity and structure", points: Math.floor(score / 2) }],
    });
    onCreated(a.id);
  });
  const ready = modules.length > 0 && (release !== "scheduled" || !!releaseAt);

  return (
    <>
      <View style={as.head}>
        <Row>
          {onBack ? <Button title="Assignments" icon="chevron-back" small variant="ghost" onPress={onBack} /> : null}
          <View style={{ flex: 1, minWidth: 200 }}>
            <Input value={title} onChangeText={setTitle} placeholder="New assignment — leave blank and the modules name it" />
          </View>
        </Row>
      </View>
      <PaneScroll>
        <ErrorBanner message={generate.error ?? blank.error} />
        <SectionLabel>Drafted from</SectionLabel>
        <ModulePicker value={modules} onChange={setModules} />
        <Hint>The brief and rubric are written only from the text of the modules you tick.</Hint>

        <SectionLabel>Marking</SectionLabel>
        <Rows>
          <SettingRow label="Maximum score"><Input compact value={maxScore} onChangeText={setMaxScore} keyboardType="number-pad" containerStyle={{ width: 90 }} /></SettingRow>
          <SettingRow label="Due"><Input compact value={due} onChangeText={setDue} placeholder="2026-09-30T23:59:00Z" containerStyle={{ flex: 1, minWidth: 200 }} /></SettingRow>
          <SettingRow label="Late submissions">
            <Chip label={late ? "Allowed, flagged late" : "Refused after the due date"} selected={late} onPress={() => setLate((v) => !v)} />
          </SettingRow>
          <SettingRow label="Resubmission">
            <Chip label={resubmit ? "Allowed" : "Single submission"} selected={resubmit} onPress={() => setResubmit((v) => !v)} />
          </SettingRow>
        </Rows>

        <SectionLabel>Results</SectionLabel>
        <Rows>
          <SettingRow label="Students see marks" top>
            <ResultsRelease kind="assignment" value={release} at={releaseAt} onChange={(m, at) => { setRelease(m); setReleaseAt(at); }} />
          </SettingRow>
        </Rows>

        <Notice message="The model drafts a rubric whose points add up to the maximum score. If it is unavailable you get a labelled fallback to edit." />
      </PaneScroll>
      <Foot>
        <Button title="Generate Draft" small onPress={() => generate.run()} busy={generate.busy} disabled={!ready} />
        <Button title="Write It Myself" small variant="secondary" onPress={() => blank.run()} busy={blank.busy} disabled={!ready} />
        <FootState text={modules.length ? `${modules.length} module${modules.length === 1 ? "" : "s"} selected` : "Select at least one module"} />
        <View style={{ flex: 1 }} />
        <Button title="Cancel" small variant="ghost" onPress={onCancel} />
      </Foot>
    </>
  );
}

const as = StyleSheet.create({
  head: { paddingHorizontal: space.lg, paddingTop: space.md, gap: space.sm },
  where: { fontSize: 12.5, color: colors.faint },
  card: { borderWidth: 1, borderColor: colors.border, borderRadius: 12, padding: space.md, gap: space.sm, backgroundColor: colors.surface },
});
