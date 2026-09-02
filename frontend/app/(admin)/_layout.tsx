import { Ionicons } from "@expo/vector-icons";
import { Tabs, useRouter } from "expo-router";
import React from "react";
import { useShell } from "@/ui/Shell";

const icon = (name: keyof typeof Ionicons.glyphMap) => {
  const TabIcon = ({ color, size }: { color: string; size: number }) => <Ionicons name={name} color={color} size={size} />;
  TabIcon.displayName = `TabIcon(${name})`;
  return TabIcon;
};

export default function AdminLayout() {
  const router = useRouter();
  const shell = useShell({
    name: "Admin console",
    crossLink: { label: "Content workspace", icon: "book-outline", onPress: () => router.replace("/(manage)") },
  });
  return (
    <Tabs screenOptions={shell.screenOptions} tabBar={shell.tabBar}>
      <Tabs.Screen name="index" options={{ title: "Platform Overview", tabBarLabel: "Overview", tabBarIcon: icon("speedometer-outline") }} />
      <Tabs.Screen name="subjects" options={{ title: "Subjects", tabBarIcon: icon("library-outline") }} />
      <Tabs.Screen name="users" options={{ title: "People", tabBarIcon: icon("people-outline") }} />
      <Tabs.Screen name="audit" options={{ title: "Audit Log", tabBarLabel: "Audit", tabBarIcon: icon("receipt-outline") }} />
      <Tabs.Screen name="profile" options={{ title: "Profile", tabBarIcon: icon("person-circle-outline") }} />
      <Tabs.Screen name="subject/[id]" options={{ href: null, title: "Subject" }} />
      <Tabs.Screen name="user/[id]" options={{ href: null, title: "User" }} />
      <Tabs.Screen name="user/new" options={{ href: null, title: "New User" }} />
      <Tabs.Screen name="user/import" options={{ href: null, title: "Import from Excel" }} />
    </Tabs>
  );
}
