import { Stack, useRouter, useSegments } from "expo-router";
import { StatusBar } from "expo-status-bar";
import React, { useEffect } from "react";
import { View } from "react-native";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { AuthProvider, useAuth } from "@/auth/AuthContext";
import { DialogHost, Loading, colors } from "@/ui";

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
    const home = user.role === "student" ? "/(student)" : user.role === "faculty" ? "/(manage)" : "/(admin)";
    const allowed = user.role === "student" ? ["(student)"] : user.role === "faculty" ? ["(manage)"] : ["(admin)", "(manage)"];
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
            <Stack.Screen name="(student)" options={{ headerShown: false }} />
            <Stack.Screen name="(manage)" options={{ headerShown: false }} />
            <Stack.Screen name="(admin)" options={{ headerShown: false }} />
          </Stack>
          {/* One dialog host for the whole app: every confirmation and warning
              renders here, centred, instead of in a browser popup. */}
          <DialogHost />
        </Gate>
      </AuthProvider>
    </SafeAreaProvider>
  );
}
