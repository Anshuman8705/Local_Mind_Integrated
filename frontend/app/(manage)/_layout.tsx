import { Ionicons } from "@expo/vector-icons";
import { Tabs, useRouter } from "expo-router";
import React from "react";
import { useAuth } from "@/auth/AuthContext";
import { useShell } from "@/ui/Shell";

const icon = (name: keyof typeof Ionicons.glyphMap) => {
  const TabIcon = ({ color, size }: { color: string; size: number }) => <Ionicons name={name} color={color} size={size} />;
  TabIcon.displayName = `TabIcon(${name})`;
  return TabIcon;
};

export default function ManageLayout() {
  const { user } = useAuth();
  const router = useRouter();
  const shell = useShell({
    name: user?.role === "admin" ? "Content workspace" : "Faculty workspace",
    crossLink: user?.role === "admin" ? { label: "Admin console", icon: "shield-half-outline", onPress: () => router.replace("/(admin)") } : undefined,
  });
  return (
    <Tabs screenOptions={shell.screenOptions} tabBar={shell.tabBar}>
      <Tabs.Screen name="index" options={{ title: "Subjects", tabBarIcon: icon("library-outline") }} />
      <Tabs.Screen name="books" options={{ title: "Books", tabBarIcon: icon("book-outline") }} />
      <Tabs.Screen name="quizzes" options={{ title: "Quizzes", tabBarIcon: icon("help-circle-outline") }} />
      <Tabs.Screen name="assignments" options={{ title: "Assignments", tabBarIcon: icon("create-outline") }} />
      <Tabs.Screen name="profile" options={{ title: "Profile", tabBarIcon: icon("person-circle-outline") }} />
      <Tabs.Screen name="subject/[id]" options={{ href: null, title: "Subject" }} />
      <Tabs.Screen name="document/[id]" options={{ href: null, title: "Book" }} />
      <Tabs.Screen name="document/upload" options={{ href: null, title: "Upload a Book" }} />
      <Tabs.Screen name="quiz/[id]" options={{ href: null, title: "Quiz" }} />
      <Tabs.Screen name="quiz/new" options={{ href: null, title: "New Quiz" }} />
      <Tabs.Screen name="assignment/[id]" options={{ href: null, title: "Assignment" }} />
      <Tabs.Screen name="assignment/new" options={{ href: null, title: "New Assignment" }} />
    </Tabs>
  );
}
