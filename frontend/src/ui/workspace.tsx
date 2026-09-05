import { Ionicons } from "@expo/vector-icons";
import React from "react";
import { Platform, Pressable, ScrollView, StyleSheet, Text, View, useWindowDimensions } from "react-native";
import { colors, radius, radiusSm, space } from "./theme";

/**
 * The pieces every workspace screen is built from.
 *
 * A workspace is a fixed header, a scrolling list or tree on the left, and one
 * selected thing filling the right. The book outline, the quizzes and the
 * assignments all use it, so the parts live here rather than being written
 * three times with three sets of paddings.
 */

/** True when there is room for both panes side by side. */
export const useSplit = () => useWindowDimensions().width >= 900;

/** Makes an inner ScrollView actually scroll on the web build. */
export const scrollFix = [{ flex: 1, minHeight: 0 }, Platform.OS === "web" && ({ overflowY: "auto" } as object)];

export function WorkspaceBody({ children }: { children: React.ReactNode }) {
  return <View style={w.body}>{children}</View>;
}

/** The left column: a heading, whatever controls it needs, then a scrolling list. */
export function ListPane({ title, action, meta, filters, children, split }: {
  title: string;
  action?: React.ReactNode;
  meta?: string;
  filters?: React.ReactNode;
  children: React.ReactNode;
  split: boolean;
}) {
  return (
    <View style={[w.list, split ? w.listSplit : w.listFull]}>
      <View style={w.listHead}>
        <View style={w.headRow}>
          <Text style={w.listTitle}>{title}</Text>
          {action}
        </View>
        {meta ? <Text style={w.listMeta}>{meta}</Text> : null}
        {filters}
      </View>
      <ScrollView style={scrollFix} contentContainerStyle={{ padding: space.sm, paddingBottom: space.xl }} keyboardShouldPersistTaps="handled">
        {children}
      </ScrollView>
    </View>
  );
}

/** One row in the left column: a title and a single quiet line under it. */
export function ListItem({ title, meta, selected, warn, onPress }: {
  title: string; meta?: string; selected?: boolean; warn?: string; onPress: () => void;
}) {
  return (
    <Pressable onPress={onPress} accessibilityRole="button" style={({ pressed }) => [w.item, selected && w.itemOn, pressed && { opacity: 0.85 }]}>
      <Text style={w.itemTitle} numberOfLines={1}>{title}</Text>
      {meta || warn ? (
        <Text style={w.itemMeta} numberOfLines={1}>
          {meta}
          {warn ? <Text style={{ color: colors.warning }}>{meta ? " · " : ""}{warn}</Text> : null}
        </Text>
      ) : null}
    </Pressable>
  );
}

/** Underlined tabs, used for status filters and for the panes of a quiz. */
export function Tabs({ tabs, value, onChange, big }: {
  tabs: { key: string; label: string; count?: number | null }[];
  value: string;
  onChange: (key: string) => void;
  big?: boolean;
}) {
  return (
    <View style={[w.tabs, big && w.tabsBig]}>
      {tabs.map((t) => (
        <Pressable key={t.key} onPress={() => onChange(t.key)} accessibilityRole="button" style={({ pressed }) => [pressed && { opacity: 0.8 }]}>
          <View style={[w.tab, big && w.tabBig, value === t.key && w.tabOn]}>
            <Text style={[big ? w.tabTextBig : w.tabText, value === t.key && { color: colors.primary }]}>
              {t.label}
              {t.count !== undefined && t.count !== null ? <Text style={w.tabCount}>  {t.count}</Text> : null}
            </Text>
          </View>
        </Pressable>
      ))}
    </View>
  );
}

/** The right column. */
export function DetailPane({ children }: { children: React.ReactNode }) {
  return <View style={w.pane}>{children}</View>;
}

export function PaneScroll({ children }: { children: React.ReactNode }) {
  return (
    <ScrollView style={scrollFix} contentContainerStyle={{ padding: space.lg, paddingBottom: space.xxl, gap: space.md }} keyboardShouldPersistTaps="handled">
      {children}
    </ScrollView>
  );
}

/** A bordered table of label-and-control rows: the house style for settings. */
export function Rows({ children }: { children: React.ReactNode }) {
  return <View style={w.rows}>{children}</View>;
}

export function SettingRow({ label, children, top }: { label: string; children: React.ReactNode; top?: boolean }) {
  return (
    <View style={[w.row, top && { alignItems: "flex-start" }]}>
      <Text style={[w.rowLabel, top && { paddingTop: 9 }]}>{label}</Text>
      <View style={[w.rowValue, top && { flexDirection: "column", alignItems: "stretch" }]}>{children}</View>
    </View>
  );
}

export function SectionLabel({ children }: { children: React.ReactNode }) {
  return <Text style={w.section}>{children}</Text>;
}

