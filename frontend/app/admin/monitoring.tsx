import { useRouter } from "expo-router";
import React, { useState } from "react";
import { View } from "react-native";
import { admin } from "@/api/endpoints";
import type { MonitorIncident, MonitorSeverity } from "@/api/types";
import { useAction, useAsync } from "@/hooks/useAsync";
import { Badge, Button, Card, Chip, Empty, ErrorBanner, H2, ListRow, Loading, Notice, P, Row, Screen, Stat, colors, pct, space } from "@/ui";
import { SelectField } from "@/ui/SelectField";

/**
 * AI Monitoring & Guard: the Admin Incident Center.
 *
 * Top: the numbers that say whether the tutor is misbehaving and whether the
 * monitor itself is healthy (coverage, judge readiness, false-positive rate).
 * Below: the incident queue with the filters the PRD asks for (severity,
 * status, issue type, model, kind, period). Everything shown here comes from
 * the server's verdicts; the screen computes nothing.
 */

export const SEVERITY_COLOR: Record<MonitorSeverity, string> = { low: colors.muted, medium: colors.warning, high: colors.danger, critical: colors.purple };
export const STATUS_COLOR: Record<string, string> = {
  open: colors.accent, escalated: colors.danger, needs_investigation: colors.warning, confirmed: colors.purple, false_positive: colors.muted, closed: colors.success,
};
export const ISSUE_LABEL: Record<string, string> = {
  none: "No issue", hallucination: "Hallucination", factual_error: "Factual error", unsupported_claim: "Unsupported claim", instruction_violation: "Instruction violation",
  quiz_error: "Quiz error", safety: "Safety", irrelevant: "Irrelevant", other: "Other",
};
export const label = (s: string) => s.replace(/_/g, " ");
const when = (iso: string) => new Date(iso).toLocaleString(undefined, { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });

function IncidentRow({ i, onPress }: { i: MonitorIncident; onPress: () => void }) {
  const e = i.evaluation;
  const who = i.user ? `${i.user.full_name}` : "unknown user";
  const where = [i.subject?.code, e.module_title].filter(Boolean).join(" · ");
  return (
    <ListRow
      onPress={onPress}
      icon={e.interaction_kind === "quiz" ? "help-circle-outline" : "chatbubble-ellipses-outline"}
      title={`${ISSUE_LABEL[i.issue_type] ?? label(i.issue_type)} · ${e.interaction_kind === "quiz" ? "generated quiz" : "tutor answer"}`}
      subtitle={`${who} · ${where || "no subject"} · ${e.app_model_name || "model unknown"} · ${when(i.created_at)}${i.recurrence ? ` · recurrence ${i.recurrence}` : ""}`}
      right={
        <View style={{ alignItems: "flex-end", gap: 4 }}>
          <Badge value={i.severity} color={SEVERITY_COLOR[i.severity]} />
          <Badge value={i.status} color={STATUS_COLOR[i.status]} />
          <P muted small>{Math.round(e.confidence * 100)}% conf</P>
        </View>
      }
    />
  );
}

