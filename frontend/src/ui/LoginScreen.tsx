import { Ionicons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import React, { useState } from "react";
import { KeyboardAvoidingView, Platform, Pressable, StyleSheet, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { BASE_URL } from "@/api/client";
import type { Role } from "@/api/types";
import { useAuth } from "@/auth/AuthContext";
import { useAction } from "@/hooks/useAsync";
import { Button, ErrorBanner, Gradient, Input, colors } from "@/ui";
import { Brand } from "@/ui/Shell";

type IconName = keyof typeof Ionicons.glyphMap;
const COPY: Record<Role, { title: string; blurb: string; accent: string; icon: IconName }> = {
  student: { title: "Student login", blurb: "Read your subjects, take quizzes and submit assignments.", accent: colors.primary, icon: "school-outline" },
  faculty: { title: "Faculty login", blurb: "Publish books, open modules, set quizzes and evaluate.", accent: colors.accent, icon: "book-outline" },
  admin: { title: "Administrator login", blurb: "Manage people, subjects and the platform.", accent: colors.purple, icon: "shield-half-outline" },
};

export function LoginScreen({ role }: { role: Role }) {
  const { login } = useAuth();
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [show, setShow] = useState(false);
  const action = useAction(async () => { await login(role, email.trim().toLowerCase(), password); });
  const c = COPY[role];
  return (
    <Gradient name="hero" direction="vertical" style={{ flex: 1 }}>
      <SafeAreaView style={{ flex: 1 }}>
        <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined} style={s.center}>
          <View style={s.box}>
            <View style={s.brandRow}>
              <Brand />
              <Pressable onPress={() => router.replace("/login")} hitSlop={8} style={({ pressed }) => [s.switch, pressed && { opacity: 0.7 }]}>
                <Ionicons name="swap-horizontal-outline" size={15} color={colors.muted} />
                <Text style={s.switchText}>Switch portal</Text>
              </Pressable>
            </View>
            <View style={s.card}>
              <View style={[s.stripe, { backgroundColor: c.accent }]} />
              <View style={s.head}>
                <View style={[s.headIcon, { backgroundColor: `${c.accent}22` }]}><Ionicons name={c.icon} size={22} color={c.accent} /></View>
                <View style={{ flex: 1, minWidth: 0 }}>
                  <Text style={s.title}>{c.title}</Text>
                  <Text style={s.blurb}>{c.blurb}</Text>
                </View>
              </View>
              <View style={{ gap: 14 }}>
                <Input label="Email" value={email} onChangeText={setEmail} autoCapitalize="none" keyboardType="email-address" autoComplete="email" textContentType="username" placeholder="you@college.edu" />
                <View>
                  <Input label="Password" value={password} onChangeText={setPassword} secureTextEntry={!show} textContentType="password" onSubmitEditing={() => action.run()} placeholder="••••••••" style={{ paddingRight: 44 }} />
                  <Pressable onPress={() => setShow((v) => !v)} hitSlop={8} style={s.eye}><Ionicons name={show ? "eye-off-outline" : "eye-outline"} size={19} color={colors.muted} /></Pressable>
                </View>
                <ErrorBanner message={action.error} />
                <Button title="Sign In" icon="log-in-outline" onPress={() => action.run()} busy={action.busy} disabled={!email || !password} />
              </View>
            </View>
            <Text style={s.server}>Server · {BASE_URL}</Text>
          </View>
        </KeyboardAvoidingView>
      </SafeAreaView>
    </Gradient>
  );
}

const s = StyleSheet.create({
  center: { flex: 1, justifyContent: "center", paddingHorizontal: 20, paddingVertical: 28 },
  box: { maxWidth: 440, width: "100%", alignSelf: "center", gap: 18 },
  brandRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  switch: { flexDirection: "row", alignItems: "center", gap: 6, paddingHorizontal: 10, paddingVertical: 6, borderRadius: 999, borderWidth: 1, borderColor: colors.border },
  switchText: { color: colors.muted, fontSize: 12, fontWeight: "600" },
  card: { backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, borderRadius: 16, padding: 22, gap: 20, overflow: "hidden" },
  stripe: { position: "absolute", top: 0, left: 0, right: 0, height: 3 },
  head: { flexDirection: "row", alignItems: "center", gap: 14 },
  headIcon: { width: 46, height: 46, borderRadius: 12, alignItems: "center", justifyContent: "center" },
  title: { color: colors.text, fontSize: 21, fontWeight: "800", letterSpacing: -0.3 },
  blurb: { color: colors.muted, fontSize: 13, lineHeight: 18, marginTop: 2 },
  eye: { position: "absolute", right: 12, bottom: 12 },
  server: { color: colors.faint, fontSize: 11, textAlign: "center" },
});
