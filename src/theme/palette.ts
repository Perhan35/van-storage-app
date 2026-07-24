import { MD3DarkTheme, MD3LightTheme } from "react-native-paper";

export type Palette = {
  primary: string;
  secondary: string;
  background: string;
  surface: string;
  surfaceVariant: string;
  headerBackground: string;
  // Header icons come in four states — headerTint (available),
  // headerTintMuted (unavailable), headerDanger and headerSuccess (the actions
  // that end an edit session) — each measured against headerBackground. How
  // much separation is available depends on how deep the bar is: the dark bar
  // has room for a graduated scale that clears WCAG's 3:1 floor throughout, the
  // light one only for a polarity flip. Re-measure before changing any of these.
  headerTint: string;
  headerTintMuted: string;
  headerDanger: string;
  headerSuccess: string;
  // The header's other primary actions (out-of-van, search, entering edit
  // mode) are meant to draw the eye — the opposite intent of headerUtility
  // below — so these are picked for hue identity, not for receding.
  headerOutOfVan: string;
  headerSearch: string;
  // Separate from headerTintMuted: that token means "unavailable right now",
  // this one means "a lower-priority action" (settings) — same icon whether
  // it's usable or not, so it must never look disabled.
  headerUtility: string;
  onSurface: string;
  onSurfaceVariant: string;
  divider: string;
  danger: string;
  success: string;
  warningSurface: string;
  warningOn: string;
  editModeAccent: string;
  outline: string;
};

export const lightPalette: Palette = {
  primary: "#4A90D9",
  secondary: "#FF8A65",
  background: "#F5F5F5",
  surface: "#FFFFFF",
  surfaceVariant: "#EEEEEE",
  // A mid-tone bar caps white at 3.34:1, so the states that need contrast have
  // to go darker than the bar rather than lighter — hence the navy disabled
  // ink. Cancel/confirm keep the app's familiar red and green by request; both
  // sit near 1.5:1 here, so their hue, not their contrast, is what identifies
  // them. Deepening headerBackground is what would buy them room.
  headerBackground: "#4A90D9",
  headerTint: "#FFFFFF", // 3.34:1
  headerTintMuted: "#1F3F63", // 3.22:1
  headerDanger: "#D32F2F", // 1.49:1 — chosen for hue, not contrast
  headerSuccess: "#2E7D32", // 1.53:1 — chosen for hue, not contrast
  headerOutOfVan: "#DE9509", // 1.34:1 — warm gold, a shade darker than dark mode's
  headerSearch: "#1898A8", // 1.03:1 — teal, a shade darker than dark mode's
  // Deliberately low-contrast: this icon should recede into the bar rather
  // than compete with the others, so unlike every other header token here it
  // is not pushed toward the 3:1 floor. A darker ink (anthracite, ~3-4:1) reads
  // as bold against this saturated blue — contrast itself draws the eye — so
  // going closer to the bar's own tone is what makes it sit quietly.
  headerUtility: "#7a7a7a", // 2.00:1 — intentionally low, reads as quiet not disabled
  onSurface: "#000000",
  onSurfaceVariant: "#757575",
  divider: "#E0E0E0",
  danger: "#D32F2F",
  success: "#2E7D32",
  warningSurface: "#FFF3E0",
  warningOn: "#E65100",
  editModeAccent: "#FFD54F",
  outline: "#333333",
};

export const darkPalette: Palette = {
  primary: "#5BA3E6",
  secondary: "#FF8A65",
  background: "#121212",
  surface: "#1E1E1E",
  surfaceVariant: "#2A2A2A",
  headerBackground: "#15334E", // 13.00:1 against headerTint
  headerTint: "#FFFFFF",
  headerTintMuted: "#8CA5BF", // 5.11:1
  headerDanger: "#FF8A80", // 5.69:1
  headerSuccess: "#A5D6A7", // 7.91:1
  headerOutOfVan: "#F5A623", // 6.41:1 — warm gold
  headerSearch: "#26C6DA", // 6.30:1 — teal
  headerUtility: "#94A0AB", // 4.88:1 — cool steel-gray, reads as quiet not disabled
  onSurface: "#FFFFFF",
  onSurfaceVariant: "#B0B0B0",
  divider: "#2F2F2F",
  danger: "#EF5350",
  success: "#66BB6A",
  warningSurface: "#3A2A18",
  warningOn: "#FFB74D",
  editModeAccent: "#FFD54F",
  outline: "#666666",
};

export const paperLightTheme = {
  ...MD3LightTheme,
  colors: {
    ...MD3LightTheme.colors,
    primary: lightPalette.primary,
    secondary: lightPalette.secondary,
    background: lightPalette.background,
    surface: lightPalette.surface,
  },
};

export const paperDarkTheme = {
  ...MD3DarkTheme,
  colors: {
    ...MD3DarkTheme.colors,
    primary: darkPalette.primary,
    secondary: darkPalette.secondary,
    background: darkPalette.background,
    surface: darkPalette.surface,
  },
};
