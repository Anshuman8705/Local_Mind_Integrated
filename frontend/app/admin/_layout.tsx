import { Ionicons } from "@expo/vector-icons";
import { Tabs, useRouter } from "expo-router";
import React from "react";
import { shellScreen, useShell } from "@/ui/Shell";

const icon = (name: keyof typeof Ionicons.glyphMap) => {
  const TabIcon = ({ color, size }: { color: string; size: number }) => <Ionicons name={name} color={color} size={size} />;
  TabIcon.displayName = `TabIcon(${name})`;
  return TabIcon;
};

export default function AdminLayout() {
  const router = useRouter();
  const shell = useShell({
    name: "Admin console",
    crossLink: { label: "Content Workspace", icon: "book-outline", onPress: () => router.replace("/manage") },
  });
  return (
    <Tabs screenOptions={shell.screenOptions} tabBar={shell.tabBar}>
      <Tabs.Screen name="index" options={{ title: "Platform Overview", tabBarLabel: "Overview", tabBarIcon: icon("speedometer-outline") }} />
      <Tabs.Screen name="subjects" options={shellScreen({ title: "Subjects", tabBarIcon: icon("library-outline") }, { subtitle: "Every subject on the platform, its faculty and its students." })} />
      <Tabs.Screen name="users" options={shellScreen({ title: "People", tabBarIcon: icon("people-outline") }, { subtitle: "Student and faculty accounts." })} />
      <Tabs.Screen name="audit" options={{ title: "Audit Log", tabBarLabel: "Audit", tabBarIcon: icon("receipt-outline") }} />
      <Tabs.Screen name="profile" options={{ title: "Profile", tabBarIcon: icon("person-circle-outline") }} />
      <Tabs.Screen name="subject/[id]" options={shellScreen({ href: null, title: "Subject" }, { backTo: "/admin/subjects" })} />
      <Tabs.Screen name="user/[id]" options={shellScreen({ href: null, title: "User" }, { backTo: "/admin/users" })} />
      <Tabs.Screen name="user/new" options={shellScreen({ href: null, title: "New User" }, { backTo: "/admin/users" })} />
      <Tabs.Screen name="user/import" options={shellScreen({ href: null, title: "Import From Excel" }, { backTo: "/admin/users" })} />
    </Tabs>
  );
}
