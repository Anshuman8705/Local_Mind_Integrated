import { Ionicons } from "@expo/vector-icons";
import { useLocalSearchParams, useRouter } from "expo-router";
import React, { useState } from "react";
import { View } from "react-native";
import { admin } from "@/api/endpoints";
import type { ReviewAction, ValidatorResult } from "@/api/types";
import { useAction, useAsync } from "@/hooks/useAsync";
import { Badge, Button, Card, Divider, ErrorBanner, H2, Input, Loading, Notice, P, Row, Screen, colors, confirmAsync, fmtDate, space } from "@/ui";
import { ISSUE_LABEL, SEVERITY_COLOR, STATUS_COLOR, label } from "../monitoring";

/**
 * One incident, laid out for a reviewer: what the student asked, what the
 * reference said, what the AI answered, and what the monitor concluded, side
 * by side. Below that, every validator result and the judge's verdict with
 * its quoted evidence, so the decision can be reproduced by reading. The
 * controls write a reviewer label (used to measure evaluator precision) and
 * an audit entry; nothing here changes a student's record.
 */

function Validator({ v }: { v: ValidatorResult }) {
  const tone = v.passed === true ? colors.success : v.passed === false ? (v.severity === "high" || v.severity === "critical" ? colors.danger : colors.warning) : colors.muted;
  const icon = v.passed === true ? "checkmark-circle-outline" : v.passed === false ? "close-circle-outline" : "help-circle-outline";
  return (
    <Row style={{ alignItems: "flex-start", gap: space.sm, paddingVertical: 6 }}>
      <Ionicons name={icon} size={18} color={tone} />
      <View style={{ flex: 1, gap: 2 }}>
        <Row style={{ justifyContent: "space-between" }}>
          <P style={{ fontWeight: "700" }}>{label(v.name)}</P>
          {v.passed === false ? <Badge value={`${ISSUE_LABEL[v.issue_type] ?? v.issue_type} · ${v.severity} · ${Math.round(v.confidence * 100)}%`} color={tone} /> : v.passed === null ? <Badge value="undecided" color={colors.muted} /> : null}
        </Row>
        <P muted small>{v.detail}</P>
        {v.evidence?.map((e, i) => <P key={i} small style={{ color: colors.text, fontStyle: "italic" }}>{e}</P>)}
      </View>
    </Row>
  );
}

function Pane({ title, icon, children, accent }: { title: string; icon: keyof typeof Ionicons.glyphMap; children: React.ReactNode; accent?: string }) {
  return (
    <Card style={{ flex: 1, minWidth: 260 }} accent={accent}>
      <H2 icon={icon}>{title}</H2>
      {children}
    </Card>
  );
}

