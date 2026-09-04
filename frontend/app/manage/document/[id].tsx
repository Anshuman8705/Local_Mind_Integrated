import { useLocalSearchParams, useRouter } from "expo-router";
import React, { useCallback, useEffect, useMemo, useState } from "react";
import { View } from "react-native";
import { manage } from "@/api/endpoints";
import type { Document, Outline, OutlineChapter, OutlineModule } from "@/api/types";
import { useAction, useAsync } from "@/hooks/useAsync";
import { useDebounced } from "@/hooks/useDebounced";
import { HeadingPicker } from "@/ui/HeadingPicker";
import { Badge, Button, Card, Empty, ErrorBanner, H1, H2, Input, Loading, Notice, P, Panel, ProgressBar, Row, Screen, colors, confirmAsync, confirmDeleteAsync, fmtSeconds } from "@/ui";

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
  return (
    <Screen refreshing={doc.loading} onRefresh={doc.reload}>
      <Panel width={1100}>
      <ErrorBanner message={doc.error} onRetry={doc.reload} />
      {doc.loading && !d ? <Loading /> : null}
      {d ? (
        <>
          <H1>{d.title}</H1>
          <Row><Badge value={d.status} /><P muted small>{d.original_name} · {d.chapter_count ?? 0} chapters · {d.module_count ?? 0} modules · v{d.content_version}</P></Row>
          {d.status === "processing" ? <ProcessingCard doc={d} /> : null}
          {d.status === "error" ? <Notice tone="warning" message={`Processing failed: ${d.error_message || "unknown error"}. You can retry.`} /> : null}
          {d.missing_source_modules ? <Notice tone="warning" message={`${d.missing_source_modules} module(s) have no source text. Point them at a heading or paste text before publishing.`} /> : null}
          {(d.status === "ready" || d.status === "under_review" || d.status === "unpublished") ? <Notice message="Publishing makes the book visible to enrolled students and opens every module that has source text. You can lock individual modules or chapters afterwards to pace the course." /> : null}
          <ErrorBanner message={act.error ?? remove.error} />
          <Row>
            {(d.status === "uploaded" || d.status === "error") ? <Button title="Process" small onPress={() => act.run("process")} busy={act.busy} /> : null}
            {d.status === "under_review" ? <Button title="Mark Ready" small onPress={() => act.run("ready")} busy={act.busy} /> : null}
            {(d.status === "ready" || d.status === "under_review" || d.status === "unpublished") ? <Button title="Publish" small onPress={() => act.run("publish")} busy={act.busy} /> : null}
            {d.status === "published" ? <Button title="Unpublish" small variant="secondary" onPress={() => act.run("unpublish")} busy={act.busy} /> : null}
            {d.status !== "processing" ? <Button title="Delete" icon="trash-outline" small variant="danger" onPress={() => remove.run()} busy={remove.busy} /> : null}
          </Row>
          {(d.status !== "uploaded" && d.status !== "processing" && d.status !== "error")
            ? <OutlineEditor documentId={id} published={d.status === "published"} onSaved={doc.reload} onState={setPending} />
            : null}
        </>
      ) : null}
      </Panel>
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

function OutlineEditor({ documentId, published, onSaved, onState }: { documentId: string; published: boolean; onSaved: () => void; onState: (s: { dirty: boolean; save: () => Promise<void> }) => void }) {
  const q = useAsync(() => manage.outline(documentId), [documentId]);
  const [chapters, setChapters] = useState<OutlineChapter[] | null>(null);
  const [dirty, setDirty] = useState(false);
  useEffect(() => { if (q.data) { setChapters(q.data.chapters.map((c) => ({ ...c, modules: c.modules.map((m) => ({ ...m })) }))); setDirty(false); } }, [q.data]);
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
    const payload = chapters.map((c, ci) => ({ id: c.id, title: c.title, order: ci + 1, source_heading_index: c.source_heading_index ?? null,
      modules: c.modules.map((m, mi) => ({ id: m.id, title: m.title, order: mi + 1, source_heading_index: m.source_heading_index ?? null, ...(m.source_text !== undefined ? { source_text: m.source_text } : {}) })) }));
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
  const avail = useAction(async (m: OutlineModule) => { if (!m.id) return; await manage.moduleAvailability(m.id, m.availability === "open" ? "locked" : "open"); await q.reload(); });
  const update = (fn: (c: OutlineChapter[]) => OutlineChapter[]) => { setChapters((c) => (c ? fn(c) : c)); setDirty(true); };
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
    if (ok) update((c) => c.filter((_, i) => i !== ci));
  };
  const removeModule = async (ci: number, mi: number) => {
    const m = chapters?.[ci]?.modules[mi];
    if (!m) return;
    const ok = await confirmDeleteAsync(
      "Remove this module?",
      "Nothing is removed from the book until you save the outline. A module a student has already worked through cannot be removed.",
      { detail: m.title, okLabel: "Remove Module" },
    );
    if (ok) update((c) => c.map((x, i) => (i === ci ? { ...x, modules: x.modules.filter((_, j) => j !== mi) } : x)));
  };
  const headings = q.data?.headings ?? [];
  useEffect(() => { onState({ dirty, save: persist }); }, [dirty, persist, onState]);
  // A real textbook has dozens of chapters and hundreds of modules. Rendering
  // all of them expanded put thousands of controls on one page, so chapters
  // open one at a time and the filter narrows the list to what is being
  // looked for. A short book (three chapters or fewer) opens fully, because
  // collapsing it would only add clicks.
  const [openChapter, setOpenChapter] = useState<string | null>(null);
  const [filter, setFilter] = useState("");
  const needle = useDebounced(filter, 150).trim().toLowerCase();
  const small = (chapters?.length ?? 0) <= 3;
  const shown = useMemo(() => {
    if (!chapters) return [];
    if (!needle) return chapters.map((c, i) => ({ chapter: c, index: i, modules: c.modules }));
    return chapters
      .map((c, i) => ({ chapter: c, index: i, modules: c.modules.filter((m) => m.title.toLowerCase().includes(needle)) }))
      .filter((row) => row.modules.length > 0 || row.chapter.title.toLowerCase().includes(needle));
  }, [chapters, needle]);
  const totalModules = chapters?.reduce((n, c) => n + c.modules.length, 0) ?? 0;
  if (q.loading && !chapters) return <Loading />;
  if (!chapters) return <ErrorBanner message={q.error} onRetry={q.reload} />;
  return (
    <>
      <Row style={{ justifyContent: "space-between" }}>
        <H2>Outline</H2>
        <Button title="Add Chapter" small variant="secondary" onPress={() => update((c) => [...c, { title: `Chapter ${c.length + 1}`, order: c.length + 1, modules: [] }])} />
      </Row>
      <P muted small>
        {chapters.length} chapter{chapters.length === 1 ? "" : "s"} · {totalModules} module{totalModules === 1 ? "" : "s"}
        {q.data?.outline_source ? ` · outline from ${q.data.outline_source}` : ""}. Every module must map to a heading or carry its own text.
      </P>
      {published ? <Notice tone="warning" message="This book is published. Saved changes reach enrolled students immediately, and a module a student has already worked through cannot be removed." /> : null}
      {chapters.length > 3 || totalModules > 12 ? (
        <Input compact value={filter} onChangeText={setFilter} placeholder="Find a chapter or module by title" />
      ) : null}
      {needle && shown.length === 0 ? <Empty text="Nothing in this outline matches that." icon="search-outline" /> : null}
      {shown.map(({ chapter: ch, index: ci, modules }) => {
        const key = ch.id ?? `new-${ci}`;
        const expanded = small || !!needle || openChapter === key;
        return (
        <Card key={key} style={{ borderLeftWidth: 4, borderLeftColor: colors.primary }}>
          <Row>
            {!small && !needle ? (
              <Button
                title=""
                icon={expanded ? "chevron-down" : "chevron-forward"}
                small
                variant="ghost"
                onPress={() => setOpenChapter(expanded ? null : key)}
              />
            ) : null}
            <View style={{ flex: 1 }}><Input value={ch.title} onChangeText={(t) => update((c) => c.map((x, i) => (i === ci ? { ...x, title: t } : x)))} /></View>
            <P muted small>{ch.modules.length} module{ch.modules.length === 1 ? "" : "s"}</P>
            <Button title="↑" small variant="ghost" onPress={() => ci > 0 && update((c) => { const n = [...c]; [n[ci - 1], n[ci]] = [n[ci], n[ci - 1]]; return n; })} />
            <Button title="↓" small variant="ghost" onPress={() => ci < chapters.length - 1 && update((c) => { const n = [...c]; [n[ci + 1], n[ci]] = [n[ci], n[ci + 1]]; return n; })} />
            <Button title="Remove" small variant="ghost" onPress={() => removeChapter(ci)} />
          </Row>
          {expanded ? modules.map((m) => {
            const mi = ch.modules.indexOf(m);
            return (
            <ModuleRow key={m.id ?? `new-${ci}-${mi}`} m={m} headings={headings}
              onChange={(nm) => update((c) => c.map((x, i) => (i === ci ? { ...x, modules: x.modules.map((y, j) => (j === mi ? nm : y)) } : x)))}
              onRemove={() => removeModule(ci, mi)}
              onMove={(dir) => update((c) => c.map((x, i) => { if (i !== ci) return x; const n = [...x.modules]; const t = mi + dir; if (t < 0 || t >= n.length) return x; [n[mi], n[t]] = [n[t], n[mi]]; return { ...x, modules: n }; }))}
              onToggle={() => avail.run(m)} />
            );
          }) : null}
          {expanded ? <Button title="Add Module" small variant="ghost" onPress={() => update((c) => c.map((x, i) => (i === ci ? { ...x, modules: [...x.modules, { title: "New module", order: x.modules.length + 1, source_heading_index: null, source_text: "" }] } : x)))} /> : null}
        </Card>
        );
      })}
      <ErrorBanner message={save.error ?? avail.error} />
      {dirty ? <Button title="Save Outline" icon="save-outline" onPress={() => save.run()} busy={save.busy} /> : null}
    </>
  );
}

