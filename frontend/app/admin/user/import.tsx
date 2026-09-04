import * as DocumentPicker from "expo-document-picker";
import { useLocalSearchParams, useRouter } from "expo-router";
import React, { useState } from "react";
import { Platform } from "react-native";
import { admin } from "@/api/endpoints";
import type { ImportReport } from "@/api/types";
import { useAction } from "@/hooks/useAsync";
import { Button, Card, Chip, ErrorBanner, H2, Notice, P, Panel, Row, Screen, Stat } from "@/ui";

export default function ImportUsers() {
  const router = useRouter();
  const p = useLocalSearchParams<{ kind?: string }>();
  const [kind, setKind] = useState<"faculty" | "students">(p.kind === "faculty" ? "faculty" : "students");
  const [file, setFile] = useState<DocumentPicker.DocumentPickerAsset | null>(null);
  const [report, setReport] = useState<ImportReport | null>(null);
  const pick = async () => { const r = await DocumentPicker.getDocumentAsync({ type: ["application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"], copyToCacheDirectory: true }); if (!r.canceled && r.assets[0]) setFile(r.assets[0]); };
  const upload = useAction(async () => {
    if (!file) return;
    const form = new FormData();
    if (Platform.OS === "web" && file.file) form.append("file", file.file, file.name); else form.append("file", { uri: file.uri, name: file.name, type: file.mimeType ?? "application/octet-stream" } as any);
    const r = await admin.importUsers(kind, form);
    const summary = `Imported ${r.created} ${kind === "faculty" ? "faculty" : "students"} (${r.already_existing} already existed, ${r.invalid} invalid of ${r.total_rows} rows).`;
    if (r.errors.length === 0) {
      // Clean import: go straight back to People with the counts.
      router.replace({ pathname: "/admin/users", params: { kind, notice: summary } });
      return;
    }
    // Some rows failed: keep the report on screen so the admin can fix the sheet.
    setReport(r);
  });
  return (
    <Screen>
      <Panel width={640}>
      <Row><Chip label="Students" selected={kind === "students"} onPress={() => setKind("students")} /><Chip label="Faculty" selected={kind === "faculty"} onPress={() => setKind("faculty")} /></Row>
      <Card>
        <Notice message={kind === "students" ? "Columns: name, email (required); roll_number, program, batch, phone (optional)." : "Columns: name, email (required); employee_id, department, designation, phone, subject_codes (comma-separated, optional)."} />
        <Row><Button title={file ? "Change file" : "Choose .xlsx"} variant="secondary" small onPress={pick} />{file ? <P small>{file.name}</P> : null}</Row>
        <ErrorBanner message={upload.error} />
        <Button title="Import" onPress={() => upload.run()} busy={upload.busy} disabled={!file} />
      </Card>
      {report ? (
        <Card>
          <H2>Result</H2>
          <Row><Stat label="rows" value={report.total_rows} /><Stat label="created" value={report.created} /><Stat label="existing" value={report.already_existing} /><Stat label="invalid" value={report.invalid} /></Row>
          {report.errors.map((e, i) => <P key={i} small>Row {e.row}{e.email ? ` (${e.email})` : ""}: {e.error}</P>)}
          <Button title="Back to People" small onPress={() => router.replace({ pathname: "/admin/users", params: { kind, notice: `Imported ${report.created} ${kind === "faculty" ? "faculty" : "students"}; ${report.invalid} row(s) skipped.` } })} />
        </Card>
      ) : null}
      </Panel>
    </Screen>
  );
}
