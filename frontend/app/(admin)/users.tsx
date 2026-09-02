import { useRouter } from "expo-router";
import React, { useState } from "react";
import { admin } from "@/api/endpoints";
import { useAsync } from "@/hooks/useAsync";
import { Button, Chip, Empty, ErrorBanner, Input, ListRow, Loading, Row, Screen } from "@/ui";

export default function Users() {
  const router = useRouter();
  const [kind, setKind] = useState<"faculty" | "students">("students");
  const [status, setStatus] = useState("");
  const [q, setQ] = useState("");
  const list = useAsync(() => admin.users(kind, { status, q }), [kind, status, q]);
  return (
    <Screen refreshing={list.loading} onRefresh={list.reload}>
      <Row style={{ justifyContent: "space-between" }}>
        <Row><Button title="Add" small onPress={() => router.push({ pathname: "/(admin)/user/new", params: { kind } })} /><Button title="Import Excel" small variant="secondary" onPress={() => router.push({ pathname: "/(admin)/user/import", params: { kind } })} /></Row>
      </Row>
      <Row><Chip label="Students" selected={kind === "students"} onPress={() => setKind("students")} /><Chip label="Faculty" selected={kind === "faculty"} onPress={() => setKind("faculty")} /></Row>
      <Row><Input placeholder="Search name or email" value={q} onChangeText={setQ} style={{ flex: 1 }} />{["", "active", "discontinued"].map((s) => <Chip key={s} label={s || "all"} selected={status === s} onPress={() => setStatus(s)} />)}</Row>
      <ErrorBanner message={list.error} onRetry={list.reload} />
      {list.loading && !list.data ? <Loading /> : null}
      {list.data?.length === 0 ? <Empty text="Nobody matches." /> : null}
      {list.data?.map((u) => <ListRow key={u.id} title={u.full_name} subtitle={`${u.email}${u.profile?.roll_number ? ` · ${u.profile.roll_number}` : ""}${u.profile?.employee_id ? ` · ${u.profile.employee_id}` : ""}${u.must_change_password ? " · initial password" : ""}`} badge={u.status} onPress={() => router.push({ pathname: "/(admin)/user/[id]", params: { id: u.id, kind } })} />)}
    </Screen>
  );
}
