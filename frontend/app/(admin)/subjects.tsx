import { useRouter } from "expo-router";
import React, { useState } from "react";
import { View } from "react-native";
import { admin } from "@/api/endpoints";
import { useAction, useAsync } from "@/hooks/useAsync";
import { Button, Card, Chip, Empty, ErrorBanner, H2, Input, ListRow, Loading, Row, Screen } from "@/ui";

export default function Subjects() {
  const router = useRouter();
  const [status, setStatus] = useState("");
  const [q, setQ] = useState("");
  const list = useAsync(() => admin.subjects({ status, q }), [status, q]);
  const [name, setName] = useState(""); const [code, setCode] = useState("");
  const create = useAction(async () => { await admin.createSubject({ name, code }); setName(""); setCode(""); await list.reload(); });
  return (
    <Screen refreshing={list.loading} onRefresh={list.reload}>
      <Card>
        <H2>Create a subject</H2>
        <Row><View style={{ flex: 2 }}><Input placeholder="Name" value={name} onChangeText={setName} /></View><View style={{ flex: 1 }}><Input placeholder="CODE" value={code} onChangeText={setCode} autoCapitalize="characters" /></View></Row>
        <ErrorBanner message={create.error} />
        <Button title="Create" small onPress={() => create.run()} busy={create.busy} disabled={!name || !code} />
      </Card>
      <Row><Input placeholder="Search" value={q} onChangeText={setQ} style={{ flex: 1 }} />{["", "active", "discontinued", "archived"].map((s) => <Chip key={s} label={s || "all"} selected={status === s} onPress={() => setStatus(s)} />)}</Row>
      <ErrorBanner message={list.error} onRetry={list.reload} />
      {list.loading && !list.data ? <Loading /> : null}
      {list.data?.length === 0 ? <Empty text="No subjects." /> : null}
      {list.data?.map((s) => <ListRow key={s.id} title={`${s.code} · ${s.name}`} subtitle={s.description || undefined} badge={s.status} onPress={() => router.push(`/(admin)/subject/${s.id}`)} />)}
    </Screen>
  );
}
