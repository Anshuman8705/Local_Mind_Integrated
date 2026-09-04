import { Ionicons } from "@expo/vector-icons";
import React, { useMemo, useState } from "react";
import { View } from "react-native";
import { admin } from "@/api/endpoints";
import type { AuditLog } from "@/api/types";
import { useAsync } from "@/hooks/useAsync";
import { useDebounced } from "@/hooks/useDebounced";
import { Button, Card, Chip, Empty, ErrorBanner, Input, Loading, P, Row, Screen, colors, space } from "@/ui";

/**
 * The audit log, written for reading.
 *
 * Entries used to arrive as a raw action string, a target type and the summary
 * dictionary run through JSON.stringify, which meant nobody could scan the
 * page. Every action in this system is named "<entity>.<verb>", so the entity
 * and verb are split apart and rendered as a sentence, the summary is laid out
 * as labelled values, and entries are grouped under the day they happened.
 */

type Tone = "danger" | "success" | "warning" | "accent" | "muted";

const TONES: Record<Tone, string> = {
  danger: colors.danger,
  success: colors.success,
  warning: colors.warning,
  accent: colors.accent,
  muted: colors.muted,
};

/** Verb families, matched as substrings so a new verb still lands somewhere sensible. */
function toneFor(verb: string): Tone {
  if (/delete|removed|failed|discontinu|revoked|unassigned/.test(verb)) return "danger";
  if (/creat|publish|reactivat|enroll|assigned|processed|uploaded/.test(verb)) return "success";
  if (/archiv|unpublish|closed|reset|superseded/.test(verb)) return "warning";
  if (/updat|edit|review|status/.test(verb)) return "accent";
  return "muted";
}

const ICONS: Record<Tone, keyof typeof Ionicons.glyphMap> = {
  danger: "trash-outline",
  success: "add-circle-outline",
  warning: "alert-circle-outline",
  accent: "create-outline",
  muted: "ellipse-outline",
};

const sentence = (s: string) => {
  const clean = s.replace(/[._]/g, " ").trim();
  return clean.charAt(0).toUpperCase() + clean.slice(1);
};

/** "subject.deleted" becomes { entity: "subject", verb: "deleted" } */
function splitAction(action: string) {
  const dot = action.indexOf(".");
  if (dot === -1) return { entity: "", verb: action };
  return { entity: action.slice(0, dot), verb: action.slice(dot + 1) };
}

/** Renders one summary value: [old, new] pairs read as a change, lists join. */
function summaryValue(value: unknown): string {
  if (value === null || value === undefined) return "\u2014";
  if (Array.isArray(value)) {
    if (value.length === 2 && value.every((v) => typeof v !== "object")) return `${value[0]} \u2192 ${value[1]}`;
    return value.map((v) => (typeof v === "object" ? JSON.stringify(v) : String(v))).join(", ");
  }
  if (typeof value === "boolean") return value ? "yes" : "no";
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
}

const dayKey = (iso: string) => new Date(iso).toDateString();

function dayLabel(iso: string) {
  const d = new Date(iso);
  const today = new Date();
  const yesterday = new Date(today);
  yesterday.setDate(today.getDate() - 1);
  if (d.toDateString() === today.toDateString()) return "Today";
  if (d.toDateString() === yesterday.toDateString()) return "Yesterday";
  return d.toLocaleDateString(undefined, { weekday: "long", day: "numeric", month: "long", year: "numeric" });
}

const time = (iso: string) => new Date(iso).toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });

