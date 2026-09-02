import { Ionicons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import React from "react";
import { StyleSheet, Text, View } from "react-native";
import { useAuth } from "@/auth/AuthContext";
import { Badge, Button, Card, Divider, Gradient, Label, P, Row, Screen, colors } from "@/ui";

export function ProfileScreen() {
  const { user, logout } = useAuth();
  const router = useRouter();
  if (!user) return null;
  const profile = user.profile ?? {};
  const initials = user.full_name.split(" ").filter(Boolean).slice(0, 2).map((w) => w[0]?.toUpperCase()).join("") || "U";
  const extra = Object.entries(profile).filter(([, v]) => v);
  return (
    <Screen>
      <Card style={{ padding: 0, overflow: "hidden", gap: 0 }}>
        <Gradient name="hero" direction="horizontal" style={s.banner} />
        <View style={s.identity}>
          <Gradient name="brand" style={s.avatar}><Text style={s.avatarText}>{initials}</Text></Gradient>
          <View style={{ flex: 1, minWidth: 0, gap: 4 }}>
            <Text style={s.name}>{user.full_name}</Text>
            <Row><Ionicons name="mail-outline" size={14} color={colors.muted} /><P muted small>{user.email}</P></Row>
          </View>
          <Badge value={user.role} color={colors.primary} />
        </View>
      </Card>
      {extra.length ? (
        <Card>
          {extra.map(([k, v], i) => (
            <React.Fragment key={k}>
              {i > 0 ? <Divider /> : null}
              <View style={s.field}><Label>{k.replace(/_/g, " ")}</Label><P>{String(v)}</P></View>
            </React.Fragment>
          ))}
        </Card>
      ) : null}
      <Row style={{ gap: 12 }}>
        <View style={{ flex: 1, minWidth: 200 }}><Button title="Change password" icon="key-outline" variant="secondary" onPress={() => router.push("/change-password")} /></View>
        <View style={{ flex: 1, minWidth: 200 }}><Button title="Sign out" icon="log-out-outline" variant="danger" onPress={() => logout()} /></View>
      </Row>
    </Screen>
  );
}

const s = StyleSheet.create({
  banner: { height: 72 },
  identity: { flexDirection: "row", alignItems: "center", gap: 16, paddingHorizontal: 20, paddingBottom: 20, marginTop: -28 },
  avatar: { width: 64, height: 64, borderRadius: 32, alignItems: "center", justifyContent: "center", borderWidth: 3, borderColor: colors.surface },
  avatarText: { color: colors.primaryText, fontSize: 22, fontWeight: "800" },
  name: { color: colors.text, fontSize: 20, fontWeight: "800", marginTop: 20 },
  field: { gap: 4, paddingVertical: 4 },
});
