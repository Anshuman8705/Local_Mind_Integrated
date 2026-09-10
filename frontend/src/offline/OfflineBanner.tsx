import { Ionicons } from "@expo/vector-icons";
import React from "react";
import { Text, View } from "react-native";
import { colors, space } from "@/ui";
import { useOnline } from "./connectivity";
import { useSyncState } from "./sync";

function when(iso: string | null) {
  if (!iso) return null;
  const d = new Date(iso);
  const today = new Date().toDateString() === d.toDateString();
  return today ? d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) : d.toLocaleString([], { dateStyle: "medium", timeStyle: "short" });
}

/** A strip above the student screens: offline status, or the first download. */
export function OfflineBanner() {
  const online = useOnline();
  const sync = useSyncState();
  const synced = when(sync.lastSync);
  if (online && !(sync.running && !sync.lastSync)) return null;
  const text = !online
    ? `Offline. Showing the lessons and modules saved on this device${synced ? ` (updated ${synced})` : ""}. Asking the tutor, quizzes and assignments need a connection; everything refreshes by itself when you are back online.`
    : "Saving your open modules and lessons on this device so you can study offline…";
  return (
    <View style={{ flexDirection: "row", alignItems: "center", gap: space.sm, paddingHorizontal: space.md, paddingVertical: 8,
      backgroundColor: online ? colors.surface : colors.yellowTint, borderBottomWidth: 1, borderBottomColor: online ? colors.border : `${colors.warning}66` }}>
      <Ionicons name={online ? "cloud-download-outline" : "cloud-offline-outline"} size={16} color={online ? colors.primary : colors.warning} />
      <Text style={{ flex: 1, color: colors.text, fontSize: 13 }}>{text}</Text>
    </View>
  );
}
