import React, { useEffect, useState } from "react";
import { View, StyleSheet } from "react-native";
import { useRouter } from "expo-router";
import { FAB, Text, Button } from "react-native-paper";
import { VanLayoutSVG } from "../src/components/VanLayoutSVG";
import { ZoomableContainer } from "../src/components/ZoomableContainer";
import { useAppStore } from "../src/store/useAppStore";
import { useTranslation } from "react-i18next";
import { useAppTheme } from "../src/theme/useAppTheme";
import { CreateZoneDialog } from "../src/components/dialogs/CreateZoneDialog";
import { AddItemDialog } from "../src/components/dialogs/AddItemDialog";
import { ExpirationOverviewDialog } from "../src/components/dialogs/ExpirationOverviewDialog";
import { Season } from "../src/db/database";
import { listItemsWithExpiration } from "../src/db/repository";
import { getExpirationStatus } from "../src/utils/expiration";

export default function VanMapScreen() {
  const router = useRouter();
  const { t } = useTranslation();
  const { palette } = useAppTheme();
  const initialized = useAppStore((s) => s.initialized);
  const initError = useAppStore((s) => s.initError);
  const init = useAppStore((s) => s.init);
  const zones = useAppStore((s) => s.zones);
  const addZone = useAppStore((s) => s.addZone);
  const addItem = useAppStore((s) => s.addItem);
  const editMode = useAppStore((s) => s.editMode);
  const expirationAlertShown = useAppStore((s) => s.expirationAlertShown);
  const setExpirationAlertShown = useAppStore((s) => s.setExpirationAlertShown);

  const [fabOpen, setFabOpen] = useState(false);
  const [addZoneVisible, setAddZoneVisible] = useState(false);
  const [addItemVisible, setAddItemVisible] = useState(false);
  const [startupOverviewVisible, setStartupOverviewVisible] = useState(false);

  // Shown once per app launch: surfaces items that are already expired or
  // expiring soon, right after the data has finished loading.
  useEffect(() => {
    if (!initialized || expirationAlertShown) return;
    setExpirationAlertShown(true);
    listItemsWithExpiration().then((items) => {
      const hasUrgent = items.some(
        (item) => getExpirationStatus(item.expiration_date as string, item.reminder_days) !== "ok"
      );
      if (hasUrgent) setStartupOverviewVisible(true);
    });
  }, [initialized, expirationAlertShown]);

  // Entering edit mode hides the FAB; close it too so it doesn't reappear
  // already-open the next time it's shown.
  useEffect(() => {
    if (editMode) setFabOpen(false);
  }, [editMode]);

  if (initError) {
    return (
      <View style={[styles.container, styles.centered, { backgroundColor: palette.background }]}>
        <Text style={{ color: palette.onSurface, textAlign: "center", marginBottom: 16 }}>
          {t("startup.error")}
        </Text>
        <Button mode="contained" onPress={() => init()}>
          {t("startup.retry")}
        </Button>
      </View>
    );
  }

  if (!initialized) {
    return <View style={[styles.container, { backgroundColor: palette.background }]} />;
  }

  const handleCreateZone = async (name: string, color: string, checklist: boolean) => {
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

    await addZone(name, color, geometry, checklist);
    setAddZoneVisible(false);
  };

  const handleCreateItem = async (
    name: string,
    notes: string,
    season: Season,
    zoneId: string,
    expirationDate: string | null,
    reminderDays: number
  ) => {
    await addItem(name, zoneId, notes, season, expirationDate, reminderDays);
    setAddItemVisible(false);
    router.push(`/zone/${zoneId}`);
  };

  return (
    <View style={[styles.container, { backgroundColor: palette.background }]}>
      {/* One-finger pan works in edit mode too now that moving a zone requires
          a press-and-hold to pick it up first (the canvas stands down while a
          zone is grabbed). */}
      <ZoomableContainer panMinPointers={1}>
        <VanLayoutSVG
          onZonePress={(zoneId) => router.push(`/zone/${zoneId}`)}
        />
      </ZoomableContainer>

      <FAB.Group
        open={fabOpen}
        visible={!editMode}
        icon={fabOpen ? "close" : "plus"}
        actions={[
          {
            icon: "package-variant-plus",
            label: t("map.add_item"),
            onPress: () => setAddItemVisible(true),
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

      <AddItemDialog
        visible={addItemVisible}
        zones={zones}
        zoneId={zones[0]?.id ?? ""}
        onCancel={() => setAddItemVisible(false)}
        onSave={handleCreateItem}
      />

      <ExpirationOverviewDialog
        visible={startupOverviewVisible}
        categories={["expired", "soon"]}
        title={t("expiration.startup_title")}
        onDismiss={() => setStartupOverviewVisible(false)}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  centered: { justifyContent: "center", alignItems: "center", padding: 24 },
});
