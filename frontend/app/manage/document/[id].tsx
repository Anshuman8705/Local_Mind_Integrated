import { Ionicons } from "@expo/vector-icons";
import { useLocalSearchParams, useRouter } from "expo-router";
import React, { useCallback, useEffect, useMemo, useState } from "react";
import { Platform, Pressable, ScrollView, StyleSheet, Text, View, useWindowDimensions } from "react-native";
import { manage } from "@/api/endpoints";
import type { Document, LessonDetail, LessonStatus, LessonSummary, OutlineChapter, OutlineModule, OutlineReport } from "@/api/types";
import { useAction, useAsync } from "@/hooks/useAsync";
import { useDebounced } from "@/hooks/useDebounced";
import { Badge, Button, Card, Chip, Empty, ErrorBanner, H1, H2, Input, Loading, Notice, P, Panel, ProgressBar, Row, Screen, colors, confirmAsync, confirmDeleteAsync, fmtSeconds, radius, radiusSm, space } from "@/ui";
import { LessonView } from "@/ui/LessonView";

/** Which node of the outline the right-hand pane is editing. */
type Selection = { ci: number; mi: number | null };

export default function DocumentScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const doc = useAsync(() => manage.document(id), [id]);
  const d = doc.data;
  // Poll while processing.
  useEffect(() => { if (d?.status !== "processing") return; const t = setInterval(doc.reload, 3000); return () => clearInterval(t); }, [d?.status, doc.reload]);
  // Lessons are generated in the background after processing and after edits.
  // While any are queued the counts and the tree's lesson marks refresh; this
  // reloads the book's details only, never the outline being edited.
  const lessonsBusy = (!!d?.lessons && d.lessons.pending + d.lessons.generating > 0)
    || (!!d?.auto_quizzes && d.auto_quizzes.pending + d.auto_quizzes.generating > 0);
  const { setData: setDoc } = doc;
  useEffect(() => {
    if (!lessonsBusy) return;
    const t = setInterval(async () => { try { setDoc(await manage.document(id)); } catch { /* shown on the next full reload */ } }, 10000);
    return () => clearInterval(t);
  }, [lessonsBusy, id, setDoc]);
  const lessonStatus = useMemo(() => {
    const map: Record<string, LessonStatus> = {};
    for (const c of d?.chapters ?? []) for (const m of c.modules) if (m.id && m.lesson_status) map[m.id] = m.lesson_status;
    return map;
  }, [d?.chapters]);
  const quizStatus = useMemo(() => {
    const map: Record<string, string> = {};
    for (const c of d?.chapters ?? []) for (const m of c.modules) if (m.id && m.quiz_status) map[m.id] = m.quiz_status;
    return map;
  }, [d?.chapters]);
  const queueLessons = useAction(async () => { await manage.generateLessons(id); setDoc(await manage.document(id)); });
  const queueQuizzes = useAction(async () => { await manage.generateAutoQuizzes(id); setDoc(await manage.document(id)); });
  // The outline editor holds its edits in local state until Save. Marking a
  // book ready or publishing it used to reload from the server, which threw
  // those edits away silently: modules deleted a moment earlier reappeared.
  // The editor reports whether it is dirty and hands up its save function, so
  // a transition can offer to save first.
  const [pending, setPending] = useState<{ dirty: boolean; save: () => Promise<void> } | null>(null);
  const act = useAction(async (action: "process" | "ready" | "publish" | "unpublish") => {
    if (pending?.dirty) {
      const ok = await confirmAsync(
        "Save your outline changes first?",
        "The outline has edits that have not been saved. Continuing without saving would discard them and reload the version on the server.",
        "Save and Continue",
        "Cancel",
      );
      if (!ok) return;
      await pending.save();
    }
    if (action === "process") await manage.process(id); else await manage.transition(id, action);
    await doc.reload();
  });
  // Deleting a book takes its chapters, modules and any quiz or assignment
  // built on them with it, so the warning names the book and says so.
  const remove = useAction(async () => {
    if (!d) return;
    const ok = await confirmDeleteAsync(
      "Delete this book?",
      "This permanently removes the book, its chapters and modules, and any quiz or assignment built from them, along with student attempts and submissions. It cannot be undone.",
      { detail: `${d.title} · ${d.original_name}`, okLabel: "Delete Book" },
    );
    if (!ok) return;
    await manage.deleteDocument(id);
    router.replace("/manage/books");
  });

  const actions = d ? (
    <Row>
      {(d.status === "uploaded" || d.status === "error") ? <Button title="Process" small onPress={() => act.run("process")} busy={act.busy} /> : null}
      {d.status === "under_review" ? <Button title="Mark Ready" small onPress={() => act.run("ready")} busy={act.busy} /> : null}
      {(d.status === "ready" || d.status === "under_review" || d.status === "unpublished") ? <Button title="Publish" small onPress={() => act.run("publish")} busy={act.busy} /> : null}
      {d.status === "published" ? <Button title="Unpublish" small variant="secondary" onPress={() => act.run("unpublish")} busy={act.busy} /> : null}
      {d.status !== "processing" ? <Button title="Delete" icon="trash-outline" small variant="danger" onPress={() => remove.run()} busy={remove.busy} /> : null}
    </Row>
  ) : null;

  const editable = !!d && d.status !== "uploaded" && d.status !== "processing" && d.status !== "error";
  // The detail endpoint returns the ids of the modules with no source text.
  // An empty array is truthy, so testing the field itself showed the warning
  // on every book, with the count rendering blank.
  const missingSource = d?.missing_source_modules?.length ?? 0;

  // Before an outline exists there is nothing to lay out beside anything, so
  // the upload / processing / failed states keep the plain scrolling page.
  if (!editable) {
    return (
      <Screen refreshing={doc.loading} onRefresh={doc.reload}>
        <Panel width={1100}>
          <ErrorBanner message={doc.error} onRetry={doc.reload} />
          {doc.loading && !d ? <Loading /> : null}
          {d ? (
            <>
              <H1>{d.title}</H1>
              <Row><Badge value={d.status} /><P muted small>{d.original_name} · v{d.content_version}</P></Row>
              {d.status === "processing" ? <ProcessingCard doc={d} /> : null}
              {d.status === "error" ? <Notice tone="warning" message={`Processing failed: ${d.error_message || "unknown error"}. You can retry.`} /> : null}
              <ErrorBanner message={act.error ?? remove.error} />
              {actions}
            </>
          ) : null}
        </Panel>
      </Screen>
    );
  }

  // The workspace fills the window: the outline tree scrolls on the left, the
  // module being edited holds the right, and neither pushes the other off the
  // page. Nothing below scrolls the whole screen.
  return (
    <Screen scroll={false} padded={false} wide>
      <View style={{ flex: 1, minHeight: 0 }}>
        <View style={ws.topBar}>
          <View style={{ flex: 1, minWidth: 200 }}>
            <Text style={ws.title} numberOfLines={1}>{d!.title}</Text>
            <Text style={ws.subtitle} numberOfLines={1}>
              {d!.original_name} · {d!.chapter_count ?? 0} chapters · {d!.module_count ?? 0} modules · v{d!.content_version}
            </Text>
          </View>
          <Badge value={d!.status} />
          {actions}
        </View>
        <ErrorBanner message={doc.error ?? act.error ?? remove.error} onRetry={doc.error ? doc.reload : undefined} />
        {missingSource ? <View style={ws.band}><Notice tone="warning" message={`${missingSource} module${missingSource === 1 ? " has" : "s have"} no source text but ${missingSource === 1 ? "is" : "are"} kept because a quiz, an assignment or student work refers to ${missingSource === 1 ? "it" : "them"}. Students do not see ${missingSource === 1 ? "it" : "them"}. Paste text to bring ${missingSource === 1 ? "it" : "them"} back.`} /></View> : null}
        {d!.lessons && d!.lessons.total > 0 ? <View style={ws.band}><LessonsBand summary={d!.lessons} onQueue={() => queueLessons.run()} busy={queueLessons.busy} error={queueLessons.error} /></View> : null}
        {d!.auto_quizzes?.enabled && d!.auto_quizzes.total > 0 ? (
          <View style={ws.band}>
            <Row style={{ gap: space.md }}>
              <Ionicons name="help-circle-outline" size={16} color={colors.primary} />
              <Text style={{ flex: 1, color: colors.text, fontSize: 13.5 }}>
                {(() => {
                  const a = d!.auto_quizzes!;
                  const parts = [
                    a.checking ? `${a.checking} being checked` : "", a.held ? `${a.held} held for your review` : "",
                    a.generating ? `${a.generating} being written` : "", a.pending ? `${a.pending} queued` : "", a.failed ? `${a.failed} failed` : "",
                  ].filter(Boolean);
                  const short = a.short ? ` ${a.short} short module${a.short === 1 ? " has" : "s have"} no quiz (under ${a.min_chars ?? 500} characters).` : "";
                  return a.ready === a.total
                    ? `An automatic quiz is ready for all ${a.total} modules. Each goes live when its module is open to students.${short}`
                    : `Automatic quizzes: ${a.ready} of ${a.total} ready${parts.length ? ` · ${parts.join(" · ")}` : ""}. Each is checked by the AI monitor and goes live when its module is open.${short}`;
                })()}
              </Text>
              {d!.auto_quizzes.failed && !d!.auto_quizzes.pending && !d!.auto_quizzes.generating ? (
                <Button title="Try Failed Again" icon="refresh-outline" small variant="secondary" onPress={() => queueQuizzes.run()} busy={queueQuizzes.busy} />
              ) : null}
            </Row>
          </View>
        ) : null}
        {d!.status === "published" ? <View style={ws.band}><Notice tone="warning" message="This book is live. Saved changes reach enrolled students immediately, and a module a student has already worked through cannot be removed." /></View> : null}
        <OutlineWorkspace documentId={id} published={d!.status === "published"} onSaved={doc.reload} onState={setPending} lessonStatus={lessonStatus} quizStatus={quizStatus} />
      </View>
    </Screen>
  );
}

