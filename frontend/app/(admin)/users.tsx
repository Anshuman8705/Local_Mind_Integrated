import { useLocalSearchParams, useRouter } from "expo-router";
import React, { useEffect, useState } from "react";
import { admin } from "@/api/endpoints";
import { useAsync } from "@/hooks/useAsync";
import { Button, CardGrid, Chip, Empty, ErrorBanner, Input, ListRow, Loading, Notice, Screen } from "@/ui";

export default function Users() {
  const router = useRouter();
  const p = useLocalSearchParams<{ kind?: string; notice?: string }>();
  const [kind, setKind] = useState<"faculty" | "students">(p.kind === "faculty" ? "faculty" : "students");
  const [notice, setNotice] = useState<string | null>(null);
  // Add / Import / Delete send us back here with the tab to show and a one-line result.
  useEffect(() => {
    if (p.kind === "faculty" || p.kind === "students") setKind(p.kind);
    if (p.notice) { setNotice(String(p.notice)); router.setParams({ notice: "" } as never); }
  }, [p.kind, p.notice, router]);
  const [q, setQ] = useState("");
  // No status filter: accounts are deleted rather than discontinued, so every
  // row in this list is active and an All / Active / Discontinued switch would
  // only ever return the same people three times over.
  const list = useAsync(() => admin.users(kind, { q }), [kind, q]);
  return (
    <Screen
      refreshing={list.loading}
      onRefresh={list.reload}
      toolbar={
        <>
          <Chip label="Students" selected={kind === "students"} onPress={() => setKind("students")} />
          <Chip label="Faculty" selected={kind === "faculty"} onPress={() => setKind("faculty")} />
          <Input compact containerStyle={{ flex: 1, minWidth: 200, maxWidth: 380 }} placeholder="Search name or email" value={q} onChangeText={setQ} />
        </>
      }
      actions={
        <>
          <Button title="Add" icon="person-add-outline" small onPress={() => router.push({ pathname: "/(admin)/user/new", params: { kind } })} />
          <Button title="Import Excel" icon="cloud-upload-outline" small variant="secondary" onPress={() => router.push({ pathname: "/(admin)/user/import", params: { kind } })} />
        </>
      }
    >
      <ErrorBanner message={list.error} onRetry={list.reload} />
      {notice ? <Notice tone="success" message={notice} /> : null}
      {list.loading && !list.data ? <Loading /> : null}
      {list.data?.length === 0 ? <Empty text={q ? "Nobody matches that search." : `No ${kind === "faculty" ? "faculty" : "students"} yet.`} /> : null}
      {/* The badge only appears for an account that is not active, which after
          the move to delete means a row left over from the old lifecycle. */}
      <CardGrid>
      {list.data?.map((u) => <ListRow key={u.id} title={u.full_name} subtitle={`${u.email}${u.profile?.roll_number ? ` · ${u.profile.roll_number}` : ""}${u.profile?.employee_id ? ` · ${u.profile.employee_id}` : ""}${u.must_change_password ? " · initial password" : ""}`} badge={u.status === "active" ? undefined : u.status} onPress={() => router.push({ pathname: "/(admin)/user/[id]", params: { id: u.id, kind } })} />)}
      </CardGrid>
    </Screen>
  );
}
