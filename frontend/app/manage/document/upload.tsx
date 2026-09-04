import * as DocumentPicker from "expo-document-picker";
import { useLocalSearchParams, useRouter } from "expo-router";
import React, { useState } from "react";
import { Platform } from "react-native";
import type { ApiError } from "@/api/client";
import { manage } from "@/api/endpoints";
import { useAction, useAsync } from "@/hooks/useAsync";
import { Button, Card, Chip, ErrorBanner, Input, Label, Notice, P, Panel, Row, Screen } from "@/ui";

export default function Upload() {
  const router = useRouter();
  const params = useLocalSearchParams<{ subject?: string }>();
  const subjects = useAsync(() => manage.subjects(), []);
  const [subjectId, setSubjectId] = useState(params.subject ?? "");
  const [title, setTitle] = useState("");
  const [file, setFile] = useState<DocumentPicker.DocumentPickerAsset | null>(null);
  const pick = async () => {
    const res = await DocumentPicker.getDocumentAsync({ type: ["application/pdf", "application/vnd.openxmlformats-officedocument.wordprocessingml.document", "application/msword"], copyToCacheDirectory: true });
    if (!res.canceled && res.assets[0]) { setFile(res.assets[0]); if (!title) setTitle(res.assets[0].name.replace(/\.[^.]+$/, "")); }
  };
  // When the server rejects the file as already on the subject it names the
  // existing book, so offer to open it rather than leaving a dead end.
  const [duplicate, setDuplicate] = useState<string | null>(null);
  const upload = useAction(async () => {
    setDuplicate(null);
    if (!file) return;
    const form = new FormData();
    form.append("subject_id", subjectId); form.append("title", title);
    if (Platform.OS === "web" && file.file) form.append("file", file.file, file.name);
    else form.append("file", { uri: file.uri, name: file.name, type: file.mimeType ?? "application/octet-stream" } as any);
    let doc;
    try {
      doc = await manage.upload(form);
    } catch (e) {
      const existing = (e as ApiError)?.details?.document_id;
      if (typeof existing === "string") setDuplicate(existing);
      throw e;
    }
    await manage.process(doc.id).catch(() => {});
    router.replace(`/manage/document/${doc.id}`);
  });
  return (
    <Screen>
      <Panel width={700}>
      <Card>
        <Label>Subject</Label>
        <Row>{subjects.data?.filter((s) => s.status === "active").map((s) => <Chip key={s.id} label={s.code} selected={subjectId === s.id} onPress={() => setSubjectId(s.id)} />)}</Row>
        <Input label="Title" value={title} onChangeText={setTitle} placeholder="Shown to students" />
        <Label>File (PDF, DOCX or DOC)</Label>
        <Row><Button title={file ? "Change File" : "Choose File"} variant="secondary" small onPress={pick} />{file ? <P small>{file.name}</P> : null}</Row>
        <Notice message="After upload the book is parsed and an outline is drafted. You will review and fix the outline before anything is published." />
        <ErrorBanner message={upload.error} />
        {duplicate ? <Button title="Open the Existing Book" icon="open-outline" variant="secondary" small onPress={() => router.replace(`/manage/document/${duplicate}`)} /> : null}
        <Button title="Upload and Process" onPress={() => upload.run()} busy={upload.busy} disabled={!file || !subjectId} />
      </Card>
      </Panel>
    </Screen>
  );
}