/**
 * What the person sees while a book is being processed.
 *
 * The pipeline is a fixed sequence rather than a per-item loop (the parser
 * returns the whole book at once, and the outline is planned in a single
 * request), so this reports the step in flight and, once the outline exists,
 * the real number of chapters and modules about to be created.
 */
const STAGE_LABEL: Record<string, string> = {
  queued: "Waiting for the parser",
  reading: "Reading the file",
  outline: "Planning the outline",
  structure: "Creating chapters and modules",
};

function ProcessingCard({ doc }: { doc: Document }) {
  const p = doc.progress;
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => { const t = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(t); }, []);
  const started = doc.processing_started_at ? new Date(doc.processing_started_at).getTime() : null;
  const elapsed = started ? Math.max(0, Math.round((now - started) / 1000)) : null;
  return (
    <Card accent={colors.accent}>
      <Row style={{ justifyContent: "space-between" }}>
        <H2 icon="sync-outline">{p ? STAGE_LABEL[p.stage] ?? "Processing" : "Processing"}</H2>
        <P muted small>{p ? `Step ${p.step} of ${p.total_steps}` : "Starting"}</P>
      </Row>
      <ProgressBar value={p?.percent ?? 0} />
      {p?.detail ? <P small>{p.detail}</P> : null}
      <P muted small>
        Reading a scanned book takes the longest; the page updates on its own.
        {elapsed !== null ? ` Running for ${fmtSeconds(elapsed)}.` : ""}
      </P>
    </Card>
  );
}

/* ------------------------------------------------------------------ */
/* The workspace: outline tree on the left, one node open on the right  */
/* ------------------------------------------------------------------ */

/**
 * A book is edited one module at a time.
 *
 * The outline used to render every chapter and every module as a stack of
 * cards on one scrolling page, each module hiding its source text behind a
 * More button and, when opened, showing that text in a six-line box. Reading
 * a passage meant scrolling a window inside a window, and finding a module
 * meant scrolling past every other one. The tree now keeps the whole book
 * navigable on the left while the selected module gets the full height of the
 * right pane for its text.
 *
 * The save contract is unchanged: every edit lives in local state and one
 * PUT replaces the outline, so a rename here and a text edit three chapters
 * away are still one save.
 */
