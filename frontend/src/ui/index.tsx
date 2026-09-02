import { Ionicons } from "@expo/vector-icons";
import React from "react";
import { ActivityIndicator, Pressable, RefreshControl, ScrollView, StyleProp, StyleSheet, Text, TextInput, TextInputProps, View, ViewStyle, useWindowDimensions } from "react-native";
import { Gradient } from "./Gradient";
import { bp, colors, font, gradients, radius, radiusSm, space, statusColor } from "./theme";

export { Gradient };
export { colors, gradients, space, radius, radiusSm, bp, font };

type IconName = keyof typeof Ionicons.glyphMap;

/* ------------------------------------------------------------------ */
/* Layout                                                              */
/* ------------------------------------------------------------------ */

/**
 * Page container. Content is capped at a readable width and centred, with
 * gutters that scale with the viewport (34px desktop, 18px phone) so cards
 * line up with the header title above them.
 */
export function Screen({ children, scroll = true, refreshing, onRefresh, padded = true, wide }: { children: React.ReactNode; scroll?: boolean; refreshing?: boolean; onRefresh?: () => void; padded?: boolean; wide?: boolean }) {
  const { width } = useWindowDimensions();
  const gutter = width >= bp.desktop ? 34 : width >= bp.tablet ? 24 : 18;
  const inner = (
    <View style={[padded && { paddingHorizontal: gutter, paddingTop: space.xl, gap: space.md }, { maxWidth: wide ? 1400 : 1100, width: "100%", alignSelf: "center" }]}>
      {children}
    </View>
  );
  if (!scroll) return <View style={{ flex: 1, backgroundColor: colors.bg }}>{inner}</View>;
  return (
    <ScrollView style={{ flex: 1, backgroundColor: colors.bg }} contentContainerStyle={{ paddingBottom: 48 }} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}
      refreshControl={onRefresh ? <RefreshControl refreshing={!!refreshing} onRefresh={onRefresh} tintColor={colors.primary} colors={[colors.primary]} /> : undefined}>
      {inner}
    </ScrollView>
  );
}

export function Card({ children, style, onPress, accent }: { children: React.ReactNode; style?: StyleProp<ViewStyle>; onPress?: () => void; accent?: string }) {
  const body = (
    <View style={[s.card, accent ? { borderLeftWidth: 3, borderLeftColor: accent } : null, style]}>
      {children}
    </View>
  );
  return onPress ? <Pressable onPress={onPress} style={({ pressed }) => [pressed && { opacity: 0.85, transform: [{ scale: 0.995 }] }]}>{body}</Pressable> : body;
}

/** Two-column grid that collapses on phones; children get equal flex. */
export function Grid({ children, min = 300, gap = space.lg }: { children: React.ReactNode; min?: number; gap?: number }) {
  return <View style={{ flexDirection: "row", flexWrap: "wrap", gap }}>{React.Children.map(children, (c) => (c ? <View style={{ flex: 1, minWidth: min }}>{c}</View> : null))}</View>;
}

export function Row({ children, style }: { children: React.ReactNode; style?: ViewStyle }) {
  return <View style={[{ flexDirection: "row", alignItems: "center", gap: space.sm, flexWrap: "wrap" }, style]}>{children}</View>;
}

export function Divider() { return <View style={{ height: 1, backgroundColor: colors.border, marginVertical: space.xs }} />; }

/* ------------------------------------------------------------------ */
/* Typography                                                          */
/* ------------------------------------------------------------------ */

export function H1({ children }: { children: React.ReactNode }) { return <Text style={s.h1}>{children}</Text>; }
export function H2({ children, icon }: { children: React.ReactNode; icon?: IconName }) {
  return (
    <View style={s.h2Row}>
      {icon ? <Ionicons name={icon} size={18} color={colors.primary} /> : null}
      <Text style={s.h2}>{children}</Text>
    </View>
  );
}
export function P({ children, muted, small, style }: { children: React.ReactNode; muted?: boolean; small?: boolean; style?: object }) {
  return <Text style={[s.p, muted && { color: colors.muted }, small && font.small, style]}>{children}</Text>;
}
export function Label({ children }: { children: React.ReactNode }) { return <Text style={s.label}>{children}</Text>; }

