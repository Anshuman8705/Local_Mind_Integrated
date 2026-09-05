import { useLocalSearchParams } from "expo-router";
import React from "react";
import AssignmentWorkspace from "@/screens/AssignmentWorkspace";

/** A direct link to one assignment opens the workspace with it selected. */
export default function AssignmentScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  return <AssignmentWorkspace initialId={id} />;
}