function OutlineWorkspace({ documentId, published, onSaved, onState, lessonStatus, quizStatus }: { documentId: string; published: boolean; onSaved: () => void; onState: (s: { dirty: boolean; save: () => Promise<void> }) => void; lessonStatus: Record<string, LessonStatus>; quizStatus: Record<string, string> }) {
  const q = useAsync(() => manage.outline(documentId), [documentId]);
  const [report, setReport] = useState<OutlineReport | null>(null);
  const [chapters, setChapters] = useState<OutlineChapter[] | null>(null);
  const [dirty, setDirty] = useState(false);
  const [sel, setSel] = useState<Selection | null>(null);
  const { width } = useWindowDimensions();
  const split = width >= 900;

  useEffect(() => {
    if (!q.data) return;
    setChapters(q.data.chapters.map((c) => ({ ...c, modules: c.modules.map((m) => ({ ...m })) })));
    setDirty(false);
    // On a wide window the right pane would otherwise sit empty, so the first
    // module opens by itself. On a phone the two panes take turns, and landing
    // inside a module would hide the book the person came to look at.
    setSel((cur) => cur ?? (split && q.data!.chapters.length ? { ci: 0, mi: q.data!.chapters[0].modules.length ? 0 : null } : null));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q.data]);

  /** What this save would do, in the words the confirmation needs. */
  const changes = useMemo(() => {
    const before = q.data?.chapters ?? [];
    if (!chapters) return [];
    const beforeModules = new Map(before.flatMap((c) => c.modules).map((m) => [m.id, m]));
    const afterModules = chapters.flatMap((c) => c.modules);
    const afterIds = new Set(afterModules.map((m) => m.id).filter(Boolean));
    const removedModules = [...beforeModules.values()].filter((m) => !afterIds.has(m.id));
    const removedChapters = before.filter((c) => !chapters.some((x) => x.id === c.id));
    const added = afterModules.filter((m) => !m.id).length;
    const renamed = afterModules.filter((m) => m.id && beforeModules.get(m.id)?.title !== m.title).length;
    const retexted = afterModules.filter((m) => m.id && m.source_text !== undefined && beforeModules.get(m.id)?.source_text !== m.source_text).length;
    // A module without text is removed by the server on save, so the
    // confirmation says so before it happens rather than after.
    const emptied = afterModules.filter((m) => !(m.source_text ?? "").trim()).length;
    const lines: string[] = [];
    if (emptied) lines.push(`${emptied} module${emptied === 1 ? "" : "s"} with no source text will be removed`);
    if (removedChapters.length) lines.push(`${removedChapters.length} chapter${removedChapters.length === 1 ? "" : "s"} removed`);
    if (removedModules.length) lines.push(`${removedModules.length} module${removedModules.length === 1 ? "" : "s"} removed`);
    if (added) lines.push(`${added} module${added === 1 ? "" : "s"} added`);
    if (renamed) lines.push(`${renamed} title${renamed === 1 ? "" : "s"} changed`);
    if (retexted) lines.push(`${retexted} module${retexted === 1 ? "" : "s"} with edited text`);
    return lines;
  }, [chapters, q.data]);

  const persist = useCallback(async () => {
    if (!chapters) return;
    // The GET hands back every module's source_text, so sending it back
    // unchanged would mark each one as reviewer-supplied: the backend treats
    // explicit text as an override and drops the heading mapping when the
    // index does not resolve. Only text that actually changed is sent, so a
    // save leaves untouched modules pointing at their section.
    const loaded = new Map((q.data?.chapters ?? []).flatMap((c) => c.modules).map((m) => [m.id, m.source_text]));
    const payload = chapters.map((c, ci) => ({ id: c.id, title: c.title, order: ci + 1, source_heading_index: c.source_heading_index ?? null,
      modules: c.modules.map((m, mi) => {
        const edited = m.source_text !== undefined && (!m.id || m.source_text !== loaded.get(m.id));
        return { id: m.id, title: m.title, order: mi + 1, source_heading_index: m.source_heading_index ?? null, ...(edited ? { source_text: m.source_text } : {}) };
      }) }));
    const saved = await manage.saveOutline(documentId, payload as OutlineChapter[]);
    const r = saved.outline_report;
    setReport(r && (r.removed_empty_modules.length || r.removed_empty_chapters.length || r.hidden_empty_modules.length) ? r : null);
    await q.reload(); onSaved();
  }, [chapters, documentId, q, onSaved]);

  const save = useAction(async () => {
    // Saving is the point of no return for a removal, so it states what is
    // about to change, and says plainly when a live book is involved.
    const ok = await confirmAsync(
      "Save these outline changes?",
      published
        ? "This book is published, so the changes reach enrolled students as soon as they are saved."
        : "The outline on the server will be replaced with what is on screen.",
      "Save Outline",
      "Keep Editing",
      { tone: changes.some((l) => l.includes("removed")) ? "danger" : "primary", detail: changes.join(" · ") || undefined },
    );
    if (!ok) return;
    await persist();
  });

  const update = (fn: (c: OutlineChapter[]) => OutlineChapter[]) => { setChapters((c) => (c ? fn(c) : c)); setDirty(true); };
  const patchModule = (ci: number, mi: number, nm: OutlineModule) =>
    update((c) => c.map((x, i) => (i === ci ? { ...x, modules: x.modules.map((y, j) => (j === mi ? nm : y)) } : x)));

  // Opening or locking a module is a server call of its own, not part of the
  // outline PUT. It used to reload the outline afterwards, which discarded
  // every unsaved edit on the page, so the new availability is merged into
  // local state instead.
  const avail = useAction(async (ci: number, mi: number) => {
    const m = chapters?.[ci]?.modules[mi];
    if (!m?.id) return;
    const next = m.availability === "open" ? "locked" : "open";
    await manage.moduleAvailability(m.id, next);
    setChapters((c) => (c ? c.map((x, i) => (i === ci ? { ...x, modules: x.modules.map((y, j) => (j === mi ? { ...y, availability: next } : y)) } : x)) : c));
  });

  // Removing is the destructive edit here, so both levels ask first and the
  // chapter warning names how many modules go with it.
  const removeChapter = async (ci: number) => {
    const ch = chapters?.[ci];
    if (!ch) return;
    const n = ch.modules.length;
    const ok = await confirmDeleteAsync(
      "Remove this chapter?",
      n
        ? `Its ${n} module${n === 1 ? "" : "s"} go with it. Nothing is removed from the book until you save the outline.`
        : "Nothing is removed from the book until you save the outline.",
      { detail: ch.title, okLabel: "Remove Chapter" },
    );
    if (!ok) return;
    update((c) => c.filter((_, i) => i !== ci));
    setSel(null);
  };
  const removeModule = async (ci: number, mi: number) => {
    const m = chapters?.[ci]?.modules[mi];
    if (!m) return;
    const ok = await confirmDeleteAsync(
      "Remove this module?",
      "Nothing is removed from the book until you save the outline. A module a student has already worked through cannot be removed.",
      { detail: m.title, okLabel: "Remove Module" },
    );
    if (!ok) return;
    update((c) => c.map((x, i) => (i === ci ? { ...x, modules: x.modules.filter((_, j) => j !== mi) } : x)));
    setSel({ ci, mi: null });
  };

  const moveChapter = (ci: number, dir: -1 | 1) => {
    const target = ci + dir;
    if (!chapters || target < 0 || target >= chapters.length) return;
    update((c) => { const n = [...c]; [n[ci], n[target]] = [n[target], n[ci]]; return n; });
    setSel({ ci: target, mi: null });
  };
  const moveModule = (ci: number, mi: number, dir: -1 | 1) => {
    const list = chapters?.[ci]?.modules;
    const target = mi + dir;
    if (!list || target < 0 || target >= list.length) return;
    update((c) => c.map((x, i) => { if (i !== ci) return x; const n = [...x.modules]; [n[mi], n[target]] = [n[target], n[mi]]; return { ...x, modules: n }; }));
    setSel({ ci, mi: target });
  };
  const addChapter = () => {
    if (!chapters) return;
    update((c) => [...c, { title: `Chapter ${c.length + 1}`, order: c.length + 1, modules: [] }]);
    setSel({ ci: chapters.length, mi: null });
  };
  const addModule = (ci: number) => {
    const at = chapters?.[ci]?.modules.length ?? 0;
    update((c) => c.map((x, i) => (i === ci ? { ...x, modules: [...x.modules, { title: "New module", order: x.modules.length + 1, source_heading_index: null, source_text: "" }] } : x)));
    setSel({ ci, mi: at });
  };

  useEffect(() => { onState({ dirty, save: persist }); }, [dirty, persist, onState]);

  if (q.loading && !chapters) return <Loading />;
  if (!chapters) return <ErrorBanner message={q.error} onRetry={q.reload} />;

  const chapter = sel ? chapters[sel.ci] : undefined;
  const mod = chapter && sel?.mi !== null && sel?.mi !== undefined ? chapter.modules[sel.mi] : undefined;
  // On a phone the two panes take turns: the tree is the page until something
  // is picked, and the pane has a way back to it.
  const showPane = split || (!!sel && !!chapter);

  const tree = (
    <OutlineTree
      chapters={chapters}
      selection={sel}
      outlineSource={q.data?.outline_source}
      onSelect={setSel}
      onCollapse={() => setSel(null)}
      onAddChapter={addChapter}
      lessonStatus={lessonStatus}
      style={split ? ws.treeSplit : ws.treeFull}
    />
  );

  const pane = (
    <View style={ws.pane}>
      <ErrorBanner message={save.error ?? avail.error} />
      {report ? <SaveReport report={report} onDismiss={() => setReport(null)} /> : null}
      {mod && chapter && sel ? (
        <ModulePane
          key={`${sel.ci}-${sel.mi}`}
          chapterTitle={chapter.title}
          module={mod}
          index={sel.mi!}
          count={chapter.modules.length}
          onChange={(nm) => patchModule(sel.ci, sel.mi!, nm)}
          onMove={(dir) => moveModule(sel.ci, sel.mi!, dir)}
          onRemove={() => removeModule(sel.ci, sel.mi!)}
          onToggle={() => avail.run(sel.ci, sel.mi!)}
          toggleBusy={avail.busy}
          onBack={split ? undefined : () => setSel(null)}
          lessonStatus={mod.id ? lessonStatus[mod.id] ?? mod.lesson_status : undefined}
          quizStatus={mod.id ? quizStatus[mod.id] ?? mod.quiz_status : undefined}
          textEdited={!!mod.id && (mod.source_text ?? "") !== ((q.data?.chapters ?? []).flatMap((c) => c.modules).find((x) => x.id === mod.id)?.source_text ?? "")}
        />
      ) : chapter && sel ? (
        <ChapterPane
          key={`ch-${sel.ci}`}
          chapter={chapter}
          index={sel.ci}
          count={chapters.length}
          onChange={(title) => update((c) => c.map((x, i) => (i === sel.ci ? { ...x, title } : x)))}
          onMove={(dir) => moveChapter(sel.ci, dir)}
          onRemove={() => removeChapter(sel.ci)}
          onAddModule={() => addModule(sel.ci)}
          onOpenModule={(mi) => setSel({ ci: sel.ci, mi })}
          onBack={split ? undefined : () => setSel(null)}
        />
      ) : (
        <Empty text="Pick a chapter on the left, then a module. Its heading and source text open here." icon="book-outline" />
      )}
      <View style={ws.footer}>
        <Button title="Save Outline" icon="save-outline" small onPress={() => save.run()} busy={save.busy} disabled={!dirty} />
        <Text style={[ws.saveState, dirty && { color: colors.warning }]}>
          {dirty ? "Unsaved changes" : "Everything saved"}
        </Text>
      </View>
    </View>
  );

  if (split) return <View style={ws.body}>{tree}{pane}</View>;
  return <View style={ws.body}>{showPane ? pane : tree}</View>;
}