/**
 * In-page hero used at the top of detail screens: icon chip, title, subtitle,
 * optional right-hand actions. Mirrors the reference "topbar" title block.
 */
export function PageHeading({ title, subtitle, icon, right }: { title: string; subtitle?: string; icon?: IconName; right?: React.ReactNode }) {
  return (
    <View style={s.heading}>
      <View style={s.headingLeft}>
        {icon ? <View style={s.headingIcon}><Ionicons name={icon} size={22} color={colors.primary} /></View> : null}
        <View style={{ flex: 1, minWidth: 0 }}>
          <Text style={s.h1} numberOfLines={2}>{title}</Text>
          {subtitle ? <Text style={s.headingSub}>{subtitle}</Text> : null}
        </View>
      </View>
      {right ? <View style={s.headingRight}>{right}</View> : null}
    </View>
  );
}

/* ------------------------------------------------------------------ */
/* Controls                                                            */
/* ------------------------------------------------------------------ */

export function Button({ title, onPress, variant = "primary", disabled, busy, small, icon }: { title: string; onPress: () => void; variant?: "primary" | "secondary" | "danger" | "ghost"; disabled?: boolean; busy?: boolean; small?: boolean; icon?: IconName }) {
  const off = disabled || busy;
  const fg = variant === "primary" ? colors.primaryText : variant === "danger" ? "#FFFFFF" : variant === "secondary" ? colors.text : colors.primary;
  const content = (
    <View style={[s.btnInner, small && s.btnInnerSmall]}>
      {busy ? <ActivityIndicator color={fg} /> : (
        <>
          {icon ? <Ionicons name={icon} size={small ? 14 : 17} color={fg} /> : null}
          <Text style={{ color: fg, fontWeight: "700", fontSize: small ? 13 : 15 }}>{title}</Text>
        </>
      )}
    </View>
  );
  return (
    <Pressable onPress={onPress} disabled={off} style={({ pressed }) => [s.btn, off && { opacity: 0.45 }, pressed && { opacity: 0.85 }]}>
      {variant === "primary" ? (
        <Gradient name="brand" direction="horizontal" style={s.btnFill}>{content}</Gradient>
      ) : (
        <View style={[s.btnFill, variant === "danger" && { backgroundColor: colors.danger }, variant === "secondary" && { backgroundColor: colors.surface2, borderWidth: 1, borderColor: colors.borderStrong }, variant === "ghost" && { backgroundColor: "transparent" }]}>{content}</View>
      )}
    </Pressable>
  );
}

export function Input(props: TextInputProps & { label?: string; error?: string | null }) {
  const { label, error, style, ...rest } = props;
  return (
    <View style={{ gap: 6 }}>
      {label ? <Label>{label}</Label> : null}
      <TextInput placeholderTextColor={colors.faint} selectionColor={colors.primary} {...rest} style={[s.input, rest.multiline && { minHeight: 110, textAlignVertical: "top" }, error && { borderColor: colors.danger }, style]} />
      {error ? <Text style={{ color: colors.danger, fontSize: 12 }}>{error}</Text> : null}
    </View>
  );
}

export function Badge({ value, color }: { value: string; color?: string }) {
  const c = color ?? statusColor[value] ?? colors.muted;
  return <View style={[s.badge, { borderColor: `${c}66`, backgroundColor: `${c}1A` }]}><Text style={{ color: c, fontSize: 11, fontWeight: "700", letterSpacing: 0.3 }}>{value.replace(/_/g, " ")}</Text></View>;
}

export function Chip({ label, selected, onPress }: { label: string; selected?: boolean; onPress?: () => void }) {
  return (
    <Pressable onPress={onPress} style={({ pressed }) => [s.chip, selected && s.chipOn, pressed && { opacity: 0.8 }]}>
      <Text style={{ color: selected ? colors.primaryText : colors.text, fontSize: 13, fontWeight: selected ? "700" : "500" }}>{label}</Text>
    </Pressable>
  );
}

/* ------------------------------------------------------------------ */
/* Feedback                                                            */
/* ------------------------------------------------------------------ */

