import { Ionicons } from "@expo/vector-icons";
import { useLocalSearchParams, useRouter } from "expo-router";
import React, { useCallback, useEffect, useMemo, useState } from "react";
import { Platform, Pressable, ScrollView, StyleSheet, Text, View, useWindowDimensions } from "react-native";
import { manage } from "@/api/endpoints";
import type { Document, OutlineChapter, OutlineModule } from "@/api/types";
import { useAction, useAsync } from "@/hooks/useAsync";
import { useDebounced } from "@/hooks/useDebounced";
import { Badge, Button, Card, Empty, ErrorBanner, H1, H2, Input, Loading, Notice, P, Panel, ProgressBar, Row, Screen, colors, confirmAsync, confirmDeleteAsync, fmtSeconds, radius, radiusSm, space } from "@/ui";

/** Which node of the outline the right-hand pane is editing. */
type Selection = { ci: number; mi: number | null };

export default function DocumentScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const doc = useAsync(() => manage.document(id), [id]);
  const d = doc.data;
  // Poll while processing.
  useEffect(() => { if (d?.status !== "processing") return; const t = setInterval(doc.reload, 3000); return () => clearInterval(t); }, [d?.status, doc.reload]);
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
        {missingSource ? <View style={ws.band}><Notice tone="warning" message={`${missingSource} module${missingSource === 1 ? "" : "s"} have no source text. Point them at a heading or paste text before publishing.`} /></View> : null}
        {d!.status === "published" ? <View style={ws.band}><Notice tone="warning" message="This book is live. Saved changes reach enrolled students immediately, and a module a student has already worked through cannot be removed." /></View> : null}
        <OutlineWorkspace documentId={id} published={d!.status === "published"} onSaved={doc.reload} onState={setPending} />
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
function OutlineWorkspace({ documentId, published, onSaved, onState }: { documentId: string; published: boolean; onSaved: () => void; onState: (s: { dirty: boolean; save: () => Promise<void> }) => void }) {
  const q = useAsync(() => manage.outline(documentId), [documentId]);
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
    const lines: string[] = [];
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
    await manage.saveOutline(documentId, payload as OutlineChapter[]);
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
      style={split ? ws.treeSplit : ws.treeFull}
    />
  );

  const pane = (
    <View style={ws.pane}>
      <ErrorBanner message={save.error ?? avail.error} />
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
function OutlineTree({ chapters, selection, outlineSource, onSelect, onCollapse, onAddChapter, style }: {
  chapters: OutlineChapter[];
  selection: Selection | null;
  outlineSource?: string;
  onSelect: (s: Selection) => void;
  onCollapse: () => void;
  onAddChapter: () => void;
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
          {outlineSource ? ` · ${OUTLINE_SOURCE[outlineSource] ?? `outline from ${outlineSource}`}` : ""}. Every module maps to a heading or carries its own text.
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
function ModulePane({ chapterTitle, module: m, index, count, onChange, onMove, onRemove, onToggle, toggleBusy, onBack }: {
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
      </Row>
      <Row>
        <Text style={ws.fieldLabel}>Position</Text>
        <Button title="Move up" small variant="secondary" onPress={() => onMove(-1)} disabled={index === 0} />
        <Button title="Move down" small variant="secondary" onPress={() => onMove(1)} disabled={index >= count - 1} />
      </Row>
      <Row style={{ justifyContent: "space-between" }}>
        <Text style={ws.fieldLabel}>Source text — edit to override the mapped section</Text>
        <Text style={ws.charCount}>{chars.toLocaleString()} characters</Text>
      </Row>
      <Input
        multiline
        value={m.source_text ?? ""}
        // The backend resolves a mapped heading and refills the text from that
        // section, so text typed against a mapped module was thrown away on
        // save. Editing detaches the module from its heading, which is what the
        // label above has always promised; re-picking the heading brings the
        // section's own text back.
        onChangeText={(t) => onChange({ ...m, source_text: t, source_heading_index: null })}
        placeholder="No text yet. Pick a heading above, or paste the passage here."
        containerStyle={{ flex: 1, minHeight: 0 }}
        style={{ flex: 1, minHeight: 160, lineHeight: 24 }}
      />
      {m.source_heading_index !== null && m.source_heading_index !== undefined ? (
        <Text style={ws.hint}>This text came from the book&apos;s own heading for this module. Editing it keeps what you type instead.</Text>
      ) : null}
      <Row>
        {m.id ? <Button title={m.availability === "open" ? "Lock for students" : "Open for students"} small variant="secondary" onPress={onToggle} disabled={!!m.source_missing} busy={toggleBusy} /> : null}
        <Button title="Remove Module" small variant="ghost" onPress={onRemove} />
      </Row>
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