/** How the outline came to be, in words rather than the stored token. */
const OUTLINE_SOURCE: Record<string, string> = {
  ai: "outline planned by the tutor model",
  source_hierarchy: "outline taken from the book's own headings",
  edited: "outline edited by hand",
};

/** The chapter and module tree. Chapters expand in place; modules select. */
function OutlineTree({ chapters, selection, outlineSource, onSelect, onCollapse, onAddChapter, lessonStatus, style }: {
  chapters: OutlineChapter[];
  selection: Selection | null;
  outlineSource?: string;
  onSelect: (s: Selection) => void;
  onCollapse: () => void;
  onAddChapter: () => void;
  lessonStatus: Record<string, LessonStatus>;
  style?: object;
}) {
  const [filter, setFilter] = useState("");
  const needle = useDebounced(filter, 150).trim().toLowerCase();
  const totalModules = chapters.reduce((n, c) => n + c.modules.length, 0);
  // A search opens whatever it matched; otherwise one chapter is open at a
  // time, which is what keeps a 40-chapter book navigable in one column.
  const rows = useMemo(() => {
    if (!needle) return chapters.map((c, i) => ({ chapter: c, index: i, modules: c.modules }));
    return chapters
      .map((c, i) => ({ chapter: c, index: i, modules: c.modules.filter((m) => m.title.toLowerCase().includes(needle)) }))
      .filter((row) => row.modules.length > 0 || row.chapter.title.toLowerCase().includes(needle));
  }, [chapters, needle]);
  return (
    <View style={[ws.tree, style]}>
      <View style={ws.treeHead}>
        <Row style={{ justifyContent: "space-between" }}>
          <Text style={ws.treeTitle}>Outline</Text>
          <Button title="Add Chapter" small variant="ghost" onPress={onAddChapter} />
        </Row>
        <Text style={ws.treeMeta}>
          {chapters.length} chapter{chapters.length === 1 ? "" : "s"} · {totalModules} module{totalModules === 1 ? "" : "s"}
          {outlineSource ? ` · ${OUTLINE_SOURCE[outlineSource] ?? `outline from ${outlineSource}`}` : ""}. Every module carries source text; one saved without text is removed.
        </Text>
        <Input compact value={filter} onChangeText={setFilter} placeholder="Find a chapter or module" />
      </View>
      <ScrollView
        style={[{ flex: 1, minHeight: 0 }, Platform.OS === "web" && ({ overflowY: "auto" } as object)]}
        contentContainerStyle={{ padding: space.sm, paddingBottom: space.xl }}
        keyboardShouldPersistTaps="handled"
      >
        {needle && rows.length === 0 ? <Empty text="Nothing in this outline matches that." icon="search-outline" /> : null}
        {rows.map(({ chapter: ch, index: ci, modules }) => {
          const expanded = !!needle || selection?.ci === ci;
          const openCount = ch.modules.filter((m) => m.availability === "open").length;
          return (
            <View key={ch.id ?? `new-${ci}`}>
              <Pressable
                // Pressing a chapter opens it and shows it on the right;
                // pressing the open one again closes it.
                onPress={() => (selection?.ci === ci && selection.mi === null && !needle ? onCollapse() : onSelect({ ci, mi: null }))}
                accessibilityRole="button"
                style={({ pressed }) => [ws.chapterRow, expanded && ws.chapterRowOpen, pressed && { opacity: 0.85 }]}
              >
                <Ionicons name={expanded ? "chevron-down" : "chevron-forward"} size={14} color={expanded ? colors.primary : colors.faint} />
                <Text style={ws.chapterTitle} numberOfLines={1}>{ch.title}</Text>
                <Text style={ws.chapterCount}>{ch.modules.length}{openCount ? ` · ${openCount} open` : ""}</Text>
              </Pressable>
              {expanded ? (
                <View style={ws.moduleList}>
                  {modules.map((m) => {
                    const mi = ch.modules.indexOf(m);
                    const on = selection?.ci === ci && selection?.mi === mi;
                    return (
                      <Pressable
                        key={m.id ?? `new-${ci}-${mi}`}
                        onPress={() => onSelect({ ci, mi })}
                        accessibilityRole="button"
                        style={({ pressed }) => [ws.moduleRow, on && ws.moduleRowOn, pressed && { opacity: 0.85 }]}
                      >
                        <Text style={[ws.moduleNum, on && { color: colors.primary }]}>{mi + 1}</Text>
                        <Text style={[ws.moduleTitle, on && { color: colors.text, fontWeight: "600" }]} numberOfLines={1}>{m.title}</Text>
                        {m.source_missing ? <Ionicons name="alert-circle" size={13} color={colors.danger} /> : null}
                        <LessonMark status={m.id ? lessonStatus[m.id] ?? m.lesson_status : undefined} />
                        <View style={[ws.dot, { backgroundColor: m.availability === "open" ? colors.primary : colors.faint }]} />
                      </Pressable>
                    );
                  })}
                  {ch.modules.length === 0 ? <Text style={ws.emptyModules}>No modules yet.</Text> : null}
                </View>
              ) : null}
            </View>
          );
        })}
      </ScrollView>
    </View>
  );
}

