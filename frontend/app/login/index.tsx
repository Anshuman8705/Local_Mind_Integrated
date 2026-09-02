import { Ionicons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import React from "react";
import { Pressable, StyleSheet, Text, View, useWindowDimensions } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { BASE_URL } from "@/api/client";
import { Gradient, bp, colors, space } from "@/ui";
import { Brand } from "@/ui/Shell";

const PORTALS = [
  { href: "/login/student", title: "Student", blurb: "Learn from published books, take quizzes and submit assignments.", icon: "school-outline", color: colors.primary },
  { href: "/login/faculty", title: "Faculty", blurb: "Upload books, open modules, set quizzes and evaluate work.", icon: "book-outline", color: colors.accent },
  { href: "/login/admin", title: "Administrator", blurb: "Manage faculty, students, subjects and platform reports.", icon: "shield-half-outline", color: colors.purple },
] as const;

export default function ChoosePortal() {
  const router = useRouter();
  const { width } = useWindowDimensions();
  const wide = width >= bp.desktop;
  return (
    <Gradient name="hero" direction="vertical" style={{ flex: 1 }}>
      <SafeAreaView style={{ flex: 1 }}>
        <View style={[s.wrap, wide && s.wrapWide]}>
          <View style={[s.hero, wide && { flex: 1, paddingRight: 48 }]}>
            <Brand />
            <Text style={s.title}>Learning that stays{"\n"}on your own machine.</Text>
            <Text style={s.lead}>A private AI tutor grounded in your course books. Nothing leaves the classroom server.</Text>
            <View style={s.pills}>
              {["Local AI", "Role-based", "Offline-first"].map((t) => <View key={t} style={s.pill}><Text style={s.pillText}>{t}</Text></View>)}
            </View>
          </View>
          <View style={[s.cards, wide && { width: 420 }]}>
            <Text style={s.choose}>Choose your portal</Text>
            {PORTALS.map((p) => (
              <Pressable key={p.href} onPress={() => router.push(p.href)} style={({ pressed }) => [s.card, pressed && { borderColor: p.color, opacity: 0.9 }]}>
                <View style={[s.cardIcon, { backgroundColor: `${p.color}22` }]}><Ionicons name={p.icon} size={22} color={p.color} /></View>
                <View style={{ flex: 1, minWidth: 0 }}>
                  <Text style={s.cardTitle}>{p.title}</Text>
                  <Text style={s.cardBlurb}>{p.blurb}</Text>
                </View>
                <Ionicons name="chevron-forward" size={18} color={colors.faint} />
              </Pressable>
            ))}
            <Text style={s.server}>Server · {BASE_URL}</Text>
          </View>
        </View>
      </SafeAreaView>
    </Gradient>
  );
}

const s = StyleSheet.create({
  wrap: { flex: 1, justifyContent: "center", paddingHorizontal: 24, paddingVertical: 32, gap: 28, maxWidth: 1040, width: "100%", alignSelf: "center" },
  wrapWide: { flexDirection: "row", alignItems: "center", gap: 48, paddingHorizontal: 48 },
  hero: { gap: 16 },
  title: { color: colors.text, fontSize: 32, lineHeight: 38, fontWeight: "800", letterSpacing: -0.6, marginTop: 8 },
  lead: { color: colors.muted, fontSize: 15, lineHeight: 22, maxWidth: 460 },
  pills: { flexDirection: "row", flexWrap: "wrap", gap: 8, marginTop: 4 },
  pill: { borderWidth: 1, borderColor: colors.borderStrong, borderRadius: 999, paddingHorizontal: 12, paddingVertical: 6, backgroundColor: "rgba(255,255,255,0.03)" },
  pillText: { color: colors.text, fontSize: 12, fontWeight: "600" },
  cards: { gap: 12 },
  choose: { color: colors.muted, fontSize: 12, fontWeight: "700", letterSpacing: 0.8, textTransform: "uppercase", marginBottom: 4 },
  card: { flexDirection: "row", alignItems: "center", gap: 14, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, borderRadius: 14, padding: 16 },
  cardIcon: { width: 46, height: 46, borderRadius: 12, alignItems: "center", justifyContent: "center" },
  cardTitle: { color: colors.text, fontSize: 16, fontWeight: "800" },
  cardBlurb: { color: colors.muted, fontSize: 13, lineHeight: 18, marginTop: 2 },
  server: { color: colors.faint, fontSize: 11, textAlign: "center", marginTop: space.sm },
});