export default function Monitoring() {
  const router = useRouter();
  const [days, setDays] = useState(30);
  const [status, setStatus] = useState("active");
  const [severity, setSeverity] = useState("");
  const [issue, setIssue] = useState("");
  const [kind, setKind] = useState("");
  const [page, setPage] = useState(1);
  const [notice, setNotice] = useState<string | null>(null);

  const overview = useAsync(() => admin.monitorOverview(days), [days]);
  const q = useAsync(() => admin.monitorIncidents({ status, severity, issue_type: issue, kind, page, page_size: 25 }), [status, severity, issue, kind, page]);
  const backlog = useAction(async () => {
    const r = await admin.runBacklog(25);
    setNotice(`Evaluated ${r.evaluated} pending interaction(s); ${r.remaining} still pending.`);
    overview.reload(); q.reload();
  });

  const d = overview.data;
  const st = d?.status;
  const set = (f: (v: string) => void) => (v: string) => { f(v); setPage(1); };

  return (
    <Screen
      refreshing={overview.loading || q.loading}
      onRefresh={() => { overview.reload(); q.reload(); }}
      toolbar={
        <>
          <SelectField label={`Last ${days} days`} value={String(days)} onChange={(v) => setDays(Number(v))} icon="calendar-outline" width={160}
            options={[{ value: "7", label: "Last 7 days" }, { value: "30", label: "Last 30 days" }, { value: "90", label: "Last 90 days" }, { value: "365", label: "Last year" }]} />
          <SelectField label={status ? label(status) : "Any status"} value={status} onChange={set(setStatus)} width={200}
            options={[{ value: "active", label: "Active (open, escalated, investigating)" }, { value: "", label: "Any status" }, { value: "open", label: "Open" }, { value: "escalated", label: "Escalated" },
              { value: "needs_investigation", label: "Needs investigation" }, { value: "confirmed", label: "Confirmed" }, { value: "false_positive", label: "False positive" }, { value: "closed", label: "Closed" }]} />
          <SelectField label={severity ? label(severity) : "Any severity"} value={severity} onChange={set(setSeverity)} width={170}
            options={[{ value: "", label: "Any severity" }, { value: "critical", label: "Critical" }, { value: "high", label: "High" }, { value: "medium", label: "Medium" }, { value: "low", label: "Low" }]} />
          <SelectField label={issue ? ISSUE_LABEL[issue] : "Any issue type"} value={issue} onChange={set(setIssue)} width={200}
            options={[{ value: "", label: "Any issue type" }, ...Object.entries(ISSUE_LABEL).filter(([k]) => k !== "none").map(([value, l]) => ({ value, label: l }))]} />
          <SelectField label={kind ? (kind === "quiz" ? "Quizzes" : "Tutor answers") : "Any kind"} value={kind} onChange={set(setKind)} width={160}
            options={[{ value: "", label: "Any kind" }, { value: "tutor_answer", label: "Tutor answers" }, { value: "quiz", label: "Quizzes" }]} />
        </>
      }
      actions={
        <Row>
          <Button small variant="secondary" icon="options-outline" title="Policies" onPress={() => router.push("/admin/monitor-policies")} />
          <Button small variant="secondary" icon="play-outline" title={st?.pending_backlog ? `Evaluate ${Math.min(25, st.pending_backlog)} pending` : "Nothing pending"} disabled={!st?.pending_backlog} busy={backlog.busy} onPress={() => void backlog.run()} />
        </Row>
      }
    >
      <ErrorBanner message={overview.error ?? q.error ?? backlog.error} onRetry={() => { overview.reload(); q.reload(); }} />
      {notice ? <Notice message={notice} tone="success" /> : null}
      {st && !st.judge_ready ? <Notice tone="warning" message={`Judge model unavailable: ${st.judge_detail}. Deterministic validators still run on every interaction; ambiguous cases are recorded as "abstain" until a judge model is ready.`} /> : null}
      {st && !st.enabled ? <Notice tone="warning" message="The AI monitor is switched off (AI_MONITOR_ENABLED=false or AI_MONITOR_MODE=off). Nothing is being evaluated." /> : null}
      {overview.loading && !d ? <Loading /> : null}
      {d ? (
        <>
          <Row style={{ gap: 12 }}>
            <Stat label="AI interactions" icon="chatbubbles-outline" color={colors.accent} value={d.interactions} helper={`last ${d.window_days} days`} />
            <Stat label="evaluated" icon="checkmark-done-outline" color={colors.primary} value={d.evaluated} helper={d.coverage_percent === null ? "no interactions" : `${pct(d.coverage_percent)} coverage`} />
            <Stat label="incidents" icon="alert-circle-outline" color={colors.warning} value={d.incidents} helper={`${d.open_incidents} still open`} />
            <Stat label="high severity" icon="flame-outline" color={colors.danger} value={d.high_severity_incidents} helper={d.high_severity_precision_percent === null ? "none reviewed yet" : `${pct(d.high_severity_precision_percent)} confirmed`} />
            <Stat label="false-positive rate" icon="thumbs-down-outline" color={colors.purple} value={d.false_positive_rate_percent === null ? "—" : pct(d.false_positive_rate_percent)} helper={`${d.feedback_count} reviewer labels`} />
          </Row>
          <Row style={{ gap: 16, alignItems: "stretch" }}>
            <Card style={{ flex: 1, minWidth: 300 }}>
              <H2 icon="pulse-outline">Monitor health</H2>
              <P small>{`Mode ${st?.mode} · evaluator v${d.evaluator_version} · judge ${st?.judge_ready ? "ready" : "unavailable"} (${st?.judge_model || "shared model"}) · sampling ${st?.sample_percent}% of clean answers`}</P>
              <P muted small>{`${d.judge_invocations} judge calls · verdicts: ${d.verdicts.pass} pass, ${d.verdicts.issue} issue, ${d.verdicts.abstain} abstain · ${d.failed_evaluations} evaluator failures · ${st?.pending_backlog ?? 0} pending · queue ${d.queue_depth}`}</P>
              <Row style={{ flexWrap: "wrap", gap: 6, marginTop: 6 }}>
                {Object.entries(d.by_issue_type).filter(([, n]) => n > 0).map(([t, n]) => <Chip key={t} label={`${ISSUE_LABEL[t] ?? t}: ${n}`} />)}
                {Object.values(d.by_issue_type).every((n) => !n) ? <P muted small>No incidents in this period.</P> : null}
              </Row>
            </Card>
            <Card style={{ flex: 1, minWidth: 300 }}>
              <H2 icon="hardware-chip-outline">AI model health</H2>
              {d.models.length === 0 ? <P muted small>No evaluations yet.</P> : null}
              {d.models.map((m) => (
                <Row key={m.model} style={{ justifyContent: "space-between", paddingVertical: 4 }}>
                  <View style={{ flex: 1 }}>
                    <P style={{ fontWeight: "700" }}>{m.model}</P>
                    <P muted small>{`${m.evaluated} evaluated · ${m.issues} issues · ${m.incidents} incidents (${m.high_severity} high)`}</P>
                  </View>
                  <Badge value={`${pct(m.issue_rate_percent)} issue rate`} color={m.issue_rate_percent >= 20 ? colors.danger : m.issue_rate_percent >= 5 ? colors.warning : colors.success} />
                </Row>
              ))}
            </Card>
          </Row>
        </>
      ) : null}

      <H2 icon="list-outline">Incident queue</H2>
      {q.loading && !q.data ? <Loading /> : null}
      {q.data?.results.length === 0 ? <Empty text="No incidents match these filters." icon="shield-checkmark-outline" /> : null}
      <View style={{ gap: space.sm }}>
        {q.data?.results.map((i) => <IncidentRow key={i.id} i={i} onPress={() => router.push(`/admin/incident/${i.id}`)} />)}
      </View>
      {q.data && q.data.count > 0 ? (
        <Row style={{ justifyContent: "space-between", marginTop: space.md }}>
          <P muted small>{`${q.data.count} incidents · page ${page}`}</P>
          <Row>
            {page > 1 ? <Button title="Previous" icon="chevron-back-outline" small variant="secondary" onPress={() => setPage((p) => p - 1)} /> : null}
            {q.data.next ? <Button title="Next" icon="chevron-forward-outline" small variant="secondary" onPress={() => setPage((p) => p + 1)} /> : null}
          </Row>
        </Row>
      ) : null}
    </Screen>
  );
}