export default function IncidentScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const q = useAsync(() => admin.monitorIncident(id), [id]);
  const [note, setNote] = useState("");
  const review = useAction(async (action: ReviewAction) => {
    if (action === "close" || action === "false_positive") {
      const ok = await confirmAsync(action === "close" ? "Close this incident?" : "Mark as false positive?",
        action === "close" ? "Closing records that no further action is needed." : "This tells the monitor its verdict was wrong and lowers the reported precision for this issue type.");
      if (!ok) return;
    }
    const updated = await admin.reviewIncident(id, action, note);
    q.setData(updated);
    setNote("");
  });
  const rerun = useAction(async () => {
    if (!q.data) return;
    await admin.reevaluate(q.data.evaluation.id);
    await q.reload();
  });

  const i = q.data;
  const e = i?.evaluation;
  const judge = e?.judge_json ?? {};
  const resolved = i ? ["confirmed", "false_positive", "closed"].includes(i.status) : false;

  return (
    <Screen refreshing={q.loading} onRefresh={q.reload}>
      <ErrorBanner message={q.error ?? review.error ?? rerun.error} onRetry={q.reload} />
      {q.loading && !i ? <Loading /> : null}
      {i && e ? (
        <>
          <Card>
            <Row style={{ justifyContent: "space-between", flexWrap: "wrap", gap: space.sm }}>
              <View style={{ flex: 1, minWidth: 240 }}>
                <P style={{ fontSize: 18, fontWeight: "800" }}>{ISSUE_LABEL[i.issue_type] ?? label(i.issue_type)} in a {e.interaction_kind === "quiz" ? "generated quiz" : "tutor answer"}</P>
                <P muted small>{`${i.user ? `${i.user.full_name} (${i.user.role})` : "unknown user"} · ${i.subject ? `${i.subject.code} ${i.subject.name}` : "no subject"}${e.module_title ? ` · ${e.module_title}` : ""} · model ${e.app_model_name || "unknown"} · ${fmtDate(i.created_at)}`}</P>
                <P muted small>{`Evaluator v${e.evaluator_version} · decided by ${e.judge_invoked ? `validators + judge (${e.judge_model || "shared model"}, reason: ${e.judge_reason})` : "validators only"} · ${e.duration_ms} ms${i.recurrence ? ` · ${i.recurrence} similar incident(s) in the last 7 days` : ""}`}</P>
              </View>
              <View style={{ alignItems: "flex-end", gap: 4 }}>
                <Badge value={i.severity} color={SEVERITY_COLOR[i.severity]} />
                <Badge value={i.status} color={STATUS_COLOR[i.status]} />
                <P muted small>{`confidence ${Math.round(e.confidence * 100)}%`}</P>
              </View>
            </Row>
            <Divider />
            <P>{e.reason}</P>
            <P muted small>{`Recommended action: ${label(e.recommended_action)}`}</P>
            {i.assigned_to ? <P muted small>{`Assigned to ${i.assigned_to.full_name}`}</P> : null}
            {i.reviewer_note ? <Notice message={`Reviewer note: ${i.reviewer_note}`} /> : null}
          </Card>

          <Row style={{ gap: space.md, alignItems: "stretch", flexWrap: "wrap" }}>
            <Pane title={e.interaction_kind === "quiz" ? "Request" : "Student question"} icon="person-outline">
              <P style={{ lineHeight: 20 }}>{e.prompt_excerpt || "(none recorded)"}</P>
            </Pane>
            <Pane title="Reference material" icon="book-outline" accent={colors.accent}>
              {e.evidence_json.length === 0 ? <P muted small>No reference passages were available for this interaction.</P> : null}
              {e.evidence_json.map((p, idx) => (
                <View key={idx} style={{ marginBottom: 8 }}>
                  <P muted small style={{ fontWeight: "700" }}>{p.ref}{p.truncated ? " (truncated)" : ""}</P>
                  <P small style={{ lineHeight: 18 }}>{p.text}</P>
                </View>
              ))}
            </Pane>
            <Pane title={e.interaction_kind === "quiz" ? "Generated quiz" : "AI response"} icon="sparkles-outline" accent={SEVERITY_COLOR[i.severity]}>
              <P style={{ lineHeight: 20 }}>{e.response_excerpt}</P>
            </Pane>
            <Pane title="Monitoring verdict" icon="shield-checkmark-outline" accent={colors.purple}>
              {e.judge_invoked ? (
                judge.reason ? (
                  <>
                    <P small style={{ fontWeight: "700" }}>{`Judge: ${judge.is_issue ? `${ISSUE_LABEL[judge.issue_type ?? "other"]} · ${judge.severity}` : "no issue"} · ${Math.round((judge.confidence ?? 0) * 100)}%`}</P>
                    <P small style={{ lineHeight: 18 }}>{judge.reason}</P>
                    {judge.evidence?.map((x, n) => <P key={n} small style={{ fontStyle: "italic", color: colors.text }}>{`\u201c${x}\u201d`}</P>)}
                    <P muted small>{`${e.judge_model} · ${e.judge_latency_ms ?? 0} ms`}</P>
                  </>
                ) : <P muted small>{`Judge was called but failed: ${e.judge_error || "unknown error"}. The validator finding stands.`}</P>
              ) : <P muted small>The judge was not consulted: the deterministic checks were decisive on their own.</P>}
            </Pane>
          </Row>

          <Card>
            <H2 icon="checkbox-outline">Deterministic validators</H2>
            {e.validators_json.map((v) => <Validator key={v.name} v={v} />)}
          </Card>

          <Card>
            <H2 icon="create-outline">Review</H2>
            <P muted small>Confirming or rejecting records a label used to measure the precision of the monitor, and an audit entry. No student is penalised by any of these actions.</P>
            <Input label="Note (optional)" placeholder="What you checked and what you found" value={note} onChangeText={setNote} multiline />
            <Row style={{ flexWrap: "wrap", gap: space.sm, marginTop: space.sm }}>
              {!resolved ? <Button title="Confirm issue" icon="checkmark-outline" busy={review.busy} onPress={() => void review.run("confirm")} /> : null}
              {!resolved ? <Button title="False positive" variant="secondary" icon="thumbs-down-outline" busy={review.busy} onPress={() => void review.run("false_positive")} /> : null}
              {i.status !== "needs_investigation" && !resolved ? <Button title="Needs investigation" variant="secondary" icon="search-outline" busy={review.busy} onPress={() => void review.run("needs_investigation")} /> : null}
              {i.status !== "escalated" && !resolved ? <Button title="Escalate" variant="danger" icon="arrow-up-outline" busy={review.busy} onPress={() => void review.run("escalate")} /> : null}
              {!resolved ? <Button title="Close" variant="ghost" icon="close-outline" busy={review.busy} onPress={() => void review.run("close")} /> : null}
              {resolved ? <Button title="Reopen" variant="secondary" icon="refresh-outline" busy={review.busy} onPress={() => void review.run("reopen")} /> : null}
              <Button title="Re-evaluate with judge" variant="ghost" icon="sparkles-outline" busy={rerun.busy} onPress={() => void rerun.run()} />
            </Row>
            {e.feedback.length ? (
              <>
                <Divider />
                {e.feedback.map((f) => <P key={f.id} muted small>{`${label(f.label)} · ${f.reviewer?.full_name ?? "unknown"} · ${fmtDate(f.created_at)}${f.note ? ` · ${f.note}` : ""}`}</P>)}
              </>
            ) : null}
          </Card>
          <Button title="Back to the queue" variant="ghost" icon="arrow-back-outline" onPress={() => router.replace("/admin/monitoring")} />
        </>
      ) : null}
    </Screen>
  );
}
