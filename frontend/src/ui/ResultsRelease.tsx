import { Ionicons } from "@expo/vector-icons";
import React from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { Input, colors, radiusSm, space } from "@/ui";

export type ReleaseMode = "immediate" | "held" | "scheduled";

/**
 * When the student may see the outcome of their own work.
 *
 * Immediate is what the product always did. Held keeps the score back until
 * faculty release it, which is what a class sitting the same quiz at
 * different times needs. Scheduled releases at a chosen moment without anyone
 * pressing anything: the backend compares the time on read, so no scheduler
 * has to exist in the deployment.
 *
 * Grading is unaffected in every mode. This decides what leaves the server,
 * not what is stored.
 */
export function ResultsRelease({ value, at, onChange, disabled, kind = "quiz" }: {
  value: ReleaseMode;
  at: string | null;
  onChange: (mode: ReleaseMode, at: string | null) => void;
  disabled?: boolean;
  kind?: "quiz" | "assignment";
}) {
  const options: { key: ReleaseMode; label: string; sub: string }[] = [
    {
      key: "immediate",
      label: "Show the result on submission",
      sub: kind === "quiz"
        ? "Score, pass or fail, and which answers were wrong, as soon as marking finishes."
        : "Score and feedback as soon as you finish marking.",
    },
    {
      key: "held",
      label: "Hold until I release them",
      sub: kind === "quiz"
        ? "The student sees only that the attempt was submitted. You release for the whole class or one student."
        : "The student sees only that the work was received. You release when you are ready.",
    },
    {
      key: "scheduled",
      label: "Release at a set time",
      sub: "Held until the moment you choose, then released on its own.",
    },
  ];
  return (
    <View style={{ gap: 2, width: "100%" }}>
      {options.map((o) => (
        <Pressable key={o.key} onPress={() => !disabled && onChange(o.key, o.key === "scheduled" ? at : null)}
          accessibilityRole="radio" accessibilityState={{ selected: value === o.key }}
          style={({ pressed }) => [r.opt, pressed && { backgroundColor: colors.surface2 }]}>
          <View style={[r.radio, value === o.key && { borderColor: colors.primary }]}>
            {value === o.key ? <View style={r.dot} /> : null}
          </View>
          <View style={{ flex: 1, minWidth: 0 }}>
            <Text style={r.lead}>{o.label}</Text>
            <Text style={r.sub}>{o.sub}</Text>
          </View>
        </Pressable>
      ))}
      {value === "scheduled" ? (
        <View style={r.when}>
          <Input compact value={at ?? ""} onChangeText={(t) => onChange("scheduled", t || null)}
            placeholder="2026-09-20T18:00:00Z" containerStyle={{ flex: 1, minWidth: 220 }} editable={!disabled} />
          <Text style={r.note}>Everyone who has submitted by then sees their result at that moment.</Text>
        </View>
      ) : null}
    </View>
  );
}

/** One line describing the current setting, for a list row or a header. */
export function releaseSummary(mode: ReleaseMode, at?: string | null, pending?: number) {
  if (mode === "immediate") return "";
  if (mode === "scheduled" && at) return `results ${new Date(at).toLocaleDateString()}`;
  if (pending) return `${pending} to release`;
  return "results held";
}

export function ReleaseIcon() {
  return <Ionicons name="lock-closed-outline" size={13} color={colors.warning} />;
}

const r = StyleSheet.create({
  opt: { flexDirection: "row", alignItems: "flex-start", gap: 10, padding: 9, borderRadius: radiusSm },
  radio: { width: 16, height: 16, borderRadius: 8, borderWidth: 1.5, borderColor: colors.borderStrong, marginTop: 3, alignItems: "center", justifyContent: "center" },
  dot: { width: 8, height: 8, borderRadius: 4, backgroundColor: colors.primary },
  lead: { fontSize: 14, color: colors.text },
  sub: { fontSize: 12.5, color: colors.faint, lineHeight: 18 },
  when: { flexDirection: "row", alignItems: "center", gap: space.sm, flexWrap: "wrap", marginLeft: 32, marginBottom: 6 },
  note: { fontSize: 12.5, color: colors.faint, flex: 1, minWidth: 200 },
});