function ModuleRow({ m, headings, onChange, onRemove, onMove, onToggle }: { m: OutlineModule; headings: Outline["headings"]; onChange: (m: OutlineModule) => void; onRemove: () => void; onMove: (d: -1 | 1) => void; onToggle: () => void }) {
  const [open, setOpen] = useState(false);
  return (
    <View style={{ borderTopWidth: 1, borderColor: colors.border, paddingTop: 8, gap: 6 }}>
      <Row>
        <View style={{ flex: 1 }}><Input value={m.title} onChangeText={(t) => onChange({ ...m, title: t })} /></View>
        {m.id ? <Badge value={m.availability ?? "locked"} /> : null}
        {m.source_missing ? <Badge value="no source" color={colors.danger} /> : null}
        <Button title={open ? "Less" : "More"} small variant="ghost" onPress={() => setOpen((o) => !o)} />
      </Row>
      {open ? (
        <>
          <HeadingPicker
            headings={headings}
            value={m.source_heading_index}
            onChange={(index) => onChange(index === null
              ? { ...m, source_heading_index: null }
              : { ...m, source_heading_index: index, source_text: undefined })}
          />
          <Input label="Source text (edit to override the mapped section)" multiline value={m.source_text ?? ""} onChangeText={(t) => onChange({ ...m, source_text: t })} />
          <Row>
            <Button title="↑" small variant="ghost" onPress={() => onMove(-1)} /><Button title="↓" small variant="ghost" onPress={() => onMove(1)} /><Button title="Remove Module" small variant="ghost" onPress={onRemove} />
            {m.id ? <Button title={m.availability === "open" ? "Lock for students" : "Open for students"} small variant="secondary" onPress={onToggle} disabled={m.source_missing} /> : null}
          </Row>
        </>
      ) : null}
    </View>
  );
}
