import { useLocalSearchParams } from "expo-router";
import React from "react";
import AssignmentWorkspace from "@/screens/AssignmentWorkspace";

/** The assignments tab: the list and the open assignment share one screen. */
export default function Assignments() {
  const { assignment } = useLocalSearchParams<{ assignment?: string }>();
  return <AssignmentWorkspace initialId={assignment} />;
}
