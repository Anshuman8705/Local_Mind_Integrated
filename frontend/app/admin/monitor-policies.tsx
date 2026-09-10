import React, { useState } from "react";
import { View } from "react-native";
import { admin } from "@/api/endpoints";
import type { MonitorPolicy, MonitorSeverity } from "@/api/types";
import { useAction, useAsync } from "@/hooks/useAsync";
import { Badge, Button, Card, Chip, ErrorBanner, H2, Input, Loading, Notice, P, Row, Screen, colors, space } from "@/ui";
import { ISSUE_LABEL, SEVERITY_COLOR } from "./monitoring";

/**
 * When does a verdict become an incident? One row per issue type: enabled,
 * minimum confidence, minimum severity. Editing here changes routing without
 * a deployment; every change bumps the policy version and is audited.
 */

const SEVERITIES: MonitorSeverity[] = ["low", "medium", "high", "critical"];

function PolicyCard({ p, onSaved }: { p: MonitorPolicy; onSaved: (row: MonitorPolicy) => void }) {
  const [conf, setConf] = useState(String(Math.round(p.min_confidence * 100)));
  const [sev, setSev] = useState<MonitorSeverity>(p.min_severity);
  const [enabled, setEnabled] = useState(p.enabled);
  const save = useAction(async () => {
    const value = Number(conf);
    if (Number.isNaN(value) || value < 0 || value > 100) throw new Error("Confidence must be between 0 and 100.");
    onSaved(await admin.updatePolicy(p.issue_type, { enabled, min_confidence: value / 100, min_severity: sev }));
  });
  const dirty = enabled !== p.enabled || sev !== p.min_severity || Number(conf) !== Math.round(p.min_confidence * 100);
  return (
    <Card>
      <Row style={{ justifyContent: "space-between" }}>
        <H2 icon="options-outline">{ISSUE_LABEL[p.issue_type] ?? p.issue_type}</H2>
        <Badge value={enabled ? "enabled" : "disabled"} color={enabled ? colors.success : colors.muted} />
      </Row>
      <P muted small>{p.description}</P>
      <Row style={{ gap: space.md, flexWrap: "wrap", alignItems: "flex-end", marginTop: space.sm }}>
        <Input label="Minimum confidence (%)" compact keyboardType="numeric" value={conf} onChangeText={setConf} containerStyle={{ width: 180 }} />
        <View style={{ gap: 6 }}>
          <P muted small style={{ fontWeight: "700", textTransform: "uppercase", letterSpacing: 0.4 }}>Minimum severity</P>
          <Row style={{ gap: 6 }}>
            {SEVERITIES.map((s) => <Chip key={s} label={s} selected={sev === s} onPress={() => setSev(s)} />)}
          </Row>
        </View>
        <Button small variant="secondary" title={enabled ? "Disable" : "Enable"} icon={enabled ? "pause-outline" : "play-outline"} onPress={() => setEnabled((v) => !v)} />
        <Button small title="Save" icon="save-outline" disabled={!dirty} busy={save.busy} onPress={() => void save.run()} />
      </Row>
      {save.error ? <ErrorBanner message={save.error} /> : null}
      <P muted small style={{ marginTop: 6 }}>{`Version ${p.version}${p.updated_by ? ` · last changed by ${p.updated_by.full_name}` : ""} · incidents are created at or above ${Math.round(p.min_confidence * 100)}% confidence and `}<P small style={{ color: SEVERITY_COLOR[p.min_severity] }}>{p.min_severity}</P>{" severity"}</P>
    </Card>
  );
}

export default function MonitorPolicies() {
  const q = useAsync(() => admin.monitorPolicies(), []);
  return (
    <Screen refreshing={q.loading} onRefresh={q.reload}>
      <ErrorBanner message={q.error} onRetry={q.reload} />
      <Notice message="Raising a threshold makes the incident queue quieter but lets more issues through unreviewed; lowering it does the opposite. Judge-only verdicts also need AI_MONITOR_MIN_JUDGE_CONFIDENCE, which is set in the environment, not here." />
      {q.loading && !q.data ? <Loading /> : null}
      {q.data?.map((p) => <PolicyCard key={p.id} p={p} onSaved={(row) => q.setData((q.data ?? []).map((x) => (x.id === row.id ? row : x)))} />)}
    </Screen>
  );
}
