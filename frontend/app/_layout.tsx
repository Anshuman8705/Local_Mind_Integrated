import { Stack, useRouter, useSegments, type ErrorBoundaryProps } from "expo-router";
import { StatusBar } from "expo-status-bar";
import React, { useEffect } from "react";
import { Platform, Pressable, ScrollView, Text, View } from "react-native";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { AuthProvider, useAuth } from "@/auth/AuthContext";
import { DialogHost, Loading, colors } from "@/ui";

/**
 * Shown instead of a blank white page when a screen throws while rendering.
 * Without this, any render error unmounted the whole app on the web. Built
 * from plain React Native pieces only, so it cannot fail for the same reason
 * the screen did, and it shows the error text so a report can say what broke.
 */
export function ErrorBoundary({ error, retry }: ErrorBoundaryProps) {
  return (
    <ScrollView style={{ flex: 1, backgroundColor: "#080F13" }} contentContainerStyle={{ padding: 24, gap: 12, maxWidth: 720, alignSelf: "center", width: "100%" }}>
      <Text style={{ color: "#F4F7F8", fontSize: 22, fontWeight: "800" }}>This screen ran into a problem</Text>
      <Text style={{ color: "#8FA3AE", fontSize: 15, lineHeight: 22 }}>
        Nothing was lost. Try again, or go back and open the page once more. If it keeps happening, send the message below to your administrator.
      </Text>
      <Text selectable style={{ color: "#F3B51B", fontSize: 13, fontFamily: "monospace" }}>{error?.message || String(error)}</Text>
      <View style={{ flexDirection: "row", gap: 12, marginTop: 8 }}>
        <Pressable onPress={retry} style={{ backgroundColor: "#25D0AA", paddingVertical: 10, paddingHorizontal: 18, borderRadius: 8 }}>
          <Text style={{ color: "#06231D", fontWeight: "700" }}>Try Again</Text>
        </Pressable>
      </View>
    </ScrollView>
  );
}

// Web only: keep the app's own files so it can open without the server
// (https or localhost; browsers do not allow this on plain-http LAN addresses).
if (Platform.OS === "web" && typeof window !== "undefined" && window.isSecureContext && "serviceWorker" in navigator && !__DEV__) {
  window.addEventListener("load", () => { navigator.serviceWorker.register("/sw.js").catch(() => {}); });
}

function Gate({ children }: { children: React.ReactNode }) {
  const { ready, user, mustChangePassword } = useAuth();
  const segments = useSegments();
  const router = useRouter();
  useEffect(() => {
    if (!ready) return;
    const first = segments[0] as string | undefined;
    const onLogin = first === "login";
    const onChange = first === "change-password";
    if (!user) { if (!onLogin) router.replace("/login"); return; }
    if (mustChangePassword) { if (!onChange) router.replace("/change-password"); return; }
    const home = user.role === "student" ? "/student" : user.role === "faculty" ? "/manage" : "/admin";
    const allowed = user.role === "student" ? ["student"] : user.role === "faculty" ? ["manage"] : ["admin", "manage"];
    if (onLogin || onChange || !first || !allowed.includes(first)) router.replace(home as any);
  }, [ready, user, mustChangePassword, segments, router]);
  if (!ready) return <View style={{ flex: 1, backgroundColor: colors.bg, justifyContent: "center" }}><Loading /></View>;
  return <>{children}</>;
}

export default function RootLayout() {
  return (
    <SafeAreaProvider>
      <AuthProvider>
        <Gate>
          <StatusBar style="light" />
          <Stack screenOptions={{ headerStyle: { backgroundColor: colors.bg }, headerShadowVisible: false, headerTintColor: colors.text, headerTitleStyle: { fontWeight: "800" }, contentStyle: { backgroundColor: colors.bg } }}>
            <Stack.Screen name="login/index" options={{ headerShown: false }} />
            <Stack.Screen name="login/student" options={{ headerShown: false }} />
            <Stack.Screen name="login/faculty" options={{ headerShown: false }} />
            <Stack.Screen name="login/admin" options={{ headerShown: false }} />
            <Stack.Screen name="change-password" options={{ title: "Set a new password", headerBackVisible: false }} />
            <Stack.Screen name="student" options={{ headerShown: false }} />
            <Stack.Screen name="manage" options={{ headerShown: false }} />
            <Stack.Screen name="admin" options={{ headerShown: false }} />
          </Stack>
          {/* One dialog host for the whole app: every confirmation and warning
              renders here, centred, instead of in a browser popup. */}
          <DialogHost />
        </Gate>
      </AuthProvider>
    </SafeAreaProvider>
  );
}
