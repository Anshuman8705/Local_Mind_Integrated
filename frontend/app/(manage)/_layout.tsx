import { Ionicons } from "@expo/vector-icons";
import { Tabs, useRouter } from "expo-router";
import React from "react";
import { useAuth } from "@/auth/AuthContext";
import { shellScreen, useShell } from "@/ui/Shell";

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
    crossLink: user?.role === "admin" ? { label: "Admin Console", icon: "shield-half-outline", onPress: () => router.replace("/(admin)") } : undefined,
  });
  return (
    <Tabs screenOptions={shell.screenOptions} tabBar={shell.tabBar}>
      <Tabs.Screen name="index" options={{ title: "Subjects", tabBarIcon: icon("library-outline") }} />
      <Tabs.Screen name="books" options={shellScreen({ title: "Books", tabBarIcon: icon("book-outline") }, { subtitle: "Uploaded books and their processing status." })} />
      <Tabs.Screen name="quizzes" options={shellScreen({ title: "Quizzes", tabBarIcon: icon("help-circle-outline") }, { subtitle: "Quizzes you have created, by status." })} />
      <Tabs.Screen name="assignments" options={shellScreen({ title: "Assignments", tabBarIcon: icon("create-outline") }, { subtitle: "Assignments you have set, by status." })} />
      <Tabs.Screen name="profile" options={{ title: "Profile", tabBarIcon: icon("person-circle-outline") }} />
      <Tabs.Screen name="subject/[id]" options={shellScreen({ href: null, title: "Subject" }, { backTo: "/(manage)" })} />
      <Tabs.Screen name="document/[id]" options={shellScreen({ href: null, title: "Book" }, { backTo: "/(manage)/books" })} />
      <Tabs.Screen name="document/upload" options={shellScreen({ href: null, title: "Upload a Book" }, { backTo: "/(manage)/books" })} />
      <Tabs.Screen name="quiz/[id]" options={shellScreen({ href: null, title: "Quiz" }, { backTo: "/(manage)/quizzes" })} />
      <Tabs.Screen name="quiz/new" options={shellScreen({ href: null, title: "New Quiz" }, { backTo: "/(manage)/quizzes" })} />
      <Tabs.Screen name="assignment/[id]" options={shellScreen({ href: null, title: "Assignment" }, { backTo: "/(manage)/assignments" })} />
      <Tabs.Screen name="assignment/new" options={shellScreen({ href: null, title: "New Assignment" }, { backTo: "/(manage)/assignments" })} />
    </Tabs>
  );
}