export function ErrorBanner({ message, onRetry }: { message?: string | null; onRetry?: () => void }) {
  if (!message) return null;
  return (
    <View style={s.error}>
      <Ionicons name="alert-circle-outline" size={18} color={colors.danger} />
      <Text style={{ color: colors.text, flex: 1, fontSize: 14 }}>{message}</Text>
      {onRetry ? <Button title="Retry" variant="ghost" small onPress={onRetry} /> : null}
    </View>
  );
}
export function Notice({ message, tone = "info" }: { message: string; tone?: "info" | "warning" | "success" }) {
  const c = tone === "warning" ? colors.warning : tone === "success" ? colors.success : colors.accent;
  const icon: IconName = tone === "warning" ? "warning-outline" : tone === "success" ? "checkmark-circle-outline" : "information-circle-outline";
  return (
    <View style={[s.notice, { borderLeftColor: c }]}>
      <Ionicons name={icon} size={18} color={c} />
      <Text style={{ color: colors.text, flex: 1, fontSize: 14, lineHeight: 20 }}>{message}</Text>
    </View>
  );
}

export function Loading() { return <View style={{ padding: space.xxl, alignItems: "center" }}><ActivityIndicator color={colors.primary} size="large" /></View>; }
export function Empty({ text, icon = "file-tray-outline" }: { text: string; icon?: IconName }) {
  return (
    <View style={s.empty}>
      <Ionicons name={icon} size={30} color={colors.faint} />
      <Text style={{ color: colors.muted, textAlign: "center", fontSize: 14 }}>{text}</Text>
    </View>
  );
}

/* ------------------------------------------------------------------ */
/* Data display                                                        */
/* ------------------------------------------------------------------ */

const STAT_ROTATION = [colors.primary, colors.accent, colors.purple, colors.warning];
const STAT_ICONS: IconName[] = ["stats-chart-outline", "layers-outline", "checkmark-circle-outline", "time-outline"];

/**
 * Stat tile. Backwards compatible with `{label, value}`; `icon`, `color` and
 * `helper` are optional. When no colour is given one is picked from a rotation
 * keyed on the label so a row of tiles gets distinct tints.
 */
export function Stat({ label, value, icon, color, helper }: { label: string; value: string | number | null | undefined; icon?: IconName; color?: string; helper?: string }) {
  const seed = [...label].reduce((t, ch) => t + ch.charCodeAt(0), 0);
  const tint = color ?? STAT_ROTATION[seed % STAT_ROTATION.length];
  const ic = icon ?? STAT_ICONS[seed % STAT_ICONS.length];
  return (
    <Gradient name="card" direction="vertical" style={s.stat}>
      <View style={[s.statIcon, { backgroundColor: `${tint}22` }]}><Ionicons name={ic} size={20} color={tint} /></View>
      <View style={{ flex: 1, minWidth: 0 }}>
        <Text style={s.statLabel} numberOfLines={1}>{label}</Text>
        <Text style={s.statValue} numberOfLines={1}>{value ?? "—"}</Text>
        {helper ? <Text style={s.statHelper} numberOfLines={1}>{helper}</Text> : null}
      </View>
    </Gradient>
  );
}

export function ProgressBar({ value, height = 8 }: { value: number | null | undefined; height?: number }) {
  const v = Math.max(0, Math.min(100, Math.round(value ?? 0)));
  return (
    <View style={[s.track, { height, borderRadius: height / 2 }]}>
      <Gradient name="progress" direction="horizontal" style={{ width: `${v}%`, height: "100%", borderRadius: height / 2 }} />
    </View>
  );
}

export function ListRow({ title, subtitle, right, onPress, badge, icon }: { title: string; subtitle?: string; right?: React.ReactNode; onPress?: () => void; badge?: string; icon?: IconName }) {
  return (
    <Card onPress={onPress} style={s.listRow}>
      {icon ? <View style={s.listIcon}><Ionicons name={icon} size={18} color={colors.primary} /></View> : null}
      <View style={{ flex: 1, minWidth: 0, gap: 3 }}>
        <Text style={s.listTitle} numberOfLines={2}>{title}</Text>
        {subtitle ? <Text style={s.listSub} numberOfLines={2}>{subtitle}</Text> : null}
      </View>
      {badge ? <Badge value={badge} /> : null}
      {right}
      {onPress && !right ? <Ionicons name="chevron-forward" size={18} color={colors.faint} /> : null}
    </Card>
  );
}

/* ------------------------------------------------------------------ */
/* Helpers                                                             */
/* ------------------------------------------------------------------ */

