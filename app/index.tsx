import React, { useState } from "react";
import { View, StyleSheet, ScrollView } from "react-native";
import { useRouter } from "expo-router";
import {
  FAB,
  Portal,
  Dialog,
  Text,
  List,
} from "react-native-paper";
import { VanLayoutSVG } from "../src/components/VanLayoutSVG";
import { ZoomableContainer } from "../src/components/ZoomableContainer";
import { useAppStore } from "../src/store/useAppStore";
import { useTranslation } from "react-i18next";
import { useAppTheme } from "../src/theme/useAppTheme";
import { CreateZoneDialog } from "../src/components/dialogs/CreateZoneDialog";

export default function VanMapScreen() {
  const router = useRouter();
  const { t } = useTranslation();
  const { palette } = useAppTheme();
  const initialized = useAppStore((s) => s.initialized);
  const zones = useAppStore((s) => s.zones);
  const addZone = useAppStore((s) => s.addZone);
  const editMode = useAppStore((s) => s.editMode);

  const [fabOpen, setFabOpen] = useState(false);
  const [addZoneVisible, setAddZoneVisible] = useState(false);
  const [zonePicker, setZonePicker] = useState(false);

  if (!initialized) {
    return <View style={[styles.container, { backgroundColor: palette.background }]} />;
  }

  const handleCreateZone = async (name: string, color: string) => {
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

    await addZone(name, color, geometry);
    setAddZoneVisible(false);
  };

  return (
    <View style={[styles.container, { backgroundColor: palette.background }]}>
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
            label: t("map.add_item"),
            onPress: () => setZonePicker(true),
          },
          {
            icon: "shape-plus",
            label: t("map.add_zone"),
            onPress: () => setAddZoneVisible(true),
          },
        ]}
        onStateChange={({ open }) => setFabOpen(open)}
        fabStyle={{ backgroundColor: palette.primary }}
      />

      <CreateZoneDialog
        visible={addZoneVisible}
        onCancel={() => setAddZoneVisible(false)}
        onCreate={handleCreateZone}
      />

      <Portal>
        {/* Zone picker for adding object */}
        <Dialog visible={zonePicker} onDismiss={() => setZonePicker(false)}>
          <Dialog.Title>{t("map.which_zone")}</Dialog.Title>
          <Dialog.ScrollArea style={styles.scrollArea}>
            <ScrollView>
              {zones.map((zone) => (
                <List.Item
                  key={zone.id}
                  title={zone.name}
                  description={t(
                    zone.item_count === 1
                      ? "map.objects_count_one"
                      : "map.objects_count_other",
                    { count: zone.item_count }
                  )}
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
  container: { flex: 1 },
  scrollArea: { maxHeight: 400 },
  zoneColorDot: {
    width: 24,
    height: 24,
    borderRadius: 12,
    marginLeft: 8,
    alignSelf: "center",
  },
});
