import { useLocalSearchParams } from "expo-router";
import React from "react";
import QuizWorkspace from "@/screens/QuizWorkspace";

/** The quizzes tab: the list and the open quiz share one screen. */
export default function Quizzes() {
  const { quiz } = useLocalSearchParams<{ quiz?: string }>();
  return <QuizWorkspace initialId={quiz} />;
}
