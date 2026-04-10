import React, { useState } from "react";
import { View, StyleSheet, ScrollView, Pressable } from "react-native";
import { useRouter } from "expo-router";
import {
  FAB,
  Portal,
  Dialog,
  TextInput,
  Button,
  Text,
  List,
} from "react-native-paper";
import { VanLayoutSVG } from "../src/components/VanLayoutSVG";
import { ZoomableContainer } from "../src/components/ZoomableContainer";
import { useAppStore } from "../src/store/useAppStore";

const PRESET_COLORS = [
  "#78909C",
  "#FF8A65",
  "#4DB6AC",
  "#7986CB",
  "#AED581",
  "#FFD54F",
  "#F48FB1",
  "#4A90D9",
  "#E57373",
  "#BA68C8",
];

export default function VanMapScreen() {
  const router = useRouter();
  const initialized = useAppStore((s) => s.initialized);
  const zones = useAppStore((s) => s.zones);
  const addZone = useAppStore((s) => s.addZone);
  const editMode = useAppStore((s) => s.editMode);

  const [fabOpen, setFabOpen] = useState(false);
  const [addZoneVisible, setAddZoneVisible] = useState(false);
  const [zonePicker, setZonePicker] = useState(false);
  const [newZoneName, setNewZoneName] = useState("");
  const [newZoneColor, setNewZoneColor] = useState("#4A90D9");

  if (!initialized) {
    return <View style={styles.container} />;
  }

  const handleCreateZone = async () => {
    if (!newZoneName.trim()) return;

    // Place new zone below existing ones, or at a default spot
    let maxBottom = 70;
    for (const z of zones) {
      const bottom = z.geometry.y + z.geometry.h;
      if (bottom > maxBottom) maxBottom = bottom;
    }
    const y = Math.min(maxBottom + 10, 520);
    const geometry = {
      type: "rect" as const,
      x: 50,
      y,
      w: 200,
      h: 60,
    };

    await addZone(newZoneName.trim(), newZoneColor, geometry);
    setAddZoneVisible(false);
    setNewZoneName("");
    setNewZoneColor("#4A90D9");
  };

  return (
    <View style={styles.container}>
      <ZoomableContainer enabled={!editMode}>
        <VanLayoutSVG
          onZonePress={(zoneId) => router.push(`/zone/${zoneId}`)}
        />
      </ZoomableContainer>

      <FAB.Group
        open={fabOpen}
        visible
        icon={fabOpen ? "close" : "plus"}
        actions={[
          {
            icon: "package-variant-plus",
            label: "Ajouter un objet",
            onPress: () => setZonePicker(true),
          },
          {
            icon: "shape-plus",
            label: "Ajouter une zone",
            onPress: () => setAddZoneVisible(true),
          },
        ]}
        onStateChange={({ open }) => setFabOpen(open)}
        fabStyle={styles.fab}
      />

      <Portal>
        {/* Create zone dialog */}
        <Dialog
          visible={addZoneVisible}
          onDismiss={() => setAddZoneVisible(false)}
        >
          <Dialog.Title>Nouvelle zone</Dialog.Title>
          <Dialog.Content>
            <TextInput
              mode="outlined"
              label="Nom de la zone"
              value={newZoneName}
              onChangeText={setNewZoneName}
              style={styles.dialogInput}
            />
            <Text variant="bodySmall" style={styles.colorLabel}>
              Couleur
            </Text>
            <View style={styles.colorRow}>
              {PRESET_COLORS.map((color) => (
                <Pressable
                  key={color}
                  onPress={() => setNewZoneColor(color)}
                  style={[
                    styles.colorDot,
                    {
                      backgroundColor: color,
                      borderWidth: newZoneColor === color ? 3 : 0,
                      borderColor: "#333",
                    },
                  ]}
                />
              ))}
            </View>
          </Dialog.Content>
          <Dialog.Actions>
            <Button onPress={() => setAddZoneVisible(false)}>Annuler</Button>
            <Button onPress={handleCreateZone}>Créer</Button>
          </Dialog.Actions>
        </Dialog>

        {/* Zone picker for adding object */}
        <Dialog visible={zonePicker} onDismiss={() => setZonePicker(false)}>
          <Dialog.Title>Dans quelle zone ?</Dialog.Title>
          <Dialog.ScrollArea style={styles.scrollArea}>
            <ScrollView>
              {zones.map((zone) => (
                <List.Item
                  key={zone.id}
                  title={zone.name}
                  description={`${zone.item_count} objet${zone.item_count !== 1 ? "s" : ""}`}
                  left={() => (
                    <View
                      style={[
                        styles.zoneColorDot,
                        { backgroundColor: zone.color },
                      ]}
                    />
                  )}
                  onPress={() => {
                    setZonePicker(false);
                    router.push(`/zone/${zone.id}`);
                  }}
                />
              ))}
            </ScrollView>
          </Dialog.ScrollArea>
        </Dialog>
      </Portal>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#F5F5F5" },
  fab: {
    backgroundColor: "#4A90D9",
  },
  dialogInput: { marginBottom: 12 },
  colorLabel: { marginBottom: 8, color: "#757575" },
  colorRow: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  colorDot: { width: 36, height: 36, borderRadius: 18 },
  scrollArea: { maxHeight: 400 },
  zoneColorDot: {
    width: 24,
    height: 24,
    borderRadius: 12,
    marginLeft: 8,
    alignSelf: "center",
  },
});
