import React, { useState } from "react";
import { View, StyleSheet, Alert, ScrollView, Platform } from "react-native";
import { Text, Button, Divider } from "react-native-paper";
import { getDb } from "../src/db/database";
import { useAppStore } from "../src/store/useAppStore";
import { useTranslation } from "react-i18next";

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
  const loadZones = useAppStore((s) => s.loadZones);
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
      const data = JSON.stringify({ zones, items }, null, 2);

      if (Platform.OS === "web") {
        downloadJsonWeb(data, "van-storage-backup.json");
      } else {
        const { File, Paths } = await import("expo-file-system/next");
        const Sharing = await import("expo-sharing");
        const file = new File(Paths.cache, "van-storage-backup.json");
        file.write(data);
        if (await Sharing.isAvailableAsync()) {
          await Sharing.shareAsync(file.uri, {
            mimeType: "application/json",
            UTI: "public.json",
          });
        } else {
          Alert.alert(t("settings.import_confirm_title"), t("settings.export_success"));
        }
      }
    } catch (e) {
      Alert.alert(t("settings.error"), t("settings.export_error") + " " + (e as Error).message);
    }
    setExporting(false);
  };

  const importData = async (content: string) => {
    let data: { zones?: unknown[]; items?: unknown[] };
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

    const doImport = async () => {
      setImporting(true);
      try {
        const db = await getDb();
        await db.runAsync("DELETE FROM items");
        await db.runAsync("DELETE FROM zones");

        for (const zone of data.zones as Record<string, unknown>[]) {
          await db.runAsync(
            "INSERT INTO zones (id, name, color, geometry, sort_order, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
            [
              zone.id as string,
              zone.name as string,
              zone.color as string,
              zone.geometry as string,
              zone.sort_order as number,
              zone.created_at as string,
              zone.updated_at as string,
            ]
          );
        }

        for (const item of data.items as Record<string, unknown>[]) {
          await db.runAsync(
            "INSERT INTO items (id, name, zone_id, notes, out_of_van, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
            [
              item.id as string,
              item.name as string,
              item.zone_id as string,
              (item.notes as string) ?? "",
              (item.out_of_van as number) ?? 0,
              item.created_at as string,
              item.updated_at as string,
            ]
          );
        }

        await loadZones();
        Alert.alert(t("settings.import_success_title"), t("settings.import_success"));
      } catch (e) {
        Alert.alert(t("settings.error"), t("settings.import_error") + " " + (e as Error).message);
      }
      setImporting(false);
    };

    Alert.alert(
      t("settings.import_confirm_title"),
      t("settings.import_confirm_text", {
        zonesCount: data.zones.length,
        itemsCount: data.items.length,
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
        const { File } = await import("expo-file-system/next");
        const result = await DocumentPicker.getDocumentAsync({
          type: "application/json",
          copyToCacheDirectory: true,
        });
        if (result.canceled) return;
        const file = new File(result.assets[0].uri);
        const content = await file.text();
        await importData(content);
      }
    } catch (e) {
      Alert.alert(t("settings.error"), t("settings.import_error") + " " + (e as Error).message);
    }
  };

  return (
    <ScrollView style={styles.container}>
      <View style={styles.section}>
        <Text variant="titleMedium" style={styles.sectionTitle}>
          {t("settings.title_data")}
        </Text>
        <Text variant="bodySmall" style={styles.description}>
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
          {t("settings.title_about")}
        </Text>
        <Text variant="bodySmall" style={styles.description}>
          {t("settings.desc_about")}
        </Text>
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#fff" },
  section: { padding: 20 },
  sectionTitle: { marginBottom: 8 },
  description: { color: "#757575", marginBottom: 16 },
  button: { marginBottom: 12 },
});
