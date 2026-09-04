import { Ionicons } from "@expo/vector-icons";
import * as DocumentPicker from "expo-document-picker";
import { useLocalSearchParams, useRouter } from "expo-router";
import React, { useState } from "react";
import { Platform, Pressable, View } from "react-native";
import { admin } from "@/api/endpoints";
import type { ImportReport } from "@/api/types";
import { useAction } from "@/hooks/useAsync";
import { Button, Card, Chip, ErrorBanner, H2, Notice, P, Panel, Row, Screen, Stat, colors, radiusSm, space } from "@/ui";

/** The sheet each import expects, described once and shown as a table. */
const COLUMNS = {
  students: [
    { name: "name", required: true, example: "Priya Kulkarni" },
    { name: "email", required: true, example: "priya@example.edu" },
    { name: "roll_number", required: false, example: "CS4750" },
    { name: "program", required: false, example: "B.Tech CSE" },
    { name: "batch", required: false, example: "2026" },
    { name: "phone", required: false, example: "9876543210" },
  ],
  faculty: [
    { name: "name", required: true, example: "Dr Anand Rao" },
    { name: "email", required: true, example: "anand@example.edu" },
    { name: "employee_id", required: false, example: "EMP1042" },
    { name: "department", required: false, example: "Computer Science" },
    { name: "designation", required: false, example: "Associate Professor" },
    { name: "phone", required: false, example: "9876543210" },
    { name: "subject_codes", required: false, example: "CS101, CS201" },
  ],
} as const;

const kb = (bytes?: number) => (bytes ? `${Math.max(1, Math.round(bytes / 1024))} KB` : "");

export default function ImportUsers() {
  const router = useRouter();
  const p = useLocalSearchParams<{ kind?: string }>();
  const [kind, setKind] = useState<"faculty" | "students">(p.kind === "faculty" ? "faculty" : "students");
  const [file, setFile] = useState<DocumentPicker.DocumentPickerAsset | null>(null);
  const [report, setReport] = useState<ImportReport | null>(null);
  const who = kind === "faculty" ? "faculty" : "students";
  const pick = async () => {
    const r = await DocumentPicker.getDocumentAsync({ type: ["application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"], copyToCacheDirectory: true });
    if (!r.canceled && r.assets[0]) { setFile(r.assets[0]); setReport(null); }
  };
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
  return (
    <Screen>
      <Panel width={980}>
        <Row><Chip label="Students" selected={kind === "students"} onPress={() => { setKind("students"); setReport(null); }} /><Chip label="Faculty" selected={kind === "faculty"} onPress={() => { setKind("faculty"); setReport(null); }} /></Row>
        {/* The sheet's shape used to be one dense line of prose. Shown as a
            table with an example row it can be checked against the file
            without leaving the page. */}
        <View style={{ flexDirection: "row", flexWrap: "wrap", gap: space.lg, alignItems: "flex-start" }}>
          <Card style={{ flex: 1, minWidth: 320 }}>
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
              <P muted small>{file ? `${kb(file.size)} · tap to change` : "Only .xlsx is accepted"}</P>
            </Pressable>
            <ErrorBanner message={upload.error} />
            <Button title={`Import ${who}`} icon="download-outline" onPress={() => upload.run()} busy={upload.busy} disabled={!file} />
            <Notice message="Every account is created with the platform's initial password and must change it at first login. A row whose email already exists is skipped, not overwritten." />
          </Card>
          <Card style={{ flex: 1, minWidth: 320 }}>
            <H2 icon="grid-outline">Columns the sheet needs</H2>
            <P muted small>The first row is the header. Column order does not matter, and any column not listed here is ignored.</P>
            <View style={{ gap: 2 }}>
              {COLUMNS[kind].map((c) => (
                <Row key={c.name} style={{ justifyContent: "space-between", paddingVertical: 5, borderBottomWidth: 1, borderBottomColor: colors.border }}>
                  <P small style={{ fontWeight: "700", flex: 1 }}>{c.name}</P>
                  <P muted small style={{ width: 74 }}>{c.required ? "required" : "optional"}</P>
                  <P muted small style={{ flex: 1, textAlign: "right" }}>{c.example}</P>
                </Row>
              ))}
            </View>
          </Card>
        </View>
        {report ? (
          <Card accent={colors.warning}>
            <H2 icon="alert-circle-outline">{report.invalid} row{report.invalid === 1 ? "" : "s"} could not be imported</H2>
            <Row><Stat label="rows" value={report.total_rows} /><Stat label="created" value={report.created} /><Stat label="already existed" value={report.already_existing} /><Stat label="invalid" value={report.invalid} /></Row>
            <P muted small>Fix these rows in the sheet and import it again. Rows that were created are not created twice.</P>
            <View style={{ gap: 2 }}>
              {report.errors.filter((e) => !(e.errors ?? []).every((x) => x === "User already exists.")).map((e, i) => (
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
      </Panel>
    </Screen>
  );
}
