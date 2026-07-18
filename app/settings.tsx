import React, { useRef, useState } from "react";
import { View, StyleSheet, Alert, ScrollView, Platform } from "react-native";
import { Text, Button, Divider, SegmentedButtons, Switch } from "react-native-paper";
import { useRouter } from "expo-router";
import Constants from "expo-constants";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { exportAllData, importAllData, isValidGeometry } from "../src/db/repository";
import { useAppStore, ThemeMode, SeasonMode } from "../src/store/useAppStore";
import { useTranslation } from "react-i18next";
import { useAppTheme } from "../src/theme/useAppTheme";
import { SeasonChangeoverDialog } from "../src/components/dialogs/SeasonChangeoverDialog";
import { ExpirationOverviewDialog } from "../src/components/dialogs/ExpirationOverviewDialog";

function downloadJsonWeb(data: string, filename: string) {
  const blob = new Blob([data], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

function getBackupFilename() {
  const now = new Date();
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, "0");
  const d = String(now.getDate()).padStart(2, "0");
  return `van-storage-backup-${y}${m}${d}.json`;
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

const DOUBLE_TAP_WINDOW_MS = 500;

export default function SettingsScreen() {
  const { t } = useTranslation();
  const { palette } = useAppTheme();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const lastVersionTapRef = useRef(0);
  const loadZones = useAppStore((s) => s.loadZones);
  const showTutorial = useAppStore((s) => s.showTutorial);
  const themeMode = useAppStore((s) => s.themeMode);
  const setThemeMode = useAppStore((s) => s.setThemeMode);
  const reloadThemeMode = useAppStore((s) => s.reloadThemeMode);
  const seasonMode = useAppStore((s) => s.seasonMode);
  const setSeasonMode = useAppStore((s) => s.setSeasonMode);
  const reloadSeasonMode = useAppStore((s) => s.reloadSeasonMode);
  const remindersEnabled = useAppStore((s) => s.remindersEnabled);
  const setRemindersEnabled = useAppStore((s) => s.setRemindersEnabled);
  const reloadRemindersEnabled = useAppStore((s) => s.reloadRemindersEnabled);
  const syncRemindersIfEnabled = useAppStore((s) => s.syncRemindersIfEnabled);
  const [exporting, setExporting] = useState(false);
  const [importing, setImporting] = useState(false);
  const [changeoverVisible, setChangeoverVisible] = useState(false);
  const [overviewVisible, setOverviewVisible] = useState(false);

  const handleToggleReminders = async (value: boolean) => {
    const granted = await setRemindersEnabled(value);
    if (value && !granted) {
      Alert.alert(t("settings.error"), t("settings.reminders_permission"));
    }
  };

  const handleVersionTap = () => {
    const now = Date.now();
    if (now - lastVersionTapRef.current < DOUBLE_TAP_WINDOW_MS) {
      lastVersionTapRef.current = 0;
      router.push("/game");
    } else {
      lastVersionTapRef.current = now;
    }
  };

  const handleSeasonModeChange = (mode: SeasonMode) => {
    setSeasonMode(mode);
    setChangeoverVisible(true);
  };

  const handleExport = async () => {
    setExporting(true);
    try {
      const data = JSON.stringify(await exportAllData(), null, 2);
      const filename = getBackupFilename();

      if (Platform.OS === "web") {
        downloadJsonWeb(data, filename);
      } else {
        const { File, Paths } = await import("expo-file-system");
        const Sharing = await import("expo-sharing");
        const file = new File(Paths.cache, filename);
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
        await importAllData(rawZones, rawItems, rawPreferences);

        await loadZones();
        await reloadThemeMode();
        await reloadSeasonMode();
        await reloadRemindersEnabled();
        await syncRemindersIfEnabled();
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
    <ScrollView
      style={[styles.container, { backgroundColor: palette.surface }]}
      contentContainerStyle={{ paddingBottom: insets.bottom + 20 }}
    >
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
          {t("settings.title_season")}
        </Text>
        <Text variant="bodySmall" style={[styles.description, { color: palette.onSurfaceVariant }]}>
          {t("settings.desc_season")}
        </Text>
        <SegmentedButtons
          value={seasonMode}
          onValueChange={(v) => handleSeasonModeChange(v as SeasonMode)}
          buttons={[
            { value: "summer", label: t("settings.season_summer"), icon: "weather-sunny" },
            { value: "winter", label: t("settings.season_winter"), icon: "snowflake" },
          ]}
        />
        <Button
          mode="text"
          icon="clipboard-list-outline"
          onPress={() => setChangeoverVisible(true)}
          style={styles.button}
        >
          {t("settings.season_reopen")}
        </Button>
      </View>
      <Divider />
      <View style={styles.section}>
        <Text variant="titleMedium" style={styles.sectionTitle}>
          {t("settings.title_reminders")}
        </Text>
        <Text variant="bodySmall" style={[styles.description, { color: palette.onSurfaceVariant }]}>
          {t("settings.desc_reminders")}
        </Text>
        <View style={styles.switchRow}>
          <Text variant="bodyMedium">{t("settings.reminders_enabled")}</Text>
          <Switch value={remindersEnabled} onValueChange={handleToggleReminders} />
        </View>
        <Button
          mode="text"
          icon="calendar-clock"
          onPress={() => setOverviewVisible(true)}
          style={styles.button}
        >
          {t("settings.view_expirations")}
        </Button>
      </View>
      <Divider />
      <View style={styles.section}>
        <Text variant="titleMedium" style={styles.sectionTitle}>
          {t("settings.title_help")}
        </Text>
        <Text variant="bodySmall" style={[styles.description, { color: palette.onSurfaceVariant }]}>
          {t("settings.desc_help")}
        </Text>
        <Button
          mode="outlined"
          icon="school-outline"
          onPress={() => {
            router.push("/");
            showTutorial();
          }}
          style={styles.button}
        >
          {t("settings.btn_tutorial")}
        </Button>
      </View>
      <Divider />
      <View style={styles.section}>
        <Text variant="titleMedium" style={styles.sectionTitle}>
          {t("settings.title_about")}
        </Text>
        <Text variant="bodySmall" style={[styles.description, { color: palette.onSurfaceVariant }]}>
          {t("settings.desc_about")}
        </Text>
        <Text
          variant="bodySmall"
          onPress={handleVersionTap}
          style={{ color: palette.onSurfaceVariant }}
        >
          {t("settings.version_label", { version: Constants.expoConfig?.version ?? "" })}
        </Text>
      </View>
      <SeasonChangeoverDialog
        visible={changeoverVisible}
        season={seasonMode}
        onDismiss={() => setChangeoverVisible(false)}
      />
      <ExpirationOverviewDialog
        visible={overviewVisible}
        categories={["expired", "soon", "ok"]}
        title={t("expiration.overview_title")}
        onDismiss={() => setOverviewVisible(false)}
      />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  section: { padding: 20 },
  sectionTitle: { marginBottom: 8 },
  description: { marginBottom: 16 },
  button: { marginBottom: 12 },
  switchRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 12,
  },
});
