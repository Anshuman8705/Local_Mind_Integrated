/**
 * LocalMind design tokens.
 *
 * Palette mirrors the reference LocalMind client: a deep navy canvas, slightly
 * lifted navy cards, a teal accent for anything primary or "active", and cool
 * blue / violet / amber for secondary emphasis. Every screen imports colors from
 * here, so changing the brand is a one-file edit.
 */
export const colors = {
  // canvas + surfaces
  bg: "#080F13",
  sidebar: "#071522",
  surface: "#0F1B24",
  surface2: "#132330",
  border: "#1C3441",
  borderStrong: "#2B4251",

  // type
  text: "#F4F7F8",
  muted: "#8FA3AE",
  faint: "#5E7480",

  // brand + semantic
  primary: "#25D0AA",
  primaryDark: "#14A98A",
  primaryText: "#06231D",
  accent: "#4DA3FF",
  purple: "#9A6BFF",
  danger: "#FF6B6B",
  success: "#25D0AA",
  warning: "#F3B51B",

  // tinted fills
  chipBg: "#132330",
  lockedBg: "#0C161D",
  tealTint: "#25D0AA22",
  blueTint: "#4DA3FF22",
  purpleTint: "#9A6BFF22",
  yellowTint: "#F3B51B22",
  dangerTint: "#FF6B6B1F",
};

/** Two-stop gradients (start -> end). Used by <Gradient/> in the UI kit. */
export const gradients = {
  brand: ["#25D0AA", "#4DA3FF"] as const,        // brand mark, primary buttons
  sidebar: ["#0A1B2B", "#061119"] as const,      // desktop sidebar
  hero: ["#0E2A3C", "#080F13"] as const,         // login / page hero backdrop
  card: ["#122230", "#0F1B24"] as const,         // subtle lift on stat cards
  progress: ["#25D0AA", "#4DA3FF"] as const,     // progress bar fill
};

export const space = { xs: 4, sm: 8, md: 12, lg: 16, xl: 24, xxl: 32 };
export const radius = 12;
export const radiusSm = 8;

/** Responsive breakpoints shared by the shell and the Screen container. */
export const bp = { tablet: 700, desktop: 960 };

export const font = {
  h1: { fontSize: 24, fontWeight: "800" as const, letterSpacing: -0.3 },
  h2: { fontSize: 17, fontWeight: "700" as const },
  body: { fontSize: 15, lineHeight: 22 },
  small: { fontSize: 13, lineHeight: 18 },
  label: { fontSize: 12, fontWeight: "700" as const, letterSpacing: 0.4, textTransform: "uppercase" as const },
};

export const statusColor: Record<string, string> = {
  active: colors.success, published: colors.success, evaluated: colors.success, completed: colors.success, open: colors.success,
  discontinued: colors.danger, archived: colors.muted, error: colors.danger, needs_review: colors.warning, pending_evaluation: colors.warning,
  under_review: colors.warning, processing: colors.accent, draft: colors.muted, closed: colors.muted, locked: colors.muted,
  in_progress: colors.accent, submitted: colors.accent, ready: colors.accent, uploaded: colors.muted, superseded: colors.muted,
};
