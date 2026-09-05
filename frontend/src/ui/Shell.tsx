import { Ionicons } from "@expo/vector-icons";
import type {
  BottomTabBarProps,
  BottomTabHeaderProps,
  BottomTabNavigationOptions,
} from "@react-navigation/bottom-tabs";
import { useRouter } from "expo-router";
import React, { useEffect, useState } from "react";
import {
  Modal,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TouchableWithoutFeedback,
  View,
  useWindowDimensions,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useAuth } from "@/auth/AuthContext";
import { BASE_URL } from "@/api/client";
import { Gradient } from "./Gradient";
import { bp, colors, space } from "./theme";

export type IconName = keyof typeof Ionicons.glyphMap;

/* ------------------------------------------------------------------ */
/* Navigation drawer state                                             */
/* ------------------------------------------------------------------ */

/**
 * The workspace screens want the full width of the window: an outline tree
 * beside an editor, or a list beside a quiz, does not fit next to a permanent
 * 264px rail on a laptop. The rail is therefore a drawer the hamburger opens,
 * and choosing a destination closes it again.
 *
 * It is a module-level store rather than a context because the header and the
 * tab bar are rendered by React Navigation as separate trees, so there is no
 * common ancestor to hold the state.
 */
let navOpen = false;
const navListeners = new Set<() => void>();
const emitNav = () => navListeners.forEach((fn) => fn());
export const openNav = () => { navOpen = true; emitNav(); };
export const closeNav = () => { navOpen = false; emitNav(); };

export function useNavDrawer() {
  const [open, setOpen] = useState(navOpen);
  useEffect(() => {
    const listener = () => setOpen(navOpen);
    navListeners.add(listener);
    return () => { navListeners.delete(listener); };
  }, []);
  return open;
}

/**
 * Options the LocalMind shell reads but React Navigation does not declare.
 *
 * `backTo` names where the header's back arrow should land. Detail and form
 * screens live inside the tab navigator, so a plain goBack() drops the person
 * on whichever tab was visited last (usually the portal's first tab) instead
 * of the list they came from. `subtitle` overrides the line under the title.
 */
export interface ShellExtras {
  backTo?: string;
  subtitle?: string;
}

/**
 * Merges the shell-only keys into a screen's options. The navigator's options
 * type is a closed object literal, so the extras are attached here and read
 * back out of `options` in ShellHeader. Typing stays intact for every real
 * option because only the first argument drives inference.
 */
export const shellScreen = <T,>(options: T, extras: ShellExtras): T => ({ ...options, ...extras }) as T;

export type PortalMeta = {
  /** Short line under the brand mark in the sidebar, e.g. "Faculty workspace". */
  name: string;
  /** Optional cross-portal link shown at the bottom of the sidebar (admin <-> content). */
  crossLink?: { label: string; icon: IconName; onPress: () => void };
};

/* ------------------------------------------------------------------ */
/* Brand                                                               */
/* ------------------------------------------------------------------ */

export function Brand({ compact }: { compact?: boolean }) {
  return (
    <View style={s.brand}>
      <Gradient
        name="brand"
        style={[
          s.brandIcon,
          compact && { width: 32, height: 32, borderRadius: 8 },
        ]}
      >
        <Ionicons
          name="shield-checkmark"
          size={compact ? 18 : 22}
          color={colors.primaryText}
        />
      </Gradient>
      {!compact ? (
        <View>
          <Text style={s.brandName}>LocalMind</Text>
          <Text style={s.brandSub}>LOCAL · PRIVATE · AI</Text>
        </View>
      ) : null}
    </View>
  );
}

/* ------------------------------------------------------------------ */
/* Tab bar: sidebar on desktop, bottom bar on phones                   */
/* ------------------------------------------------------------------ */

function visibleRoutes({ state, descriptors }: BottomTabBarProps) {
  return state.routes.filter((r) => {
    const o = descriptors[r.key].options as BottomTabNavigationOptions & {
      href?: string | null;
    };
    if (o.href === null) return false;
    const st = o.tabBarItemStyle as { display?: string } | undefined;
    return st?.display !== "none";
  });
}

function routeTitle(o: BottomTabNavigationOptions, fallback: string) {
  if (typeof o.tabBarLabel === "string") return o.tabBarLabel;
  return o.title ?? fallback;
}

function renderIcon(
  o: BottomTabNavigationOptions,
  focused: boolean,
  color: string,
  size: number,
) {
  return o.tabBarIcon ? (
    o.tabBarIcon({ focused, color, size })
  ) : (
    <Ionicons name="ellipse-outline" size={size} color={color} />
  );
}

