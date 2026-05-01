import { MD3DarkTheme, MD3LightTheme } from "react-native-paper";

export type Palette = {
  primary: string;
  secondary: string;
  background: string;
  surface: string;
  surfaceVariant: string;
  headerBackground: string;
  headerTint: string;
  onSurface: string;
  onSurfaceVariant: string;
  divider: string;
  danger: string;
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
  headerBackground: "#4A90D9",
  headerTint: "#FFFFFF",
  onSurface: "#000000",
  onSurfaceVariant: "#757575",
  divider: "#E0E0E0",
  danger: "#D32F2F",
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
  headerBackground: "#1F4A73",
  headerTint: "#FFFFFF",
  onSurface: "#FFFFFF",
  onSurfaceVariant: "#B0B0B0",
  divider: "#2F2F2F",
  danger: "#EF5350",
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