export const fmtSeconds = (sec: number | null | undefined) => { const s = Math.max(0, Math.round(sec ?? 0)); const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60); return h ? `${h}h ${m}m` : m ? `${m}m ${s % 60}s` : `${s}s`; };
export const fmtDate = (iso?: string | null) => (iso ? new Date(iso).toLocaleString() : "—");
export const pct = (v: number | null | undefined) => (v === null || v === undefined ? "—" : `${Math.round(v)}%`);

const s = StyleSheet.create({
  card: { backgroundColor: colors.surface, borderRadius: radius, borderWidth: 1, borderColor: colors.border, padding: space.lg, gap: space.sm },
  h1: { ...font.h1, color: colors.text },
  h2: { ...font.h2, color: colors.text },
  h2Row: { flexDirection: "row", alignItems: "center", gap: space.sm, marginTop: space.md, marginBottom: space.xs },
  p: { ...font.body, color: colors.text },
  label: { ...font.label, color: colors.muted },
  heading: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: space.md, marginBottom: space.xs },
  headingLeft: { flexDirection: "row", alignItems: "center", gap: space.md, flex: 1, minWidth: 240 },
  headingIcon: { width: 44, height: 44, borderRadius: 12, backgroundColor: colors.tealTint, alignItems: "center", justifyContent: "center" },
  headingSub: { color: colors.muted, fontSize: 13, marginTop: 3 },
  headingRight: { flexDirection: "row", alignItems: "center", gap: space.sm },
  btn: { borderRadius: radiusSm, overflow: "hidden", alignSelf: "stretch" },
  btnFill: { borderRadius: radiusSm, alignItems: "center", justifyContent: "center" },
  btnInner: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, paddingVertical: 12, paddingHorizontal: 18, minHeight: 46 },
  btnInnerSmall: { paddingVertical: 7, paddingHorizontal: 12, minHeight: 34 },
  input: { borderWidth: 1, borderColor: colors.borderStrong, borderRadius: radiusSm, paddingHorizontal: 14, paddingVertical: 12, fontSize: 15, backgroundColor: colors.bg, color: colors.text },
  badge: { borderWidth: 1, borderRadius: 999, paddingHorizontal: 10, paddingVertical: 4 },
  chip: { borderWidth: 1, borderColor: colors.borderStrong, backgroundColor: colors.chipBg, borderRadius: 999, paddingHorizontal: 13, paddingVertical: 7 },
  chipOn: { backgroundColor: colors.primary, borderColor: colors.primary },
  error: { backgroundColor: colors.dangerTint, borderWidth: 1, borderColor: `${colors.danger}55`, borderRadius: radiusSm, padding: space.md, flexDirection: "row", alignItems: "center", gap: space.sm },
  notice: { backgroundColor: colors.surface2, borderLeftWidth: 3, borderRadius: radiusSm, padding: space.md, flexDirection: "row", alignItems: "flex-start", gap: space.sm },
  empty: { padding: space.xxl, alignItems: "center", gap: space.sm, borderWidth: 1, borderStyle: "dashed", borderColor: colors.border, borderRadius: radius },
  stat: { flex: 1, minWidth: 150, borderRadius: radius, borderWidth: 1, borderColor: colors.border, padding: space.md, flexDirection: "row", alignItems: "center", gap: space.md, overflow: "hidden" },
  statIcon: { width: 42, height: 42, borderRadius: 21, alignItems: "center", justifyContent: "center" },
  statLabel: { fontSize: 12, color: colors.muted, fontWeight: "600", textTransform: "capitalize" },
  statValue: { fontSize: 22, fontWeight: "800", color: colors.text, marginTop: 2 },
  statHelper: { fontSize: 11, color: colors.faint, marginTop: 1 },
  track: { backgroundColor: colors.border, overflow: "hidden", width: "100%" },
  listRow: { flexDirection: "row", alignItems: "center", gap: space.md },
  listIcon: { width: 38, height: 38, borderRadius: 10, backgroundColor: colors.tealTint, alignItems: "center", justifyContent: "center" },
  listTitle: { fontSize: 15, fontWeight: "700", color: colors.text },
  listSub: { color: colors.muted, fontSize: 13, lineHeight: 18 },
});
