import { Ionicons } from "@expo/vector-icons";
import { Tabs } from "expo-router";
import React from "react";
import { useShell } from "@/ui/Shell";

const icon = (name: keyof typeof Ionicons.glyphMap) => {
  const TabIcon = ({ color, size }: { color: string; size: number }) => <Ionicons name={name} color={color} size={size} />;
  TabIcon.displayName = `TabIcon(${name})`;
  return TabIcon;
};

export default function StudentLayout() {
  const shell = useShell({ name: "Student portal" });
  return (
    <Tabs screenOptions={shell.screenOptions} tabBar={shell.tabBar}>
      <Tabs.Screen name="index" options={{ title: "My Subjects", tabBarLabel: "Subjects", tabBarIcon: icon("library-outline") }} />
      <Tabs.Screen name="quizzes" options={{ title: "Quizzes", tabBarIcon: icon("help-circle-outline") }} />
      <Tabs.Screen name="assignments" options={{ title: "Assignments", tabBarIcon: icon("create-outline") }} />
      <Tabs.Screen name="progress" options={{ title: "My Progress", tabBarLabel: "Progress", tabBarIcon: icon("stats-chart-outline") }} />
      <Tabs.Screen name="profile" options={{ title: "Profile", tabBarIcon: icon("person-circle-outline") }} />
      <Tabs.Screen name="subject/[id]" options={{ href: null, title: "Subject" }} />
      <Tabs.Screen name="document/[id]" options={{ href: null, title: "Book" }} />
      <Tabs.Screen name="module/[id]" options={{ href: null, title: "Module" }} />
      <Tabs.Screen name="quiz/[id]" options={{ href: null, title: "Quiz" }} />
      <Tabs.Screen name="attempt/[id]" options={{ href: null, title: "Quiz Result" }} />
      <Tabs.Screen name="assignment/[id]" options={{ href: null, title: "Assignment" }} />
    </Tabs>
  );
}
