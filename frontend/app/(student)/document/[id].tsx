import { Ionicons } from "@expo/vector-icons";
import { useLocalSearchParams, useRouter } from "expo-router";
import React from "react";
import { View, Text } from "react-native";
import { student } from "@/api/endpoints";
import { useAsync } from "@/hooks/useAsync";
import { Badge, Card, ErrorBanner, H1, H2, Loading, P, Screen, colors, pct } from "@/ui";

export default function DocumentScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const q = useAsync(() => student.document(id), [id]);
  return (
    <Screen refreshing={q.loading} onRefresh={q.reload}>
      <ErrorBanner message={q.error} onRetry={q.reload} />
      {q.loading && !q.data ? <Loading /> : null}
      {q.data ? <H1>{q.data.title}</H1> : null}
      {q.data?.chapters.map((ch) => (
        <View key={ch.id} style={{ gap: 8 }}>
          <H2>{ch.order}. {ch.title}</H2>
          {ch.modules.map((m) => {
            const locked = m.availability === "locked";
            const st = m.progress?.status ?? "not_started";
            return (
              <Card key={m.id} onPress={locked ? undefined : () => router.push(`/(student)/module/${m.id}`)} style={[{ flexDirection: "row", alignItems: "center", gap: 12 }, locked && { backgroundColor: colors.lockedBg }]}>
                <Ionicons name={locked ? "lock-closed-outline" : st === "completed" ? "checkmark-circle" : "book-outline"} size={22} color={locked ? colors.muted : st === "completed" ? colors.success : colors.primary} />
                <View style={{ flex: 1 }}>
                  <Text style={{ fontSize: 15, fontWeight: "600", color: locked ? colors.muted : colors.text }}>{ch.order}.{m.order} {m.title}</Text>
                  {!locked && m.progress?.best_quiz_percentage != null ? <P muted small>Best quiz: {pct(m.progress.best_quiz_percentage)}</P> : null}
                </View>
                <Badge value={locked ? "locked" : st} />
              </Card>
            );
          })}
        </View>
      ))}
    </Screen>
  );
}
