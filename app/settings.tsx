import React, { useState } from "react";
import { View, StyleSheet, Alert, ScrollView, Platform } from "react-native";
import { Text, Button, Divider, SegmentedButtons } from "react-native-paper";
import Constants from "expo-constants";
import { getDb } from "../src/db/database";
import { getPreference } from "../src/db/preferences";
import { useAppStore, ThemeMode } from "../src/store/useAppStore";
import { useTranslation } from "react-i18next";
import { useAppTheme } from "../src/theme/useAppTheme";

function downloadJsonWeb(data: string, filename: string) {
  const blob = new Blob([data], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

function pickFileWeb(): Promise<string | null> {
  return new Promise((resolve) => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = ".json,application/json";
    input.onchange = async () => {
      const file = input.files?.[0];
      if (!file) return resolve(null);
      resolve(await file.text());
    };
    input.click();
  });
}

export default function SettingsScreen() {
  const { t } = useTranslation();
  const { palette } = useAppTheme();
  const loadZones = useAppStore((s) => s.loadZones);
  const themeMode = useAppStore((s) => s.themeMode);
  const setThemeMode = useAppStore((s) => s.setThemeMode);
  const [exporting, setExporting] = useState(false);
  const [importing, setImporting] = useState(false);

  const handleExport = async () => {
    setExporting(true);
    try {
      const db = await getDb();
      const zones = await db.getAllAsync(
        "SELECT * FROM zones ORDER BY sort_order"
      );
      const items = await db.getAllAsync("SELECT * FROM items ORDER BY name");
      const preferences = await db.getAllAsync("SELECT * FROM preferences");
      const data = JSON.stringify({ zones, items, preferences }, null, 2);

      if (Platform.OS === "web") {
        downloadJsonWeb(data, "van-storage-backup.json");
      } else {
        const { File, Paths } = await import("expo-file-system");
        const Sharing = await import("expo-sharing");
        const file = new File(Paths.cache, "van-storage-backup.json");
        file.write(data);
        if (await Sharing.isAvailableAsync()) {
          await Sharing.shareAsync(file.uri, {
            mimeType: "application/json",
            UTI: "public.json",
          });
        } else {
          Alert.alert(t("settings.export_success_title"), t("settings.export_success"));
        }
      }
    } catch (e) {
      Alert.alert(t("settings.error"), t("settings.export_error") + " " + (e as Error).message);
    }
    setExporting(false);
  };

  const importData = async (content: string) => {
    let data: { zones?: unknown[]; items?: unknown[]; preferences?: unknown[] };
    try {
      data = JSON.parse(content);
    } catch {
      Alert.alert(t("settings.error"), t("settings.import_invalid_json"));
      return;
    }

    if (
      !data.zones ||
      !Array.isArray(data.zones) ||
      !data.items ||
      !Array.isArray(data.items)
    ) {
      Alert.alert(
        t("settings.error"),
        t("settings.import_invalid_format")
      );
      return;
    }

    const rawZones = data.zones as Record<string, unknown>[];
    const rawItems = data.items as Record<string, unknown>[];

    const isValidGeometry = (g: unknown): boolean => {
      if (typeof g !== "object" || g === null) return false;
      const { type, x, y, w, h } = g as Record<string, unknown>;
      return (
        type === "rect" &&
        typeof x === "number" &&
        Number.isFinite(x) &&
        typeof y === "number" &&
        Number.isFinite(y) &&
        typeof w === "number" &&
        Number.isFinite(w) &&
        typeof h === "number" &&
        Number.isFinite(h)
      );
    };

    const isValidZone = (z: Record<string, unknown>) => {
      if (
        typeof z.id !== "string" ||
        typeof z.name !== "string" ||
        typeof z.color !== "string" ||
        typeof z.geometry !== "string"
      ) {
        return false;
      }
      try {
        return isValidGeometry(JSON.parse(z.geometry));
      } catch {
        return false;
      }
    };

    const isValidItem = (i: Record<string, unknown>) =>
      typeof i.id === "string" &&
      typeof i.name === "string" &&
      typeof i.zone_id === "string";

    const DEFAULT_FILL_OPACITY = 0.4;
    const sanitizeFillOpacity = (v: unknown): number =>
      typeof v === "number" && Number.isFinite(v) && v >= 0 && v <= 1
        ? v
        : DEFAULT_FILL_OPACITY;

    const rawPreferences = Array.isArray(data.preferences)
      ? (data.preferences as Record<string, unknown>[])
      : [];
    const isValidPreference = (p: Record<string, unknown>) =>
      typeof p.key === "string" && typeof p.value === "string";

    if (
      !rawZones.every(isValidZone) ||
      !rawItems.every(isValidItem) ||
      !rawPreferences.every(isValidPreference)
    ) {
      Alert.alert(t("settings.error"), t("settings.import_invalid_format"));
      return;
    }

    const zoneIds = new Set(rawZones.map((z) => z.id as string));
    if (rawItems.some((i) => !zoneIds.has(i.zone_id as string))) {
      Alert.alert(t("settings.error"), t("settings.import_orphan_items"));
      return;
    }

    const doImport = async () => {
      setImporting(true);
      try {
        const db = await getDb();
        await db.withTransactionAsync(async () => {
          await db.runAsync("DELETE FROM items");
          await db.runAsync("DELETE FROM zones");

          for (const zone of rawZones) {
            await db.runAsync(
              "INSERT INTO zones (id, name, color, geometry, fill_opacity, sort_order, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
              [
                zone.id as string,
                zone.name as string,
                zone.color as string,
                zone.geometry as string,
                sanitizeFillOpacity(zone.fill_opacity),
                (zone.sort_order as number) ?? 0,
                (zone.created_at as string) ?? new Date().toISOString(),
                (zone.updated_at as string) ?? new Date().toISOString(),
              ]
            );
          }

          for (const item of rawItems) {
            await db.runAsync(
              "INSERT INTO items (id, name, zone_id, notes, out_of_van, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
              [
                item.id as string,
                item.name as string,
                item.zone_id as string,
                (item.notes as string) ?? "",
                (item.out_of_van as number) ?? 0,
                (item.created_at as string) ?? new Date().toISOString(),
                (item.updated_at as string) ?? new Date().toISOString(),
              ]
            );
          }

          for (const pref of rawPreferences) {
            await db.runAsync(
              "INSERT OR REPLACE INTO preferences (key, value) VALUES (?, ?)",
              [pref.key as string, pref.value as string]
            );
          }
        });

        await loadZones();
        const restoredThemeMode = await getPreference("themeMode");
        if (restoredThemeMode === "auto" || restoredThemeMode === "light" || restoredThemeMode === "dark") {
          await setThemeMode(restoredThemeMode);
        }
        Alert.alert(t("settings.import_success_title"), t("settings.import_success"));
      } catch (e) {
        Alert.alert(t("settings.error"), t("settings.import_error") + " " + (e as Error).message);
      }
      setImporting(false);
    };

    Alert.alert(
      t("settings.import_confirm_title"),
      t("settings.import_confirm_text", {
        zonesCount: rawZones.length,
        itemsCount: rawItems.length,
      }),
      [
        { text: t("map.cancel"), style: "cancel" },
        { text: t("settings.import_confirm_title"), style: "destructive", onPress: doImport },
      ]
    );
  };

  const handleImport = async () => {
    try {
      if (Platform.OS === "web") {
        const content = await pickFileWeb();
        if (content) await importData(content);
      } else {
        const DocumentPicker = await import("expo-document-picker");
        const { File } = await import("expo-file-system");
        const result = await DocumentPicker.getDocumentAsync({
          type: "application/json",
          copyToCacheDirectory: true,
        });
        if (result.canceled) return;
        const asset = result.assets?.[0];
        if (!asset?.uri) return;
        const file = new File(asset.uri);
        const content = await file.text();
        await importData(content);
      }
    } catch (e) {
      Alert.alert(t("settings.error"), t("settings.import_error") + " " + (e as Error).message);
    }
  };

  return (
    <ScrollView style={[styles.container, { backgroundColor: palette.surface }]}>
      <View style={styles.section}>
        <Text variant="titleMedium" style={styles.sectionTitle}>
          {t("settings.title_data")}
        </Text>
        <Text variant="bodySmall" style={[styles.description, { color: palette.onSurfaceVariant }]}>
          {t("settings.desc_data")}
        </Text>
        <Button
          mode="contained"
          icon="export"
          onPress={handleExport}
          loading={exporting}
          style={styles.button}
        >
          {t("settings.btn_export")}
        </Button>
        <Button
          mode="outlined"
          icon="import"
          onPress={handleImport}
          loading={importing}
          style={styles.button}
        >
          {t("settings.btn_import")}
        </Button>
      </View>
      <Divider />
      <View style={styles.section}>
        <Text variant="titleMedium" style={styles.sectionTitle}>
          {t("settings.title_appearance")}
        </Text>
        <Text variant="bodySmall" style={[styles.description, { color: palette.onSurfaceVariant }]}>
          {t("settings.desc_appearance")}
        </Text>
        <SegmentedButtons
          value={themeMode}
          onValueChange={(v) => setThemeMode(v as ThemeMode)}
          buttons={[
            { value: "auto", label: t("settings.theme_auto"), icon: "theme-light-dark" },
            { value: "light", label: t("settings.theme_light"), icon: "weather-sunny" },
            { value: "dark", label: t("settings.theme_dark"), icon: "weather-night" },
          ]}
        />
      </View>
      <Divider />
      <View style={styles.section}>
        <Text variant="titleMedium" style={styles.sectionTitle}>
          {t("settings.title_about")}
        </Text>
        <Text variant="bodySmall" style={[styles.description, { color: palette.onSurfaceVariant }]}>
          {t("settings.desc_about", { version: Constants.expoConfig?.version ?? "" })}
        </Text>
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  section: { padding: 20 },
  sectionTitle: { marginBottom: 8 },
  description: { marginBottom: 16 },
  button: { marginBottom: 12 },
});
