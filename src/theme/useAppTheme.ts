import { useColorScheme } from "react-native";
import { useAppStore } from "../store/useAppStore";
import { darkPalette, lightPalette, Palette } from "./palette";

export type AppTheme = {
  palette: Palette;
  isDark: boolean;
  mode: "light" | "dark";
};

export function useAppTheme(): AppTheme {
  const themeMode = useAppStore((s) => s.themeMode);
  const systemScheme = useColorScheme();
  const resolved =
    themeMode === "auto" ? (systemScheme ?? "light") : themeMode;
  const isDark = resolved === "dark";
  return {
    palette: isDark ? darkPalette : lightPalette,
    isDark,
    mode: isDark ? "dark" : "light",
  };
}
