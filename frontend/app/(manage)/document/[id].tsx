import { useLocalSearchParams } from "expo-router";
import React, { useEffect, useState } from "react";
import { View } from "react-native";
import { manage } from "@/api/endpoints";
import type { Outline, OutlineChapter, OutlineModule } from "@/api/types";
import { useAction, useAsync } from "@/hooks/useAsync";
import { Badge, Button, Card, Chip, ErrorBanner, H1, H2, Input, Label, Loading, Notice, P, Row, Screen, colors, confirmAsync } from "@/ui";

export default function DocumentScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const doc = useAsync(() => manage.document(id), [id]);
  const d = doc.data;
  // Poll while processing.
  useEffect(() => { if (d?.status !== "processing") return; const t = setInterval(doc.reload, 3000); return () => clearInterval(t); }, [d?.status, doc.reload]);
  const act = useAction(async (action: "process" | "ready" | "publish" | "unpublish" | "archive") => {
    if (action === "archive") { const ok = await confirm("Archive this book? Students will no longer see it."); if (!ok) return; }
    if (action === "process") await manage.process(id); else await manage.transition(id, action);
    await doc.reload();
  });
  return (
    <Screen refreshing={doc.loading} onRefresh={doc.reload}>
      <ErrorBanner message={doc.error} onRetry={doc.reload} />
      {doc.loading && !d ? <Loading /> : null}
      {d ? (
        <>
          <H1>{d.title}</H1>
          <Row><Badge value={d.status} /><P muted small>{d.original_name} · {d.chapter_count ?? 0} chapters · {d.module_count ?? 0} modules · v{d.content_version}</P></Row>
          {d.status === "processing" ? <Notice message="Parsing the book and drafting an outline. This page refreshes automatically." /> : null}
          {d.status === "error" ? <Notice tone="warning" message={`Processing failed: ${d.error_message || "unknown error"}. You can retry.`} /> : null}
          {d.missing_source_modules ? <Notice tone="warning" message={`${d.missing_source_modules} module(s) have no source text. Point them at a heading or paste text before publishing.`} /> : null}
          {(d.status === "ready" || d.status === "under_review" || d.status === "unpublished") ? <Notice message="Publishing makes the book visible to enrolled students and opens every module that has source text. You can lock individual modules or chapters afterwards to pace the course." /> : null}
          <ErrorBanner message={act.error} />
          <Row>
            {(d.status === "uploaded" || d.status === "error") ? <Button title="Process" small onPress={() => act.run("process")} busy={act.busy} /> : null}
            {d.status === "under_review" ? <Button title="Mark ready" small onPress={() => act.run("ready")} busy={act.busy} /> : null}
            {(d.status === "ready" || d.status === "under_review" || d.status === "unpublished") ? <Button title="Publish" small onPress={() => act.run("publish")} busy={act.busy} /> : null}
            {d.status === "published" ? <Button title="Unpublish" small variant="secondary" onPress={() => act.run("unpublish")} busy={act.busy} /> : null}
            {d.status !== "archived" ? <Button title="Archive" small variant="ghost" onPress={() => act.run("archive")} busy={act.busy} /> : null}
          </Row>
          {(d.status !== "uploaded" && d.status !== "processing" && d.status !== "error") ? <OutlineEditor documentId={id} locked={d.status === "published"} onSaved={doc.reload} /> : null}
        </>
      ) : null}
    </Screen>
  );
}

function confirm(msg: string) {
  return confirmAsync("Confirm", msg);
}

