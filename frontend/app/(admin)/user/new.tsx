import { useLocalSearchParams, useRouter } from "expo-router";
import React, { useState } from "react";
import { admin } from "@/api/endpoints";
import { useAction, useAsync } from "@/hooks/useAsync";
import { Button, Card, Chip, ErrorBanner, H1, Input, Label, Notice, Row, Screen } from "@/ui";

export default function NewUser() {
  const router = useRouter();
  const p = useLocalSearchParams<{ kind?: string }>();
  const [kind, setKind] = useState<"faculty" | "students">(p.kind === "faculty" ? "faculty" : "students");
  const [f, setF] = useState<Record<string, string>>({});
  const [subjectIds, setSubjectIds] = useState<string[]>([]);
  const subjects = useAsync(() => admin.subjects({ status: "active" }), []);
  const set = (k: string) => (v: string) => setF((x) => ({ ...x, [k]: v }));
  const create = useAction(async () => {
    const profileKeys = kind === "faculty" ? ["employee_id", "department", "designation", "phone"] : ["roll_number", "program", "batch", "phone"];
    const profile = Object.fromEntries(profileKeys.filter((k) => f[k]).map((k) => [k, f[k]]));
    const u = await admin.createUser(kind, { email: f.email?.trim().toLowerCase(), full_name: f.full_name?.trim(), profile, ...(kind === "faculty" && subjectIds.length ? { subject_ids: subjectIds } : {}) });
    // Back to the People list (which reloads on focus) with a confirmation.
    router.replace({ pathname: "/(admin)/users", params: { kind, notice: `${kind === "faculty" ? "Faculty member" : "Student"} ${u.full_name} created.` } });
  });
  return (
    <Screen>
      <H1>New {kind === "faculty" ? "faculty member" : "student"}</H1>
      <Row><Chip label="Student" selected={kind === "students"} onPress={() => setKind("students")} /><Chip label="Faculty" selected={kind === "faculty"} onPress={() => setKind("faculty")} /></Row>
      <Card>
        <Input label="Full name" value={f.full_name ?? ""} onChangeText={set("full_name")} />
        <Input label="Email" value={f.email ?? ""} onChangeText={set("email")} autoCapitalize="none" keyboardType="email-address" />
        {kind === "faculty" ? <>
          <Input label="Employee id" value={f.employee_id ?? ""} onChangeText={set("employee_id")} />
          <Input label="Department" value={f.department ?? ""} onChangeText={set("department")} />
          <Input label="Designation" value={f.designation ?? ""} onChangeText={set("designation")} />
          <Label>Assign to subjects</Label>
          <Row>{subjects.data?.map((s) => <Chip key={s.id} label={s.code} selected={subjectIds.includes(s.id)} onPress={() => setSubjectIds((x) => (x.includes(s.id) ? x.filter((y) => y !== s.id) : [...x, s.id]))} />)}</Row>
        </> : <>
          <Input label="Roll number" value={f.roll_number ?? ""} onChangeText={set("roll_number")} />
          <Input label="Program" value={f.program ?? ""} onChangeText={set("program")} />
          <Input label="Batch" value={f.batch ?? ""} onChangeText={set("batch")} />
        </>}
        <Input label="Phone" value={f.phone ?? ""} onChangeText={set("phone")} keyboardType="phone-pad" />
        <Notice message="The account is created with the platform's initial password and must change it at first login." />
        <ErrorBanner message={create.error} />
        <Button title="Create Account" onPress={() => create.run()} busy={create.busy} disabled={!f.email || !f.full_name} />
      </Card>
    </Screen>
  );
}
