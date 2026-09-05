import { useLocalSearchParams } from "expo-router";
import React from "react";
import QuizWorkspace from "@/screens/QuizWorkspace";

/** A direct link to one quiz opens the workspace with it selected. */
export default function QuizScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  return <QuizWorkspace initialId={id} />;
}