/**
 * Real component (hooks allowed). React Navigation invokes the `tabBar` option
 * as a plain function, so useShell() hands it `(p) => <ShellTabBar {...p} />`
 * rather than a hook-bearing function.
 */
export function ShellTabBar(props: BottomTabBarProps & { meta: PortalMeta }) {
  const { width } = useWindowDimensions();
  return width >= bp.desktop ? (
    <SidebarDrawer {...props} />
  ) : (
    <BottomBar {...props} />
  );
}

/**
 * The rail, shown over the page when the hamburger is pressed. It occupies no
 * layout space when closed, so the workspace runs edge to edge.
 */
function SidebarDrawer(props: BottomTabBarProps & { meta: PortalMeta }) {
  const open = useNavDrawer();
  if (!open) return <View style={{ width: 0 }} />;
  return (
    <Modal transparent animationType="fade" visible onRequestClose={closeNav}>
      <TouchableWithoutFeedback onPress={closeNav}>
        <View style={s.drawerScrim} />
      </TouchableWithoutFeedback>
      <View style={s.drawerPanel}>
        <Sidebar {...props} onNavigate={closeNav} />
      </View>
    </Modal>
  );
}

function Sidebar({
  state,
  descriptors,
  navigation,
  meta,
  onNavigate,
}: BottomTabBarProps & { meta: PortalMeta; onNavigate?: () => void }) {
  const routes = visibleRoutes({
    state,
    descriptors,
    navigation,
  } as BottomTabBarProps);
  const insets = useSafeAreaInsets();
  return (
    <Gradient
      name="sidebar"
      direction="vertical"
      style={[s.sidebar, { paddingTop: Math.max(insets.top, 0) + 26 }]}
    >
      <Brand />
      <Text style={s.portalName}>{meta.name}</Text>
      <View style={s.nav}>
        {routes.map((route) => {
          const o = descriptors[route.key].options;
          const focused = state.routes[state.index].key === route.key;
          const onPress = () => {
            const e = navigation.emit({
              type: "tabPress",
              target: route.key,
              canPreventDefault: true,
            });
            if (!focused && !e.defaultPrevented)
              navigation.navigate(route.name, route.params);
            onNavigate?.();
          };
          return (
            <Pressable
              key={route.key}
              onPress={onPress}
              accessibilityRole="button"
              accessibilityState={{ selected: focused }}
              style={({ pressed }) => [
                s.navItem,
                focused && s.navItemOn,
                pressed && { opacity: 0.8 },
              ]}
            >
              {renderIcon(
                o,
                focused,
                focused ? colors.primaryText : "#C2CDD4",
                19,
              )}
              <Text style={[s.navText, focused && s.navTextOn]}>
                {routeTitle(o, route.name)}
              </Text>
            </Pressable>
          );
        })}
      </View>
      <View style={{ flex: 1 }} />
      {meta.crossLink ? (
        <Pressable
          onPress={() => { meta.crossLink!.onPress(); onNavigate?.(); }}
          style={({ pressed }) => [s.crossLink, pressed && { opacity: 0.8 }]}
        >
          <Ionicons
            name={meta.crossLink.icon}
            size={16}
            color={colors.primary}
          />
          <Text style={s.crossLinkText}>{meta.crossLink.label}</Text>
          <Ionicons name="arrow-forward" size={14} color={colors.muted} />
        </Pressable>
      ) : null}
      <View style={s.statusCard}>
        <View style={s.statusRow}>
          <View style={s.statusDot} />
          <Text style={s.statusTitle}>Local AI tutor</Text>
        </View>
        <Text style={s.statusSub} numberOfLines={1}>
          {BASE_URL.replace(/^https?:\/\//, "")}
        </Text>
      </View>
    </Gradient>
  );
}

function BottomBar({ state, descriptors, navigation }: BottomTabBarProps) {
  const routes = visibleRoutes({
    state,
    descriptors,
    navigation,
  } as BottomTabBarProps);
  const insets = useSafeAreaInsets();
  return (
    <View style={[s.bottomBar, { paddingBottom: Math.max(insets.bottom, 8) }]}>
      {routes.map((route) => {
        const o = descriptors[route.key].options;
        const focused = state.routes[state.index].key === route.key;
        const onPress = () => {
          const e = navigation.emit({
            type: "tabPress",
            target: route.key,
            canPreventDefault: true,
          });
          if (!focused && !e.defaultPrevented)
            navigation.navigate(route.name, route.params);
        };
        return (
          <Pressable
            key={route.key}
            onPress={onPress}
            accessibilityRole="button"
            accessibilityState={{ selected: focused }}
            style={s.bottomItem}
          >
            <View style={[s.bottomIcon, focused && s.bottomIconOn]}>
              {renderIcon(
                o,
                focused,
                focused ? colors.primary : colors.muted,
                21,
              )}
            </View>
            <Text
              style={[
                s.bottomText,
                focused && { color: colors.primary, fontWeight: "700" },
              ]}
              numberOfLines={1}
            >
              {routeTitle(o, route.name)}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

/* ------------------------------------------------------------------ */
/* Header                                                              */
/* ------------------------------------------------------------------ */

const ICONS: Record<string, IconName> = {
  index: "grid-outline",
  subjects: "library-outline",
  books: "book-outline",
  quizzes: "help-circle-outline",
  assignments: "create-outline",
  progress: "stats-chart-outline",
  profile: "person-circle-outline",
  users: "people-outline",
  audit: "receipt-outline",
  "subject/[id]": "library-outline",
  "document/[id]": "book-outline",
  "document/upload": "cloud-upload-outline",
  "module/[id]": "layers-outline",
  "quiz/[id]": "help-circle-outline",
  "quiz/new": "add-circle-outline",
  "attempt/[id]": "ribbon-outline",
  "assignment/[id]": "create-outline",
  "assignment/new": "add-circle-outline",
  "user/[id]": "person-outline",
  "user/new": "person-add-outline",
  "user/import": "cloud-upload-outline",
};

/** Same rule as ShellTabBar: a real component, rendered as an element from the `header` option. */
export function ShellHeader({
  route,
  options,
  navigation,
  meta,
}: BottomTabHeaderProps & { meta: PortalMeta }) {
  const { width } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const desktop = width >= bp.desktop;
  // A screen can name where its back arrow leads. Detail and form screens live
  // inside the tab navigator, so a plain goBack() lands on whichever tab was
  // visited last (usually the portal's first tab) rather than the list the
  // person actually came from. `backTo` pins that destination.
  const backTo = (options as { backTo?: string }).backTo;
  const canBack = !!backTo || navigation.canGoBack();
  const goBack = () => {
    if (backTo) router.replace(backTo as never);
    else navigation.goBack();
  };
  const icon = ICONS[route.name] ?? "ellipse-outline";
  const subtitle = (options as { subtitle?: string }).subtitle ?? meta.name;
  return (
    <View
      style={[
        s.topBar,
        {
          paddingTop: insets.top,
          height: 76 + insets.top,
          paddingHorizontal: desktop ? 34 : 16,
        },
      ]}
    >
      <View style={s.topLeft}>
        {desktop ? (
          <Pressable
            onPress={openNav}
            accessibilityRole="button"
            accessibilityLabel="Open navigation"
            hitSlop={8}
            style={({ pressed }) => [s.backBtn, pressed && { opacity: 0.65 }]}
          >
            <Ionicons name="menu" size={22} color={colors.muted} />
          </Pressable>
        ) : null}
        {canBack ? (
          <Pressable
            onPress={goBack}
            accessibilityRole="button"
            accessibilityLabel="Go back"
            hitSlop={8}
            style={({ pressed }) => [s.backBtn, pressed && { opacity: 0.65 }]}
          >
            <Ionicons name="arrow-back" size={22} color={colors.muted} />
          </Pressable>
        ) : !desktop ? (
          <Brand compact />
        ) : null}
        <Ionicons name={icon} size={desktop ? 26 : 22} color={colors.primary} />
        <View style={{ flex: 1, minWidth: 0 }}>
          <Text
            style={[s.topTitle, !desktop && { fontSize: 18 }]}
            numberOfLines={1}
          >
            {options.title ?? route.name}
          </Text>
          {desktop ? (
            <Text style={s.topSub} numberOfLines={1}>
              {subtitle}
            </Text>
          ) : null}
        </View>
      </View>
      <UserMenu compact={!desktop} />
    </View>
  );
}

/* ------------------------------------------------------------------ */
/* User pill + dropdown                                                */
/* ------------------------------------------------------------------ */

export function UserMenu({ compact }: { compact?: boolean }) {
  const { user, logout } = useAuth();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  if (!user) return null;
  const initials =
    user.full_name
      .split(" ")
      .filter(Boolean)
      .slice(0, 2)
      .map((w) => w[0]?.toUpperCase())
      .join("") || "U";
  const role = user.role.charAt(0).toUpperCase() + user.role.slice(1);
  const close = () => setOpen(false);
  const go = (path: string) => {
    close();
    router.push(path as never);
  };
  return (
    <>
      <Pressable
        onPress={() => setOpen(true)}
        style={({ pressed }) => [
          s.userPill,
          compact && s.userPillCompact,
          pressed && { opacity: 0.8 },
        ]}
      >
        <View style={s.avatar}>
          <Text style={s.avatarText}>{initials}</Text>
          <View style={s.online} />
        </View>
        {!compact ? (
          <View style={{ maxWidth: 160 }}>
            <Text style={s.userName} numberOfLines={1}>
              {user.full_name}
            </Text>
            <Text style={s.userRole}>{role}</Text>
          </View>
        ) : null}
        {!compact ? (
          <Ionicons
            name={open ? "chevron-up" : "chevron-down"}
            size={14}
            color={colors.muted}
          />
        ) : null}
      </Pressable>
      <Modal
        visible={open}
        transparent
        animationType="fade"
        onRequestClose={close}
      >
        <TouchableWithoutFeedback onPress={close}>
          <View style={s.overlay}>
            <TouchableWithoutFeedback>
              <View style={s.dropdown}>
                <View style={s.dropHeader}>
                  <View
                    style={[
                      s.avatar,
                      { width: 40, height: 40, borderRadius: 20 },
                    ]}
                  >
                    <Text style={[s.avatarText, { fontSize: 15 }]}>
                      {initials}
                    </Text>
                  </View>
                  <View style={{ flex: 1, minWidth: 0 }}>
                    <Text style={s.userName} numberOfLines={1}>
                      {user.full_name}
                    </Text>
                    <Text style={s.userRole} numberOfLines={1}>
                      {user.email}
                    </Text>
                  </View>
                </View>
                <MenuItem
                  icon="person-outline"
                  label="Profile"
                  onPress={() => go("profile")}
                />
                <MenuItem
                  icon="key-outline"
                  label="Change Password"
                  onPress={() => go("/change-password")}
                />
                <View
                  style={{
                    height: 1,
                    backgroundColor: colors.border,
                    marginVertical: 6,
                  }}
                />
                <MenuItem
                  icon="log-out-outline"
                  label="Sign Out"
                  danger
                  onPress={() => {
                    close();
                    void logout();
                  }}
                />
              </View>
            </TouchableWithoutFeedback>
          </View>
        </TouchableWithoutFeedback>
      </Modal>
    </>
  );
}

function MenuItem({
  icon,
  label,
  onPress,
  danger,
}: {
  icon: IconName;
  label: string;
  onPress: () => void;
  danger?: boolean;
}) {
  const c = danger ? colors.danger : colors.text;
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [
        s.menuItem,
        pressed && { backgroundColor: colors.surface2 },
      ]}
    >
      <Ionicons name={icon} size={18} color={c} />
      <Text style={{ color: c, fontSize: 14, fontWeight: "600" }}>{label}</Text>
    </Pressable>
  );
}

/* ------------------------------------------------------------------ */
/* Tabs screenOptions helper                                           */
/* ------------------------------------------------------------------ */

/** Returns screenOptions + tabBar for an expo-router <Tabs> so the three portals share one shell. */
export function useShell(meta: PortalMeta) {
  const { width } = useWindowDimensions();
  const desktop = width >= bp.desktop;
  const screenOptions: BottomTabNavigationOptions = {
    header: (p: BottomTabHeaderProps) => <ShellHeader {...p} meta={meta} />,
    tabBarPosition: desktop ? "left" : "bottom",
    sceneStyle: { backgroundColor: colors.bg },
    tabBarActiveTintColor: colors.primary,
    tabBarInactiveTintColor: colors.muted,
    tabBarHideOnKeyboard: Platform.OS === "android",
  };
  const tabBar = (p: BottomTabBarProps) => <ShellTabBar {...p} meta={meta} />;
  return { screenOptions, tabBar };
}

const s = StyleSheet.create({
  brand: { flexDirection: "row", alignItems: "center", gap: 12 },
  brandIcon: {
    width: 40,
    height: 40,
    borderRadius: 10,
    alignItems: "center",
    justifyContent: "center",
  },
  brandName: {
    color: colors.text,
    fontSize: 20,
    fontWeight: "800",
    letterSpacing: -0.2,
  },
  brandSub: {
    color: colors.muted,
    fontSize: 8.5,
    fontWeight: "700",
    letterSpacing: 1.2,
    marginTop: 2,
  },

  drawerScrim: { ...StyleSheet.absoluteFillObject, backgroundColor: "#00000088" },
  drawerPanel: {
    position: "absolute",
    left: 0,
    top: 0,
    bottom: 0,
    width: 264,
  },
  sidebar: {
    width: 264,
    flex: 1,
    borderRightWidth: 1,
    borderRightColor: colors.border,
    paddingHorizontal: 18,
    paddingBottom: 22,
  },
  portalName: {
    color: colors.faint,
    fontSize: 11,
    fontWeight: "700",
    letterSpacing: 0.8,
    textTransform: "uppercase",
    marginTop: 26,
    marginBottom: 10,
    paddingHorizontal: 4,
  },
  nav: { gap: 6 },
  navItem: {
    height: 46,
    borderRadius: 9,
    paddingHorizontal: 14,
    flexDirection: "row",
    alignItems: "center",
    gap: 14,
  },
  navItemOn: { backgroundColor: colors.primary },
  navText: { color: "#C2CDD4", fontSize: 14, fontWeight: "600" },
  navTextOn: { color: colors.primaryText, fontWeight: "800" },
  crossLink: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    paddingHorizontal: 14,
    height: 42,
    borderRadius: 9,
    borderWidth: 1,
    borderColor: colors.border,
    marginBottom: 12,
  },
  crossLinkText: {
    color: colors.text,
    fontSize: 13,
    fontWeight: "600",
    flex: 1,
  },
  statusCard: {
    backgroundColor: "#102033",
    borderWidth: 1,
    borderColor: "#223B4C",
    borderRadius: 12,
    padding: 14,
    gap: 6,
  },
  statusRow: { flexDirection: "row", alignItems: "center", gap: 8 },
  statusDot: {
    width: 7,
    height: 7,
    borderRadius: 4,
    backgroundColor: colors.primary,
  },
  statusTitle: { color: colors.text, fontSize: 12, fontWeight: "700" },
  statusSub: { color: colors.muted, fontSize: 10 },

  bottomBar: {
    flexDirection: "row",
    backgroundColor: colors.sidebar,
    borderTopWidth: 1,
    borderTopColor: colors.border,
    paddingTop: 6,
    paddingHorizontal: 4,
  },
  bottomItem: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    gap: 2,
    paddingVertical: 2,
  },
  bottomIcon: {
    width: 48,
    height: 30,
    borderRadius: 15,
    alignItems: "center",
    justifyContent: "center",
  },
  bottomIconOn: { backgroundColor: colors.tealTint },
  bottomText: { color: colors.muted, fontSize: 10.5, fontWeight: "600" },

  topBar: {
    backgroundColor: colors.bg,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: space.md,
  },
  topLeft: {
    flexDirection: "row",
    alignItems: "center",
    gap: 14,
    flex: 1,
    minWidth: 0,
  },
  backBtn: {
    width: 38,
    height: 38,
    borderRadius: 19,
    alignItems: "center",
    justifyContent: "center",
    marginLeft: -8,
  },
  topTitle: {
    color: colors.text,
    fontSize: 22,
    fontWeight: "800",
    letterSpacing: -0.3,
  },
  topSub: { color: colors.muted, fontSize: 12, marginTop: 3 },

  userPill: {
    height: 44,
    borderWidth: 1,
    borderColor: colors.borderStrong,
    borderRadius: 22,
    paddingHorizontal: 8,
    paddingRight: 12,
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    backgroundColor: colors.surface,
  },
  userPillCompact: { paddingRight: 8 },
  avatar: {
    width: 30,
    height: 30,
    borderRadius: 15,
    backgroundColor: "#D9F4ED",
    alignItems: "center",
    justifyContent: "center",
  },
  avatarText: { color: "#087B69", fontSize: 12, fontWeight: "800" },
  online: {
    position: "absolute",
    right: -1,
    bottom: -1,
    width: 9,
    height: 9,
    borderRadius: 5,
    backgroundColor: colors.primary,
    borderWidth: 2,
    borderColor: colors.surface,
  },
  userName: { color: colors.text, fontSize: 13, fontWeight: "700" },
  userRole: { color: colors.muted, fontSize: 11, marginTop: 1 },
  overlay: {
    flex: 1,
    backgroundColor: "rgba(3,8,11,0.55)",
    alignItems: "flex-end",
    paddingTop: 70,
    paddingHorizontal: 16,
  },
  dropdown: {
    width: 280,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.borderStrong,
    borderRadius: 14,
    padding: 8,
    gap: 2,
    shadowColor: "#000",
    shadowOpacity: 0.4,
    shadowRadius: 20,
    shadowOffset: { width: 0, height: 10 },
    elevation: 12,
  },
  dropHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    padding: 10,
    paddingBottom: 12,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
    marginBottom: 4,
  },
  menuItem: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    paddingHorizontal: 12,
    paddingVertical: 11,
    borderRadius: 9,
  },
});