/** One module, with room to actually read its source text. */
function ModulePane({ chapterTitle, module: m, index, count, onChange, onMove, onRemove, onToggle, toggleBusy, onBack, lessonStatus, quizStatus, textEdited }: {
  lessonStatus?: LessonStatus;
  quizStatus?: string;
  textEdited?: boolean;
  chapterTitle: string;
  module: OutlineModule;
  index: number;
  count: number;
  onChange: (m: OutlineModule) => void;
  onMove: (d: -1 | 1) => void;
  onRemove: () => void;
  onToggle: () => void;
  toggleBusy?: boolean;
  onBack?: () => void;
}) {
  const chars = (m.source_text ?? "").length;
  const empty = !(m.source_text ?? "").trim();
  const [view, setView] = useState<"text" | "lesson">("text");
  return (
    <View style={{ flex: 1, minHeight: 0, gap: space.md }}>
      <Row>
        {onBack ? <Button title="Outline" icon="chevron-back" small variant="ghost" onPress={onBack} /> : null}
        <Text style={ws.crumb} numberOfLines={1}>{chapterTitle}</Text>
        <Ionicons name="chevron-forward" size={12} color={colors.faint} />
        <Text style={ws.crumbNow} numberOfLines={1}>Module {index + 1} of {count}</Text>
      </Row>
      <Row>
        <View style={{ flex: 1, minWidth: 200 }}><Input value={m.title} onChangeText={(t) => onChange({ ...m, title: t })} /></View>
        {m.id ? <Badge value={m.availability ?? "locked"} /> : <Badge value="new" color={colors.accent} />}
        {m.source_missing ? <Badge value="no source" color={colors.danger} /> : null}
        {lessonStatus && lessonStatus !== "none" ? <Badge value={LESSON_BADGE[lessonStatus]} color={LESSON_COLOR[lessonStatus]} /> : null}
        {quizStatus && !["none", "off"].includes(quizStatus) ? (
          <Badge value={QUIZ_BADGE[quizStatus] ?? `quiz ${quizStatus}`}
            color={quizStatus === "ready" ? colors.success : quizStatus === "failed" || quizStatus === "held" ? colors.warning : colors.faint} />
        ) : null}
      </Row>
      {m.id && quizStatus && quizStatus !== "off" ? <AutoQuizControls moduleId={m.id} status={quizStatus} quizId={m.auto_quiz_id ?? null} /> : null}
      <Row>
        <Text style={ws.fieldLabel}>Position</Text>
        <Button title="Move up" small variant="secondary" onPress={() => onMove(-1)} disabled={index === 0} />
        <Button title="Move down" small variant="secondary" onPress={() => onMove(1)} disabled={index >= count - 1} />
      </Row>
      <Row>
        <Chip label="Source text" selected={view === "text"} onPress={() => setView("text")} />
        <Chip label="Lesson" selected={view === "lesson"} onPress={() => setView("lesson")} />
        <View style={{ flex: 1 }} />
        {view === "text" ? <Text style={ws.charCount}>{chars.toLocaleString()} characters</Text> : null}
      </Row>
      {view === "lesson" ? (
        m.id ? <ModuleLessonPanel moduleId={m.id} textEdited={!!textEdited} /> : <Empty text="The lesson is generated in the background once this module is saved." icon="school-outline" />
      ) : null}
      {view === "text" ? <Input
        multiline
        value={m.source_text ?? ""}
        // The backend resolves a mapped heading and refills the text from that
        // section, so text typed against a mapped module was thrown away on
        // save. Editing detaches the module from its heading, which is what the
        // label above has always promised; re-picking the heading brings the
        // section's own text back.
        onChangeText={(t) => onChange({ ...m, source_text: t, source_heading_index: null })}
        placeholder="Paste the passage students should learn from. A module saved without text is removed."
        containerStyle={{ flex: 1, minHeight: 0 }}
        style={{ flex: 1, minHeight: 160, lineHeight: 24 }}
      /> : null}
      {view === "text" && empty ? <Notice tone="warning" message="This module has no text. Saving the outline removes it." /> : null}
      {view === "text" && !empty && m.source_heading_index !== null && m.source_heading_index !== undefined ? (
        <Text style={ws.hint}>This text came from the book&apos;s own heading for this module. Editing it keeps what you type instead.</Text>
      ) : null}
      {view === "text" && textEdited ? <Text style={ws.hint}>Saving the outline generates a new lesson for the edited text.</Text> : null}
      <Row>
        {m.id ? <Button title={m.availability === "open" ? "Lock for students" : "Open for students"} small variant="secondary" onPress={onToggle} disabled={!!m.source_missing} busy={toggleBusy} /> : null}
        <Button title="Remove Module" small variant="ghost" onPress={onRemove} />
      </Row>
    </View>
  );
}