function OutlineEditor({ documentId, locked, onSaved }: { documentId: string; locked: boolean; onSaved: () => void }) {
  const q = useAsync(() => manage.outline(documentId), [documentId]);
  const [chapters, setChapters] = useState<OutlineChapter[] | null>(null);
  const [dirty, setDirty] = useState(false);
  useEffect(() => { if (q.data) { setChapters(q.data.chapters.map((c) => ({ ...c, modules: c.modules.map((m) => ({ ...m })) }))); setDirty(false); } }, [q.data]);
  const save = useAction(async () => {
    if (!chapters) return;
    if (locked) {
      // Structure is frozen after publishing; only per-module text edits are allowed.
      const original = new Map((q.data?.chapters ?? []).flatMap((c) => c.modules).map((m) => [m.id, m]));
      for (const c of chapters) for (const m of c.modules) {
        const o = m.id ? original.get(m.id) : undefined;
        if (o && (o.title !== m.title || (m.source_text !== undefined && o.source_text !== m.source_text))) await manage.editModule(m.id!, { title: m.title, source_text: m.source_text });
      }
      await q.reload(); onSaved(); return;
    }
    const payload = chapters.map((c, ci) => ({ id: c.id, title: c.title, order: ci + 1, source_heading_index: c.source_heading_index ?? null,
      modules: c.modules.map((m, mi) => ({ id: m.id, title: m.title, order: mi + 1, source_heading_index: m.source_heading_index ?? null, ...(m.source_text !== undefined ? { source_text: m.source_text } : {}) })) }));
    await manage.saveOutline(documentId, payload as OutlineChapter[]);
    await q.reload(); onSaved();
  });
  const avail = useAction(async (m: OutlineModule) => { if (!m.id) return; await manage.moduleAvailability(m.id, m.availability === "open" ? "locked" : "open"); await q.reload(); });
  const update = (fn: (c: OutlineChapter[]) => OutlineChapter[]) => { setChapters((c) => (c ? fn(c) : c)); setDirty(true); };
  const headings = q.data?.headings ?? [];
  if (q.loading && !chapters) return <Loading />;
  if (!chapters) return <ErrorBanner message={q.error} onRetry={q.reload} />;
  return (
    <>
      <Row style={{ justifyContent: "space-between" }}>
        <H2>Outline</H2>
        {locked ? <P muted small>Structure is locked after publishing; text edits still allowed.</P> : <Button title="Add chapter" small variant="secondary" onPress={() => update((c) => [...c, { title: `Chapter ${c.length + 1}`, order: c.length + 1, modules: [] }])} />}
      </Row>
      {q.data?.outline_source ? <P muted small>Outline source: {q.data.outline_source}. Every module must map to a heading or carry its own text.</P> : null}
      {chapters.map((ch, ci) => (
        <Card key={ch.id ?? `new-${ci}`} style={{ borderLeftWidth: 4, borderLeftColor: colors.primary }}>
          <Row>
            <View style={{ flex: 1 }}><Input value={ch.title} editable={!locked} onChangeText={(t) => update((c) => c.map((x, i) => (i === ci ? { ...x, title: t } : x)))} /></View>
            {!locked ? <>
              <Button title="↑" small variant="ghost" onPress={() => ci > 0 && update((c) => { const n = [...c]; [n[ci - 1], n[ci]] = [n[ci], n[ci - 1]]; return n; })} />
              <Button title="↓" small variant="ghost" onPress={() => ci < chapters.length - 1 && update((c) => { const n = [...c]; [n[ci + 1], n[ci]] = [n[ci], n[ci + 1]]; return n; })} />
              <Button title="Remove" small variant="ghost" onPress={() => update((c) => c.filter((_, i) => i !== ci))} />
            </> : null}
          </Row>
          {ch.modules.map((m, mi) => (
            <ModuleRow key={m.id ?? `new-${ci}-${mi}`} m={m} locked={locked} headings={headings}
              onChange={(nm) => update((c) => c.map((x, i) => (i === ci ? { ...x, modules: x.modules.map((y, j) => (j === mi ? nm : y)) } : x)))}
              onRemove={() => update((c) => c.map((x, i) => (i === ci ? { ...x, modules: x.modules.filter((_, j) => j !== mi) } : x)))}
              onMove={(dir) => update((c) => c.map((x, i) => { if (i !== ci) return x; const n = [...x.modules]; const t = mi + dir; if (t < 0 || t >= n.length) return x; [n[mi], n[t]] = [n[t], n[mi]]; return { ...x, modules: n }; }))}
              onToggle={() => avail.run(m)} />
          ))}
          {!locked ? <Button title="Add module" small variant="ghost" onPress={() => update((c) => c.map((x, i) => (i === ci ? { ...x, modules: [...x.modules, { title: "New module", order: x.modules.length + 1, source_heading_index: null, source_text: "" }] } : x)))} /> : null}
        </Card>
      ))}
      <ErrorBanner message={save.error ?? avail.error} />
      {dirty ? <Button title={locked ? "Save text edits" : "Save outline"} onPress={() => save.run()} busy={save.busy} /> : null}
    </>
  );
}

function ModuleRow({ m, locked, headings, onChange, onRemove, onMove, onToggle }: { m: OutlineModule; locked: boolean; headings: Outline["headings"]; onChange: (m: OutlineModule) => void; onRemove: () => void; onMove: (d: -1 | 1) => void; onToggle: () => void }) {
  const [open, setOpen] = useState(false);
  const heading = headings.find((h) => h.index === m.source_heading_index);
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
          <Label>Source heading{heading ? `: ${heading.title}` : m.source_heading_index === null ? ": none (uses pasted text)" : ""}</Label>
          {!locked ? <Row>
            <Chip label="none" selected={m.source_heading_index === null} onPress={() => onChange({ ...m, source_heading_index: null })} />
            {headings.map((h) => <Chip key={h.index} label={`${"·".repeat(Math.max(0, h.level - 1))}${h.title}`.slice(0, 40)} selected={m.source_heading_index === h.index} onPress={() => onChange({ ...m, source_heading_index: h.index, source_text: undefined })} />)}
          </Row> : null}
          <Input label="Source text (edit to override the mapped section)" multiline value={m.source_text ?? ""} onChangeText={(t) => onChange({ ...m, source_text: t })} />
          <Row>
            {!locked ? <><Button title="↑" small variant="ghost" onPress={() => onMove(-1)} /><Button title="↓" small variant="ghost" onPress={() => onMove(1)} /><Button title="Remove module" small variant="ghost" onPress={onRemove} /></> : null}
            {m.id ? <Button title={m.availability === "open" ? "Lock for students" : "Open for students"} small variant="secondary" onPress={onToggle} disabled={m.source_missing} /> : null}
          </Row>
        </>
      ) : null}
    </View>
  );
}
