import { Ionicons } from "@expo/vector-icons";
import * as DocumentPicker from "expo-document-picker";
import { useLocalSearchParams, useRouter } from "expo-router";
import React, { useState } from "react";
import { Platform, Pressable, View } from "react-native";
import { admin } from "@/api/endpoints";
import type { ImportReport } from "@/api/types";
import { useAction, useAsync } from "@/hooks/useAsync";
import { Button, Card, Chip, ErrorBanner, H2, Loading, Notice, P, Row, Screen, Stat, colors, radiusSm, space } from "@/ui";

const kb = (bytes?: number) => (bytes ? `${Math.max(1, Math.round(bytes / 1024))} KB` : "");

export default function ImportUsers() {
  const router = useRouter();
  const p = useLocalSearchParams<{ kind?: string }>();
  const [kind, setKind] = useState<"faculty" | "students">(p.kind === "faculty" ? "faculty" : "students");
  const [file, setFile] = useState<DocumentPicker.DocumentPickerAsset | null>(null);
  const [report, setReport] = useState<ImportReport | null>(null);
  const who = kind === "faculty" ? "faculty" : "students";
  // The columns come from the server, which derives them from the parser, so
  // this screen cannot describe a sheet the importer would reject.
  const spec = useAsync(() => admin.importTemplate(kind), [kind]);

  const pick = async () => {
    const r = await DocumentPicker.getDocumentAsync({ type: ["application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"], copyToCacheDirectory: true });
    if (!r.canceled && r.assets[0]) { setFile(r.assets[0]); setReport(null); }
  };

  // Downloaded through the authenticated request rather than a link, so no
  // token ends up in a URL.
  const download = useAction(async () => {
    const data = spec.data ?? (await admin.importTemplate(kind));
    const bytes = Uint8Array.from(atob(data.content_base64), (c) => c.charCodeAt(0));
    const blob = new Blob([bytes], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = data.filename; a.click();
    URL.revokeObjectURL(url);
  });

  const upload = useAction(async () => {
    if (!file) return;
    const form = new FormData();
    if (Platform.OS === "web" && file.file) form.append("file", file.file, file.name); else form.append("file", { uri: file.uri, name: file.name, type: file.mimeType ?? "application/octet-stream" } as any);
    const r = await admin.importUsers(kind, form);
    const skipped = r.already_existing ? `, ${r.already_existing} already existed` : "";
    const summary = `Imported ${r.created} ${who} of ${r.total_rows} row${r.total_rows === 1 ? "" : "s"}${skipped}.`;
    // An email that is already on the platform is a normal outcome, not a
    // problem with the sheet: re-importing a class list should not be
    // presented as a failure. Only genuinely invalid rows keep us here.
    if (r.invalid === 0) {
      router.replace({ pathname: "/admin/users", params: { kind, notice: summary } });
      return;
    }
    setReport(r);
  });

  const failures = (report?.errors ?? []).filter((e) => !(e.errors ?? []).every((x) => x === "User already exists."));
  const required = (spec.data?.columns ?? []).filter((c) => c.required).map((c) => c.name);
  const optional = (spec.data?.columns ?? []).filter((c) => !c.required).map((c) => c.name);
  const aliasHint = (spec.data?.columns ?? []).flatMap((c) => c.aliases).slice(0, 3).join(", ");

  return (
    <Screen>
      <Row style={{ justifyContent: "space-between" }}>
        <Row>
          <Chip label="Students" selected={kind === "students"} onPress={() => { setKind("students"); setReport(null); }} />
          <Chip label="Faculty" selected={kind === "faculty"} onPress={() => { setKind("faculty"); setReport(null); }} />
        </Row>
        {Platform.OS === "web" ? (
          <Button title="Download Template" icon="download-outline" small variant="secondary" onPress={() => download.run()} busy={download.busy} />
        ) : null}
      </Row>

      <Card>
        <H2 icon="cloud-upload-outline">Choose a file</H2>
        <Pressable
          onPress={pick}
            style={({ pressed }) => [{
              borderWidth: 1, borderStyle: "dashed", borderColor: file ? colors.primary : colors.borderStrong,
              borderRadius: radiusSm, padding: space.xl, alignItems: "center", gap: 6,
              backgroundColor: file ? colors.tealTint : "transparent",
            }, pressed && { opacity: 0.85 }]}
          >
            <Ionicons name={file ? "document-text-outline" : "cloud-upload-outline"} size={26} color={file ? colors.primary : colors.faint} />
            <P small style={{ fontWeight: "600" }}>{file ? file.name : "Choose an .xlsx file"}</P>
            <P muted small>{file ? `${kb(file.size)} \u00b7 tap to change` : "Only .xlsx is accepted"}</P>
          </Pressable>
        <ErrorBanner message={upload.error ?? download.error} />
        <Button title={`Import ${who}`} icon="arrow-forward-outline" onPress={() => upload.run()} busy={upload.busy} disabled={!file} />
        <Notice message="Every account is created with the platform's initial password and must change it at first login. A row whose email already exists is skipped, not overwritten." />
      </Card>

      {/* One line rather than a table: the template carries the exact
          headers, so the page only has to say which are required. */}
      <ErrorBanner message={spec.error} onRetry={spec.reload} />
      {spec.loading && !spec.data ? <Loading /> : null}
      {spec.data ? (
        <View style={{ flexDirection: "row", gap: space.md, alignItems: "flex-start", backgroundColor: colors.surface2, borderLeftWidth: 3, borderLeftColor: colors.accent, borderRadius: radiusSm, padding: space.md }}>
          <Ionicons name="grid-outline" size={18} color={colors.accent} style={{ marginTop: 2 }} />
          <View style={{ flex: 1, gap: 2 }}>
            <Row style={{ gap: 6 }}><P small style={{ fontWeight: "700" }}>Required columns:</P><P small style={{ color: colors.primary, fontWeight: "700" }}>{required.join(", ")}</P></Row>
            {optional.length ? <Row style={{ gap: 6 }}><P small style={{ fontWeight: "700" }}>Optional columns:</P><P small>{optional.join(", ")}</P></Row> : null}
            <P muted small>Common variations such as {aliasHint} are understood, and any column the platform does not use is ignored.</P>
          </View>
        </View>
      ) : null}

      {report ? (
        <Card accent={colors.warning}>
          <H2 icon="alert-circle-outline">{report.invalid} row{report.invalid === 1 ? "" : "s"} could not be imported</H2>
          <Row><Stat label="rows" value={report.total_rows} /><Stat label="created" value={report.created} /><Stat label="already existed" value={report.already_existing} /><Stat label="invalid" value={report.invalid} /></Row>
          <P muted small>Fix these rows in the sheet and import it again. Rows that were created are not created twice.</P>
          <View style={{ gap: 2 }}>
            {failures.map((e, i) => (
              <Row key={i} style={{ gap: space.sm, paddingVertical: 4, borderBottomWidth: 1, borderBottomColor: colors.border }}>
                <P small style={{ fontWeight: "700", width: 64 }}>Row {e.row}</P>
                <P muted small style={{ flex: 1 }}>{e.email || "no email"}</P>
                <P small style={{ flex: 2, color: colors.danger }}>{(e.errors ?? []).join("; ")}</P>
              </Row>
            ))}
          </View>
          <Button title="Back to People" small variant="secondary" onPress={() => router.replace({ pathname: "/admin/users", params: { kind, notice: `Imported ${report.created} ${who}; ${report.invalid} row(s) skipped.` } })} />
        </Card>
      ) : null}
    </Screen>
  );
}