const LESSON_BADGE: Record<LessonStatus, string> = { ready: "lesson ready", pending: "lesson queued", generating: "lesson generating", failed: "lesson failed", none: "no lesson" };
const LESSON_COLOR: Record<LessonStatus, string> = { ready: colors.success, pending: colors.faint, generating: colors.accent, failed: colors.warning, none: colors.faint };

/** A small mark in the tree: nothing when the lesson is ready. */
function LessonMark({ status }: { status?: LessonStatus }) {
  if (!status || status === "ready" || status === "none") return null;
  const icon = status === "failed" ? "alert-circle-outline" : status === "generating" ? "sync-outline" : "time-outline";
  return <Ionicons name={icon} size={13} color={LESSON_COLOR[status]} accessibilityLabel={LESSON_BADGE[status]} />;
}

/** Lesson generation for the whole book, above the outline. */
function LessonsBand({ summary: l, onQueue, busy, error }: { summary: LessonSummary; onQueue: () => void; busy?: boolean; error?: string | null }) {
  const waiting = l.pending + l.generating;
  const percent = l.total ? (100 * l.ready) / l.total : 0;
  let message: string;
  if (l.ready === l.total) message = `All ${l.total} lesson${l.total === 1 ? " is" : "s are"} ready for students.`;
  else if (waiting) message = `Lessons: ${l.ready} of ${l.total} ready${l.generating ? ` · ${l.generating} being written` : ""}${l.pending ? ` · ${l.pending} queued` : ""}${l.failed ? ` · ${l.failed} failed` : ""}. They are generated in the background; you can keep working.`;
  else if (l.failed) message = `Lessons: ${l.ready} of ${l.total} ready · ${l.failed} could not be generated. Students see a plain version of those modules until they are.`;
  else message = `Lessons: ${l.ready} of ${l.total} ready.${l.auto_generate ? "" : " Automatic generation is off on this server."}`;
  const needsQueue = l.ready < l.total && !waiting;
  return (
    <View style={{ gap: 6 }}>
      <Row style={{ gap: space.md }}>
        <Ionicons name="school-outline" size={16} color={l.failed && !waiting ? colors.warning : colors.primary} />
        <Text style={{ flex: 1, color: colors.text, fontSize: 13.5 }}>{message}</Text>
        {needsQueue ? <Button title={l.failed ? "Try Failed Again" : "Generate Lessons"} icon="refresh-outline" small variant="secondary" onPress={onQueue} busy={busy} /> : null}
      </Row>
      {l.ready < l.total ? <ProgressBar value={percent} height={6} /> : null}
      <ErrorBanner message={error ?? null} />
    </View>
  );
}

