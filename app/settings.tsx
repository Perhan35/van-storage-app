import React, { useRef, useState } from "react";
import { View, StyleSheet, Alert, ScrollView, Platform, ActionSheetIOS } from "react-native";
import { Text, Button, Divider, SegmentedButtons, Switch } from "react-native-paper";
import { useRouter } from "expo-router";
import Constants from "expo-constants";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { importAllData, isValidGeometry, isValidOutline } from "../src/db/repository";
import { getTemplate } from "../src/db/templates";
import { useAppStore, ThemeMode, SeasonMode } from "../src/store/useAppStore";
import { useTranslation } from "react-i18next";
import { APP_LANGUAGES, LANGUAGE_LABELS, LanguagePreference } from "../src/i18n";
import { useAppTheme } from "../src/theme/useAppTheme";
import { ContextMenu } from "../src/components/ContextMenu";
import { SeasonChangeoverDialog } from "../src/components/dialogs/SeasonChangeoverDialog";
import { ExpirationOverviewDialog } from "../src/components/dialogs/ExpirationOverviewDialog";
import { runBackupExport } from "../src/utils/backup";

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

// "System" first, then each language named in itself — see LANGUAGE_LABELS.
const LANGUAGE_OPTIONS: LanguagePreference[] = ["system", ...APP_LANGUAGES];