function Entry({ log }: { log: AuditLog }) {
  const { entity, verb } = splitAction(log.action);
  const tone = toneFor(verb);
  const colour = TONES[tone];
  const pairs = Object.entries(log.summary ?? {}).filter(([, v]) => v !== "" && v !== null && v !== undefined);
  return (
    <Card style={{ flexDirection: "row", gap: space.md, alignItems: "flex-start" }}>
      <View style={{ width: 34, height: 34, borderRadius: 17, backgroundColor: `${colour}22`, alignItems: "center", justifyContent: "center" }}>
        <Ionicons name={ICONS[tone]} size={17} color={colour} />
      </View>
      <View style={{ flex: 1, minWidth: 0, gap: 4 }}>
        <P style={{ fontWeight: "700" }}>{sentence(entity)} {verb.replace(/_/g, " ")}</P>
        {log.target_label ? <P small>{log.target_label}</P> : null}
        <P muted small>
          {log.actor_email || "system"}
          {log.actor_role ? ` \u00b7 ${log.actor_role}` : ""} \u00b7 {time(log.created_at)}
        </P>
        {pairs.length ? (
          <View style={{ flexDirection: "row", flexWrap: "wrap", gap: space.sm, marginTop: 2 }}>
            {pairs.map(([key, value]) => (
              <View key={key} style={{ backgroundColor: colors.surface2, borderRadius: 6, paddingHorizontal: 8, paddingVertical: 4 }}>
                <P muted small>{key.replace(/_/g, " ")}: <P small style={{ color: colors.text }}>{summaryValue(value)}</P></P>
              </View>
            ))}
          </View>
        ) : null}
      </View>
    </Card>
  );
}

export default function Audit() {
  const [action, setAction] = useState("");
  const [actor, setActor] = useState("");
  const [page, setPage] = useState(1);
  const who = useDebounced(actor);
  const q = useAsync(() => admin.auditLogs({ action, actor_email: who, page }), [action, who, page]);
  // The filter offers the actions actually present in the log, so nobody has
  // to know that publishing a book records "document.published".
  const known = useAsync(() => admin.auditActions(), []);
  const set = (value: string) => { setAction(value); setPage(1); };

  const days = useMemo(() => {
    const groups: { key: string; label: string; entries: AuditLog[] }[] = [];
    for (const log of q.data?.results ?? []) {
      const key = dayKey(log.created_at);
      const last = groups[groups.length - 1];
      if (last && last.key === key) last.entries.push(log);
      else groups.push({ key, label: dayLabel(log.created_at), entries: [log] });
    }
    return groups;
  }, [q.data]);

  return (
    <Screen
      refreshing={q.loading}
      onRefresh={q.reload}
      toolbar={
        <>
          <Input compact containerStyle={{ flex: 1, minWidth: 180, maxWidth: 300 }} placeholder="Filter by who did it" value={actor} onChangeText={(t) => { setActor(t); setPage(1); }} />
          <Chip label="All actions" selected={action === ""} onPress={() => set("")} />
          {known.data?.actions.map((a) => (
            <Chip key={a.value} label={`${sentence(a.value)} (${a.count})`} selected={action === a.value} onPress={() => set(a.value)} />
          ))}
        </>
      }
    >
      <ErrorBanner message={q.error} onRetry={q.reload} />
      {q.loading && !q.data ? <Loading /> : null}
      {q.data?.results.length === 0 ? <Empty text={action || actor ? "Nothing matches that filter." : "Nothing has been recorded yet."} icon="receipt-outline" /> : null}
      {days.map((day) => (
        <View key={day.key} style={{ gap: space.sm }}>
          <Row style={{ justifyContent: "space-between", marginTop: space.sm }}>
            <P muted small style={{ fontWeight: "700", letterSpacing: 0.4, textTransform: "uppercase" }}>{day.label}</P>
            <P muted small>{day.entries.length} {day.entries.length === 1 ? "entry" : "entries"}</P>
          </Row>
          {day.entries.map((log) => <Entry key={log.id} log={log} />)}
        </View>
      ))}
      {q.data && q.data.count > 0 ? (
        <Row style={{ justifyContent: "space-between", marginTop: space.md }}>
          <P muted small>{q.data.count} entries \u00b7 page {page}</P>
          <Row>
            {page > 1 ? <Button title="Previous" icon="chevron-back-outline" small variant="secondary" onPress={() => setPage((p) => p - 1)} /> : null}
            {q.data.next ? <Button title="Next" icon="chevron-forward-outline" small variant="secondary" onPress={() => setPage((p) => p + 1)} /> : null}
          </Row>
        </Row>
      ) : null}
    </Screen>
  );
}
