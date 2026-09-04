import { useLocalSearchParams, useRouter } from "expo-router";
import React, { useState } from "react";
import { View } from "react-native";
import { admin } from "@/api/endpoints";
import { useAction, useAsync } from "@/hooks/useAsync";
import { Button, Card, Chip, Empty, ErrorBanner, H1, H2, Input, Notice, P, Row, Screen, space } from "@/ui";

/** Two fields side by side on a wide screen, stacked on a narrow one. */
function Pair({ children }: { children: React.ReactNode }) {
  return (
    <View style={{ flexDirection: "row", flexWrap: "wrap", gap: space.md }}>
      {React.Children.map(children, (c) => (c ? <View style={{ flex: 1, minWidth: 240 }}>{c}</View> : null))}
    </View>
  );
}

export default function NewUser() {
  const router = useRouter();
  const p = useLocalSearchParams<{ kind?: string }>();
  const [kind, setKind] = useState<"faculty" | "students">(p.kind === "faculty" ? "faculty" : "students");
  const [f, setF] = useState<Record<string, string>>({});
  const [subjectIds, setSubjectIds] = useState<string[]>([]);
  const subjects = useAsync(() => admin.subjects({ status: "active" }), []);
  const set = (k: string) => (v: string) => setF((x) => ({ ...x, [k]: v }));
  const faculty = kind === "faculty";
  const create = useAction(async () => {
    const profileKeys = faculty ? ["employee_id", "department", "designation", "phone"] : ["roll_number", "program", "batch", "phone"];
    const profile = Object.fromEntries(profileKeys.filter((k) => f[k]).map((k) => [k, f[k]]));
    const u = await admin.createUser(kind, { email: f.email?.trim().toLowerCase(), full_name: f.full_name?.trim(), profile, ...(faculty && subjectIds.length ? { subject_ids: subjectIds } : {}) });
    // Back to the People list (which reloads on focus) with a confirmation.
    router.replace({ pathname: "/admin/users", params: { kind, notice: `${faculty ? "Faculty member" : "Student"} ${u.full_name} created.` } });
  });
  return (
    <Screen>
      <Row style={{ justifyContent: "space-between" }}>
        <H1>New {faculty ? "faculty member" : "student"}</H1>
        <Row>
          <Chip label="Student" selected={!faculty} onPress={() => setKind("students")} />
          <Chip label="Faculty" selected={faculty} onPress={() => setKind("faculty")} />
        </Row>
      </Row>

      {/* Six fields in one column ran past the fold on a laptop, so they sit
          two to a row and stack again on a narrow screen. Nothing runs the
          width of the card: a name or an email field a thousand pixels wide
          is no easier to use than one that overflows. */}
      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: space.lg, alignItems: "flex-start" }}>
        <Card style={{ flex: 2, minWidth: 340 }}>
          <H2 icon="person-outline">Account</H2>
          <Pair>
            <Input label="Full name" value={f.full_name ?? ""} onChangeText={set("full_name")} placeholder="As it should appear to students" />
            <Input label="Email" value={f.email ?? ""} onChangeText={set("email")} autoCapitalize="none" keyboardType="email-address" placeholder="Used to sign in" />
          </Pair>

          <H2 icon="id-card-outline">{faculty ? "Faculty details" : "Student details"}</H2>
          <P muted small>All optional. They can be filled in later from the person&apos;s profile.</P>
          {faculty ? (
            <>
              <Pair>
                <Input label="Employee id" value={f.employee_id ?? ""} onChangeText={set("employee_id")} />
                <Input label="Department" value={f.department ?? ""} onChangeText={set("department")} />
              </Pair>
              <Pair>
                <Input label="Designation" value={f.designation ?? ""} onChangeText={set("designation")} />
                <Input label="Phone" value={f.phone ?? ""} onChangeText={set("phone")} keyboardType="phone-pad" />
              </Pair>
            </>
          ) : (
            <>
              <Pair>
                <Input label="Roll number" value={f.roll_number ?? ""} onChangeText={set("roll_number")} />
                <Input label="Program" value={f.program ?? ""} onChangeText={set("program")} />
              </Pair>
              <Pair>
                <Input label="Batch" value={f.batch ?? ""} onChangeText={set("batch")} />
                <Input label="Phone" value={f.phone ?? ""} onChangeText={set("phone")} keyboardType="phone-pad" />
              </Pair>
            </>
          )}
          <ErrorBanner message={create.error} />
          <Button title="Create Account" icon="person-add-outline" onPress={() => create.run()} busy={create.busy} disabled={!f.email || !f.full_name} />
        </Card>

        <View style={{ flex: 1, minWidth: 260, gap: space.md }}>
          {faculty ? (
            <Card>
              <H2 icon="library-outline">Assign to subjects</H2>
              <P muted small>Optional now; subjects can be assigned from the subject screen at any time.</P>
              {subjects.data?.length ? (
                <Row>
                  {subjects.data.map((s) => (
                    <Chip key={s.id} label={s.code} selected={subjectIds.includes(s.id)}
                      onPress={() => setSubjectIds((x) => (x.includes(s.id) ? x.filter((y) => y !== s.id) : [...x, s.id]))} />
                  ))}
                </Row>
              ) : <Empty text="No active subjects to assign yet." icon="library-outline" />}
              {subjectIds.length ? <P muted small>{subjectIds.length} subject{subjectIds.length === 1 ? "" : "s"} selected.</P> : null}
            </Card>
          ) : null}
          <Card>
            <H2 icon="key-outline">What happens next</H2>
            <Notice message="The account is created with the platform's initial password and must change it at first login." />
            <P muted small>
              {faculty
                ? "A faculty member sees only the subjects they are assigned to, and can upload books, set quizzes and mark work for those subjects."
                : "A student sees a subject once they are enrolled on it, and only the modules their faculty has opened."}
            </P>
            <P muted small>Adding a whole class at once? Import from Excel instead.</P>
            <Button title="Import From Excel" icon="cloud-upload-outline" small variant="secondary"
              onPress={() => router.replace({ pathname: "/admin/user/import", params: { kind } })} />
          </Card>
        </View>
      </View>
    </Screen>
  );
}