export default function SettingsScreen() {
  const { t, i18n } = useTranslation();
  const { palette, mode } = useAppTheme();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const lastVersionTapRef = useRef(0);
  const loadZones = useAppStore((s) => s.loadZones);
  const reloadLocations = useAppStore((s) => s.reloadLocations);
  const setActiveLocation = useAppStore((s) => s.setActiveLocation);
  const showTutorial = useAppStore((s) => s.showTutorial);
  const themeMode = useAppStore((s) => s.themeMode);
  const setThemeMode = useAppStore((s) => s.setThemeMode);
  const reloadThemeMode = useAppStore((s) => s.reloadThemeMode);
  const showMenuHeader = useAppStore((s) => s.showMenuHeader);
  const setShowMenuHeader = useAppStore((s) => s.setShowMenuHeader);
  const reloadShowMenuHeader = useAppStore((s) => s.reloadShowMenuHeader);
  const languagePreference = useAppStore((s) => s.languagePreference);
  const setLanguagePreference = useAppStore((s) => s.setLanguagePreference);
  const reloadLanguagePreference = useAppStore((s) => s.reloadLanguagePreference);
  const seasonMode = useAppStore((s) => s.seasonMode);
  const setSeasonMode = useAppStore((s) => s.setSeasonMode);
  const reloadSeasonMode = useAppStore((s) => s.reloadSeasonMode);
  const remindersEnabled = useAppStore((s) => s.remindersEnabled);
  const setRemindersEnabled = useAppStore((s) => s.setRemindersEnabled);
  const reloadRemindersEnabled = useAppStore((s) => s.reloadRemindersEnabled);
  const syncRemindersIfEnabled = useAppStore((s) => s.syncRemindersIfEnabled);
  const backupRemindersEnabled = useAppStore((s) => s.backupRemindersEnabled);
  const setBackupRemindersEnabled = useAppStore((s) => s.setBackupRemindersEnabled);
  const reloadBackupSettings = useAppStore((s) => s.reloadBackupSettings);
  const lastBackupAt = useAppStore((s) => s.lastBackupAt);
  const recordBackupDone = useAppStore((s) => s.recordBackupDone);
  const [exporting, setExporting] = useState(false);
  const [importing, setImporting] = useState(false);
  const [changeoverVisible, setChangeoverVisible] = useState(false);
  const [overviewVisible, setOverviewVisible] = useState(false);
  // Android only: the measured rect of the language button, so the dropdown
  // can open flush beneath it. iOS and web use their own native pickers.
  const [languageAnchor, setLanguageAnchor] = useState<{
    x: number;
    y: number;
    width: number;
    height: number;
  } | null>(null);
  const languageButtonRef = useRef<View>(null);

  const languageLabel = (preference: LanguagePreference) =>
    preference === "system" ? t("settings.language_system") : LANGUAGE_LABELS[preference];

  const openLanguagePicker = () => {
    if (Platform.OS === "ios") {
      const labels = LANGUAGE_OPTIONS.map(languageLabel);
      ActionSheetIOS.showActionSheetWithOptions(
        {
          title: t("settings.title_language"),
          options: [...labels, t("map.cancel")],
          cancelButtonIndex: labels.length,
          userInterfaceStyle: mode,
        },
        (index) => {
          const picked = LANGUAGE_OPTIONS[index];
          if (picked) setLanguagePreference(picked);
        }
      );
      return;
    }
    // Measures the trigger so the dropdown matches its width (react-native-web's
    // measureInWindow needs a plain View ref — Paper's Button ref isn't
    // guaranteed to support it).
    languageButtonRef.current?.measureInWindow((x, y, width, height) => {
      setLanguageAnchor({ x, y, width, height });
    });
  };

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
    const result = await runBackupExport();
    setExporting(false);
    if (!result.ok) {
      Alert.alert(t("settings.error"), t("settings.export_error") + " " + result.error);
      return;
    }
    // Stops the reminder from asking again until the data moves on.
    await recordBackupDone();
    if (!result.shared) {
      Alert.alert(t("settings.export_success_title"), t("settings.export_success"));
    }
  };

  const importData = async (content: string) => {
    let data: { locations?: unknown[]; zones?: unknown[]; items?: unknown[]; preferences?: unknown[] };
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

    const isValidLocation = (l: Record<string, unknown>) => {
      if (typeof l.id !== "string" || typeof l.name !== "string" || typeof l.outline !== "string") {
        return false;
      }
      try {
        return isValidOutline(JSON.parse(l.outline));
      } catch {
        return false;
      }
    };

    if (
      !rawZones.every(isValidZone) ||
      !rawItems.every(isValidItem) ||
      !rawPreferences.every(isValidPreference)
    ) {
      Alert.alert(t("settings.error"), t("settings.import_invalid_format"));
      return;
    }

    // Backups predating multi-location support have no `locations` array and
    // no per-zone location_id: fall back to a single generated "Van" location
    // owning every zone in the file, so an old backup still imports cleanly.
    let rawLocations: Record<string, unknown>[];
    if (Array.isArray(data.locations)) {
      rawLocations = data.locations as Record<string, unknown>[];
      if (!rawLocations.every(isValidLocation)) {
        Alert.alert(t("settings.error"), t("settings.import_invalid_format"));
        return;
      }
    } else {
      const template = getTemplate("van");
      const fallbackLocationId = Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
      rawLocations = [
        { id: fallbackLocationId, name: t(template.nameKey), outline: JSON.stringify(template.outline), sort_order: 0 },
      ];
      for (const zone of rawZones) {
        if (!zone.location_id) zone.location_id = fallbackLocationId;
      }
    }

    const locationIds = new Set(rawLocations.map((l) => l.id as string));
    if (rawZones.some((z) => !locationIds.has(z.location_id as string))) {
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
        await importAllData(rawLocations, rawZones, rawItems, rawPreferences);

        await reloadLocations();
        // The previously active location may not exist in the imported data
        // (it was replaced wholesale) — fall back to the first location so
        // the map isn't left pointed at a location_id that no longer exists.
        const currentActiveId = useAppStore.getState().activeLocationId;
        const stillExists = useAppStore
          .getState()
          .locations.some((l) => l.id === currentActiveId);
        if (stillExists) {
          await loadZones();
        } else {
          const first = useAppStore.getState().locations[0];
          if (first) await setActiveLocation(first.id);
        }
        // The backup carries every preference row, the language among them, so
        // importing one made on a device set to Italian switches the app to
        // Italian here rather than on the next launch.
        await reloadLanguagePreference();
        await reloadThemeMode();
        await reloadShowMenuHeader();
        await reloadSeasonMode();
        await reloadRemindersEnabled();
        await syncRemindersIfEnabled();
        await reloadBackupSettings();
        // What's on the device now is exactly what's in the file the user just
        // imported, so there's nothing new to back up — record it as backed up
        // rather than let the reminder fire on the next launch.
        await recordBackupDone();
        Alert.alert(t("settings.import_success_title"), t("settings.import_success"));
      } catch (e) {
        Alert.alert(t("settings.error"), t("settings.import_error") + " " + (e as Error).message);
      }
      setImporting(false);
    };

    Alert.alert(
      t("settings.import_confirm_title"),
      t("settings.import_confirm_text", {
        locationsCount: rawLocations.length,
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
        <View style={[styles.switchRow, styles.switchRowSpaced]}>
          <Text variant="bodyMedium" style={styles.switchLabel}>
            {t("settings.backup_reminders_enabled")}
          </Text>
          <Switch value={backupRemindersEnabled} onValueChange={setBackupRemindersEnabled} />
        </View>
        <Text variant="bodySmall" style={{ color: palette.onSurfaceVariant }}>
          {t("settings.backup_reminders_hint")}
        </Text>
        <Text variant="bodySmall" style={[styles.lastBackup, { color: palette.onSurfaceVariant }]}>
          {lastBackupAt
            ? t("settings.last_backup", {
                date: new Date(lastBackupAt).toLocaleDateString(i18n.language),
              })
            : t("settings.last_backup_never")}
        </Text>
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
        <View style={[styles.switchRow, styles.switchRowSpaced]}>
          <Text variant="bodyMedium">{t("settings.menu_header_label")}</Text>
          <Switch value={showMenuHeader} onValueChange={setShowMenuHeader} />
        </View>
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
          style={[styles.button, { marginTop: 16 }]}
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
          {t("settings.title_language")}
        </Text>
        <Text variant="bodySmall" style={[styles.description, { color: palette.onSurfaceVariant }]}>
          {t("settings.desc_language")}
        </Text>
        {/* The trigger looks the same everywhere; what it opens is the
            platform's own picker — an action sheet on iOS, the browser's
            select on web, the app's Material dropdown on Android. */}
        <View ref={languageButtonRef} style={styles.languageTrigger}>
          <Button
            mode="outlined"
            icon="translate"
            onPress={Platform.OS === "web" ? undefined : openLanguagePicker}
          >
            {languageLabel(languagePreference)}
          </Button>
          {Platform.OS === "web" &&
            // Invisible native <select> stacked over the Paper Button so the
            // browser's own dropdown opens on click, while the visible control
            // still matches the rest of the screen. Mirrors the date input in
            // ExpirationField.
            React.createElement(
              "select",
              {
                value: languagePreference,
                onChange: (e: React.ChangeEvent<HTMLSelectElement>) =>
                  setLanguagePreference(e.target.value as LanguagePreference),
                style: {
                  position: "absolute",
                  top: 0,
                  left: 0,
                  right: 0,
                  bottom: 0,
                  width: "100%",
                  height: "100%",
                  opacity: 0,
                  cursor: "pointer",
                  border: "none",
                },
              },
              LANGUAGE_OPTIONS.map((option) =>
                React.createElement("option", { key: option, value: option }, languageLabel(option))
              )
            )}
        </View>
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
      {/* Android's language picker: the app's own Material dropdown, since
          React Native exposes no native spinner. Never opened on iOS or web,
          which have their own pickers above. */}
      <ContextMenu
        visible={!!languageAnchor}
        onDismiss={() => setLanguageAnchor(null)}
        anchor={languageAnchor ?? { x: 0, y: 0 }}
        dropdown
        items={LANGUAGE_OPTIONS.map((option) => ({
          icon: option === "system" ? "cellphone-cog" : "translate",
          label: languageLabel(option),
          selected: languagePreference === option,
          onPress: () => setLanguagePreference(option),
        }))}
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
  switchRowSpaced: {
    marginTop: 16,
  },
  // Relative so the web <select> overlay can cover the button exactly.
  languageTrigger: { position: "relative" },
  // Keeps a long label from pushing the switch off the row.
  switchLabel: { flex: 1, paddingRight: 12 },
  lastBackup: { marginTop: 8, fontStyle: "italic" },
});
