import { useLocalSearchParams, useRouter } from "expo-router";
import React, { useEffect, useState } from "react";
import { View } from "react-native";
import { admin } from "@/api/endpoints";
import { useAction, useAsync } from "@/hooks/useAsync";
import { useFilterChoices } from "@/hooks/useChoices";
import { Button, Card, CardGrid, Chip, Empty, ErrorBanner, H2, Input, ListRow, Loading, Notice, Row, Screen } from "@/ui";

export default function Subjects() {
  const router = useRouter();
  const p = useLocalSearchParams<{ notice?: string }>();
  const [status, setStatus] = useState("");
  // The statuses come from the server, which reads them off the model.
  const filters = useFilterChoices("subject_status");
  const [q, setQ] = useState("");
  const [notice, setNotice] = useState<string | null>(null);
  // The create form is hidden until asked for; it was permanently occupying the
  // top of the page even though most visits here are to find an existing subject.
  const [creating, setCreating] = useState(false);
  // The subject screen sends us back here after a delete with a one-line result.
  useEffect(() => {
    if (p.notice) { setNotice(String(p.notice)); router.setParams({ notice: "" } as never); }
  }, [p.notice, router]);
  const list = useAsync(() => admin.subjects({ status, q }), [status, q]);
  const [name, setName] = useState(""); const [code, setCode] = useState("");
  const create = useAction(async () => {
    await admin.createSubject({ name, code });
    setName(""); setCode(""); setCreating(false);
    await list.reload();
  });
  return (
    <Screen
      refreshing={list.loading}
      onRefresh={list.reload}
      toolbar={
        <>
          <Input compact containerStyle={{ flex: 1, minWidth: 180, maxWidth: 320 }} placeholder="Search subjects" value={q} onChangeText={setQ} />
          {filters.map((f) => <Chip key={f.value} label={f.label} selected={status === f.value} onPress={() => setStatus(f.value)} />)}
        </>
      }
      actions={<Button title={creating ? "Cancel" : "New Subject"} icon={creating ? "close-outline" : "add-outline"} small variant={creating ? "secondary" : "primary"} onPress={() => setCreating((x) => !x)} />}
    >
      {creating ? (
        <Card>
          <H2>Create a subject</H2>
          <Row>
            <View style={{ flex: 2, minWidth: 200 }}><Input placeholder="Name" value={name} onChangeText={setName} /></View>
            <View style={{ flex: 1, minWidth: 120 }}><Input placeholder="CODE" value={code} onChangeText={setCode} autoCapitalize="characters" /></View>
            <Button title="Create" small onPress={() => create.run()} busy={create.busy} disabled={!name || !code} />
          </Row>
          <ErrorBanner message={create.error} />
        </Card>
      ) : null}
      {notice ? <Notice tone="success" message={notice} /> : null}
      <ErrorBanner message={list.error} onRetry={list.reload} />
      {list.loading && !list.data ? <Loading /> : null}
      {list.data?.length === 0 ? <Empty text={q ? "No subjects match that search." : "No subjects yet."} /> : null}
      <CardGrid>
        {list.data?.map((s) => <ListRow key={s.id} icon="library-outline" title={`${s.code} · ${s.name}`} subtitle={s.description || undefined} badge={s.status === "active" ? undefined : s.status} onPress={() => router.push(`/(admin)/subject/${s.id}`)} />)}
      </CardGrid>
    </Screen>
  );
}