export function Hint({ children }: { children: React.ReactNode }) {
  return <Text style={w.hint}>{children}</Text>;
}

/** A one-line strip above the content, for the thing that needs doing. */
export function Strip({ text, tone = "warning", action }: { text: string; tone?: "warning" | "info"; action?: React.ReactNode }) {
  return (
    <View style={[w.strip, { borderLeftColor: tone === "info" ? colors.accent : colors.warning }]}>
      <Text style={w.stripText}>{text}</Text>
      {action}
    </View>
  );
}

/** The bar pinned to the bottom of the right pane. */
export function Foot({ children }: { children: React.ReactNode }) {
  return <View style={w.foot}>{children}</View>;
}

export function FootState({ text, dirty }: { text: string; dirty?: boolean }) {
  return <Text style={[w.footState, dirty && { color: colors.warning }]}>{text}</Text>;
}

export function EmptyPane({ title, text, icon = "documents-outline" }: { title: string; text: string; icon?: keyof typeof Ionicons.glyphMap }) {
  return (
    <View style={w.empty}>
      <Ionicons name={icon} size={30} color={colors.faint} />
      <Text style={w.emptyTitle}>{title}</Text>
      <Text style={w.emptyText}>{text}</Text>
    </View>
  );
}

export const w = StyleSheet.create({
  body: { flex: 1, minHeight: 0, flexDirection: "row" },
  list: { backgroundColor: colors.sidebar, borderWidth: 1, borderColor: colors.border, borderRadius: radius },
  listSplit: { width: 330, marginLeft: space.lg, marginBottom: space.lg },
  listFull: { flex: 1, marginHorizontal: space.md, marginBottom: space.md },
  listHead: { padding: space.md, gap: space.sm, borderBottomWidth: 1, borderColor: colors.border },
  headRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: space.sm },
  listTitle: { fontSize: 15, fontWeight: "700", color: colors.text },
  listMeta: { fontSize: 12, color: colors.faint, lineHeight: 17 },
  item: { padding: 11, borderRadius: radiusSm, borderWidth: 1, borderColor: "transparent", marginBottom: 1 },
  itemOn: { backgroundColor: colors.tealTint, borderColor: `${colors.primary}33` },
  itemTitle: { fontSize: 14, color: colors.text },
  itemMeta: { fontSize: 12, color: colors.faint, marginTop: 3 },
  tabs: { flexDirection: "row", gap: space.lg, flexWrap: "wrap" },
  tabsBig: { gap: 22, borderBottomWidth: 1, borderColor: colors.border, marginTop: space.md },
  tab: { paddingBottom: 6, borderBottomWidth: 2, borderColor: "transparent" },
  tabBig: { paddingBottom: 10 },
  tabOn: { borderColor: colors.primary },
  tabText: { fontSize: 13, color: colors.faint },
  tabTextBig: { fontSize: 14, color: colors.muted, fontWeight: "600" },
  tabCount: { fontSize: 12, color: colors.faint, fontWeight: "400" },
  pane: { flex: 1, minWidth: 0, minHeight: 0 },
  rows: { borderWidth: 1, borderColor: colors.border, borderRadius: radius, overflow: "hidden" },
  row: { flexDirection: "row", alignItems: "center", gap: space.lg, paddingVertical: 11, paddingHorizontal: space.md, borderBottomWidth: 1, borderColor: colors.border },
  rowLabel: { width: 170, fontSize: 13.5, color: colors.muted },
  rowValue: { flex: 1, flexDirection: "row", alignItems: "center", gap: space.sm, flexWrap: "wrap", minWidth: 0 },
  section: { fontSize: 12.5, color: colors.muted, fontWeight: "600" },
  hint: { fontSize: 12.5, color: colors.faint, lineHeight: 18 },
  strip: { flexDirection: "row", alignItems: "center", gap: space.md, flexWrap: "wrap", padding: space.md, borderRadius: radiusSm, backgroundColor: colors.surface2, borderLeftWidth: 3 },
  stripText: { flex: 1, minWidth: 200, fontSize: 13.5, color: colors.muted },
  foot: { flexDirection: "row", alignItems: "center", gap: space.sm, flexWrap: "wrap", paddingVertical: 13, paddingHorizontal: space.lg, borderTopWidth: 1, borderColor: colors.border, backgroundColor: colors.surface },
  footState: { fontSize: 12.5, color: colors.faint },
  empty: { flex: 1, alignItems: "center", justifyContent: "center", padding: space.xxl, gap: space.sm },
  emptyTitle: { fontSize: 17, fontWeight: "700", color: colors.text },
  emptyText: { fontSize: 14, color: colors.faint, textAlign: "center", maxWidth: 340, lineHeight: 20 },
});