/** What the last save removed, so modules never vanish without a word. */
function SaveReport({ report, onDismiss }: { report: OutlineReport; onDismiss: () => void }) {
  const removed = report.removed_empty_modules.map((m) => m.title);
  const chapters = report.removed_empty_chapters.map((c) => c.title);
  const hidden = report.hidden_empty_modules.map((m) => m.title);
  const parts: string[] = [];
  if (removed.length) parts.push(`Removed ${removed.length} module${removed.length === 1 ? "" : "s"} with no source text: ${removed.join(", ")}.`);
  if (chapters.length) parts.push(`Removed ${chapters.length === 1 ? "a chapter" : `${chapters.length} chapters`} left with no modules: ${chapters.join(", ")}.`);
  if (hidden.length) parts.push(`Kept but hidden from students, because student work refers to them: ${hidden.join(", ")}.`);
  return (
    <Row style={{ alignItems: "flex-start" }}>
      <View style={{ flex: 1 }}><Notice tone="warning" message={parts.join(" ")} /></View>
      <Button title="Dismiss" small variant="ghost" onPress={onDismiss} />
    </Row>
  );
}

/** The module's lesson, as students will see it, with its generation state. */
function ModuleLessonPanel({ moduleId, textEdited }: { moduleId: string; textEdited: boolean }) {
  const q = useAsync(() => manage.moduleLesson(moduleId), [moduleId]);
  const d: LessonDetail | null = q.data;
  const { setData } = q;
  useEffect(() => {
    if (d?.status !== "pending" && d?.status !== "generating") return;
    const t = setTimeout(async () => { try { setData(await manage.moduleLesson(moduleId)); } catch { /* retried on next open */ } }, 6000);
    return () => clearTimeout(t);
  }, [d, moduleId, setData]);
  const again = useAction(async () => { setData(await manage.regenerateLesson(moduleId)); });
  const when = d?.generated_at ? new Date(d.generated_at).toLocaleString() : "";
  let line = "";
  if (d?.status === "ready") line = `Generated ${when}${d.model ? ` by ${d.model}` : ""}. This is what students see.`;
  else if (d?.status === "generating") line = "The tutor is writing this lesson now.";
  else if (d?.status === "pending") line = d.queue_position ? `Queued: ${d.queue_position === 1 ? "next in line" : `number ${d.queue_position} in line`}.` : "Queued.";
  else if (d?.status === "failed") line = `Could not be generated (${d.last_error || "unknown error"}).${d.next_attempt_at ? ` Trying again at ${new Date(d.next_attempt_at).toLocaleTimeString()}.` : " It will not be retried until you ask."} Students see a plain version made from the text meanwhile.`;
  else if (d?.status === "none") line = "This module has no text, so there is no lesson.";
  return (
    <ScrollView style={[{ flex: 1, minHeight: 0 }, Platform.OS === "web" && ({ overflowY: "auto" } as object)]} contentContainerStyle={{ gap: space.md, paddingBottom: space.lg }}>
      <ErrorBanner message={q.error ?? again.error} onRetry={q.error ? q.reload : undefined} />
      {q.loading && !d ? <Loading /> : null}
      {textEdited ? <Notice message="You have edited this module's text. Save the outline and a new lesson is generated for it; the one below is for the saved text." /> : null}
      {d ? (
        <Row style={{ gap: space.md }}>
          <Text style={[ws.hint, { flex: 1 }]}>{line}</Text>
          {d.status !== "none" && d.status !== "pending" && d.status !== "generating" ? (
            <Button title={d.status === "failed" ? "Try Again" : "Generate Again"} icon="refresh-outline" small variant="secondary" onPress={() => again.run()} busy={again.busy} />
          ) : null}
        </Row>
      ) : null}
      {d?.lesson ? <LessonView lesson={d.lesson} /> : null}
    </ScrollView>
  );
}

const QUIZ_BADGE: Record<string, string> = {
  ready: "quiz ready", pending: "quiz queued", generating: "quiz being written", checking: "quiz being checked",
  held: "quiz held for review", failed: "quiz failed", dismissed: "quiz deleted", short: "no quiz: short module",
};

/** The module's automatic quiz: open it, or have it written again. */
function AutoQuizControls({ moduleId, status, quizId }: { moduleId: string; status: string; quizId: string | null }) {
  const router = useRouter();
  const [local, setLocal] = useState<string | null>(null);
  const shown = local ?? status;
  const again = useAction(async () => { const r = await manage.regenerateAutoQuiz(moduleId); setLocal(r.quiz_status); });
  const busy = shown === "pending" || shown === "generating" || shown === "checking";
  if (shown === "short") return <Text style={ws.hint}>This module is too short for an automatic quiz. Add one by hand in Quizzes if it needs one.</Text>;
  const label = shown === "dismissed" ? "Write the Quiz Again" : shown === "none" ? "Write a Quiz" : shown === "failed" ? "Try Again" : "Write It Again";
  return (
    <View style={{ gap: 4 }}>
      <Row>
        {quizId && (shown === "ready" || shown === "held") ? <Button title={shown === "held" ? "Review Quiz" : "Open Quiz"} icon="open-outline" small variant="secondary" onPress={() => router.push(`/manage/quiz/${quizId}`)} /> : null}
        {!busy ? <Button title={label} icon="refresh-outline" small variant="ghost" onPress={() => again.run()} busy={again.busy} /> : null}
        <Text style={[ws.hint, { flex: 1 }]}>
          {shown === "checking" ? "Written; the AI monitor is checking it before students can see it." :
            busy ? "The automatic quiz for this module is queued; quizzes are written in turn with lessons." :
            shown === "held" ? "The AI monitor flagged this quiz, so students do not see it. Review the questions, then publish it, or mark the incident a false positive." :
            shown === "ready" ? "Goes live for students when this module is open. Once students have attempted it, writing it again keeps it as it is; edit it in Quizzes instead." :
            shown === "dismissed" ? "You deleted this module's automatic quiz, so it is not written again unless you ask." :
            shown === "failed" ? "The automatic quiz could not be written; it is retried later, or try now." : ""}
        </Text>
      </Row>
      <ErrorBanner message={again.error} />
    </View>
  );
}

