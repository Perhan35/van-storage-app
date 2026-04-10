import React, { useState } from "react";
import { View, StyleSheet, Alert, ScrollView } from "react-native";
import { Text, Button, Divider } from "react-native-paper";
import { File, Paths } from "expo-file-system/next";
import * as Sharing from "expo-sharing";
import { getDb } from "../src/db/database";
import { useAppStore } from "../src/store/useAppStore";

export default function SettingsScreen() {
  const loadZones = useAppStore((s) => s.loadZones);
  const [exporting, setExporting] = useState(false);

  const handleExport = async () => {
    setExporting(true);
    try {
      const db = await getDb();
      const zones = await db.getAllAsync("SELECT * FROM zones ORDER BY sort_order");
      const items = await db.getAllAsync("SELECT * FROM items ORDER BY name");
      const data = JSON.stringify({ zones, items }, null, 2);
      const file = new File(Paths.document, "van-storage-backup.json");
      file.write(data);
      if (await Sharing.isAvailableAsync()) {
        await Sharing.shareAsync(file.uri);
      } else {
        Alert.alert("Export", "Fichier sauvegardé");
      }
    } catch (e) {
      Alert.alert("Erreur", "Export échoué: " + (e as Error).message);
    }
    setExporting(false);
  };

  const handleImport = () => {
    Alert.alert(
      "Import",
      "L'import depuis un fichier JSON sera disponible dans une prochaine version.",
      [{ text: "OK" }]
    );
  };

  return (
    <ScrollView style={styles.container}>
      <View style={styles.section}>
        <Text variant="titleMedium" style={styles.sectionTitle}>
          Sauvegarde des données
        </Text>
        <Text variant="bodySmall" style={styles.description}>
          Exportez vos données en JSON pour les sauvegarder ou les transférer vers un autre appareil.
        </Text>
        <Button
          mode="contained"
          icon="export"
          onPress={handleExport}
          loading={exporting}
          style={styles.button}
        >
          Exporter les données
        </Button>
        <Button
          mode="outlined"
          icon="import"
          onPress={handleImport}
          style={styles.button}
        >
          Importer des données
        </Button>
      </View>
      <Divider />
      <View style={styles.section}>
        <Text variant="titleMedium" style={styles.sectionTitle}>
          À propos
        </Text>
        <Text variant="bodySmall" style={styles.description}>
          Van Storage v1.0.0 by Perhan{"\n"}
          Application d'inventaire pour Citroën Jumpy (T&T Vans Aventourer)
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