/** A chapter: rename it, move it, add a module, or jump into one. */
function ChapterPane({ chapter, index, count, onChange, onMove, onRemove, onAddModule, onOpenModule, onBack }: {
  chapter: OutlineChapter;
  index: number;
  count: number;
  onChange: (title: string) => void;
  onMove: (d: -1 | 1) => void;
  onRemove: () => void;
  onAddModule: () => void;
  onOpenModule: (mi: number) => void;
  onBack?: () => void;
}) {
  return (
    <ScrollView
      style={[{ flex: 1, minHeight: 0 }, Platform.OS === "web" && ({ overflowY: "auto" } as object)]}
      contentContainerStyle={{ gap: space.md, paddingBottom: space.lg }}
      keyboardShouldPersistTaps="handled"
    >
      <Row>
        {onBack ? <Button title="Outline" icon="chevron-back" small variant="ghost" onPress={onBack} /> : null}
        <Text style={ws.crumbNow}>Chapter {index + 1} of {count}</Text>
      </Row>
      <Input label="Chapter title" value={chapter.title} onChangeText={onChange} />
      <Row>
        <Button title="↑" small variant="secondary" onPress={() => onMove(-1)} disabled={index === 0} />
        <Button title="↓" small variant="secondary" onPress={() => onMove(1)} disabled={index >= count - 1} />
        <Button title="Add Module" icon="add-outline" small variant="secondary" onPress={onAddModule} />
        <Button title="Remove Chapter" small variant="ghost" onPress={onRemove} />
      </Row>
      <Text style={ws.fieldLabel}>{chapter.modules.length} module{chapter.modules.length === 1 ? "" : "s"} in this chapter</Text>
      {chapter.modules.map((m, mi) => (
        <Pressable key={m.id ?? `new-${mi}`} onPress={() => onOpenModule(mi)} style={({ pressed }) => [ws.chapterListRow, pressed && { opacity: 0.85 }]}>
          <Text style={ws.moduleNum}>{mi + 1}</Text>
          <Text style={[ws.moduleTitle, { color: colors.text }]} numberOfLines={1}>{m.title}</Text>
          {m.source_missing ? <Badge value="no source" color={colors.danger} /> : null}
          <Ionicons name="chevron-forward" size={16} color={colors.faint} />
        </Pressable>
      ))}
      {chapter.modules.length === 0 ? <Empty text="This chapter has no modules yet." icon="layers-outline" /> : null}
    </ScrollView>
  );
}

const ws = StyleSheet.create({
  topBar: { flexDirection: "row", alignItems: "center", gap: space.md, flexWrap: "wrap", paddingHorizontal: space.lg, paddingTop: space.md, paddingBottom: space.sm },
  title: { fontSize: 20, fontWeight: "800", color: colors.text, letterSpacing: -0.2 },
  subtitle: { fontSize: 12.5, color: colors.muted, marginTop: 2 },
  band: { paddingHorizontal: space.lg, paddingBottom: space.sm },
  body: { flex: 1, minHeight: 0, flexDirection: "row", gap: 0 },
  tree: { backgroundColor: colors.sidebar, borderColor: colors.border, borderWidth: 1, borderRadius: radius },
  treeSplit: { width: 330, marginLeft: space.lg, marginBottom: space.lg },
  treeFull: { flex: 1, marginHorizontal: space.md, marginBottom: space.md },
  treeHead: { padding: space.md, gap: space.sm, borderBottomWidth: 1, borderColor: colors.border },
  treeTitle: { fontSize: 16, fontWeight: "800", color: colors.text },
  treeMeta: { fontSize: 12, color: colors.faint, lineHeight: 17 },
  chapterRow: { flexDirection: "row", alignItems: "center", gap: space.sm, paddingVertical: 10, paddingHorizontal: 10, borderRadius: radiusSm, borderWidth: 1, borderColor: "transparent" },
  chapterRowOpen: { backgroundColor: colors.surface, borderColor: colors.border },
  chapterTitle: { flex: 1, minWidth: 0, fontSize: 13.5, fontWeight: "700", color: colors.text },
  chapterCount: { fontSize: 11.5, color: colors.faint },
  moduleList: { marginLeft: 18, paddingLeft: space.sm, borderLeftWidth: 1, borderColor: colors.border, paddingVertical: 4 },
  moduleRow: { flexDirection: "row", alignItems: "center", gap: space.sm, paddingVertical: 8, paddingHorizontal: 10, borderRadius: radiusSm, borderWidth: 1, borderColor: "transparent" },
  moduleRowOn: { backgroundColor: colors.tealTint, borderColor: `${colors.primary}33` },
  moduleNum: { width: 22, fontSize: 11, color: colors.faint, fontVariant: ["tabular-nums"] },
  moduleTitle: { flex: 1, minWidth: 0, fontSize: 13.5, color: colors.muted },
  dot: { width: 8, height: 8, borderRadius: 4 },
  emptyModules: { fontSize: 12.5, color: colors.faint, paddingVertical: 8, paddingHorizontal: 10 },
  pane: { flex: 1, minWidth: 0, minHeight: 0, paddingHorizontal: space.lg, paddingBottom: space.md, gap: space.sm },
  crumb: { fontSize: 12.5, color: colors.muted },
  crumbNow: { fontSize: 12.5, color: colors.faint },
  fieldLabel: { fontSize: 12.5, color: colors.muted, fontWeight: "600" },
  charCount: { fontSize: 12, color: colors.faint },
  chapterListRow: { flexDirection: "row", alignItems: "center", gap: space.sm, padding: space.md, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, borderRadius: radiusSm },
  footer: { flexDirection: "row", alignItems: "center", gap: space.md, paddingTop: space.sm, borderTopWidth: 1, borderColor: colors.border },
  saveState: { fontSize: 12.5, color: colors.faint },
  hint: { fontSize: 12, color: colors.faint, lineHeight: 17 },
});
