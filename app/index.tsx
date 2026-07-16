import { useEffect, useRef, useState } from "react";
import { View, StyleSheet } from "react-native";
import { useRouter, useNavigation } from "expo-router";
import { FAB, Text, Button } from "react-native-paper";
import Animated, { useSharedValue, useAnimatedStyle, withTiming } from "react-native-reanimated";
import { VanLayoutSVG, ZoneScreenRect } from "../src/components/VanLayoutSVG";
import {
  ZoomableContainer,
  ZoomableContainerHandle,
  DIVE_IN_DURATION,
  DIVE_OUT_DURATION,
  DIVE_EASING,
} from "../src/components/ZoomableContainer";
import { useAppStore } from "../src/store/useAppStore";
import { useTranslation } from "react-i18next";
import { useAppTheme } from "../src/theme/useAppTheme";
import { CreateZoneDialog } from "../src/components/dialogs/CreateZoneDialog";
import { AddItemDialog } from "../src/components/dialogs/AddItemDialog";
import { ExpirationOverviewDialog } from "../src/components/dialogs/ExpirationOverviewDialog";
import { plusIcon, tagFabStyle, FAB_RADIUS_SMALL } from "../src/components/AddFab";
import { Season } from "../src/db/database";
import { listItemsWithExpiration } from "../src/db/repository";
import { getExpirationStatus } from "../src/utils/expiration";

const DIVE_FADE_PEAK = 0.5;
// Fires the navigation near the end of the dive, so only its last moment
// overlaps with the zone screen's own fade-in — a brief handoff rather than
// the two animations running side by side for most of their length.
const DIVE_PUSH_DELAY = Math.round(DIVE_IN_DURATION * 0.3);

export default function VanMapScreen() {
  const router = useRouter();
  const navigation = useNavigation();
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

  const zoomRef = useRef<ZoomableContainerHandle>(null);
  const [diveColor, setDiveColor] = useState<string | null>(null);
  const diveOpacity = useSharedValue(0);
  const diveOverlayStyle = useAnimatedStyle(() => ({ opacity: diveOpacity.value }));

  // Reverses the "dive into zone" effect as soon as this screen starts being
  // revealed by a pop (e.g. navigating back from the zone screen). Native
  // stack fires `transitionStart` at the very beginning of that transition —
  // via the underlying willAppear/willDisappear callbacks — well before the
  // JS navigation state finishes syncing. Focus-based state (useFocusEffect)
  // only settles *after* interactive (swipe) pops finish animating, which
  // left the map visibly stuck zoomed in for the whole pop before dezooming;
  // this fires in sync with the pop instead, so the two motions overlap.
  useEffect(() => {
    const unsubscribe = (navigation as any).addListener(
      "transitionStart",
      (e: { data: { closing: boolean } }) => {
        if (e.data.closing) return;
        zoomRef.current?.resetZoom();
        diveOpacity.value = withTiming(0, { duration: DIVE_OUT_DURATION, easing: DIVE_EASING });
      }
    );
    return unsubscribe;
  }, [navigation]);

  const handleZonePress = (zoneId: string, rect: ZoneScreenRect) => {
    const zone = zones.find((z) => z.id === zoneId);
    setDiveColor(zone?.color ?? null);
    diveOpacity.value = withTiming(DIVE_FADE_PEAK, {
      duration: DIVE_IN_DURATION,
      easing: DIVE_EASING,
    });
    const started = zoomRef.current?.zoomToRect(rect);
    // Push partway through the dive rather than after it fully settles, so
    // the screen's own fade-in overlaps the tail of the zoom instead of
    // waiting for it — one continuous motion rather than two abrupt steps.
    if (started) {
      setTimeout(() => router.push(`/zone/${zoneId}`), DIVE_PUSH_DELAY);
    } else {
      router.push(`/zone/${zoneId}`);
    }
  };

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
      <ZoomableContainer ref={zoomRef} panMinPointers={1}>
        <VanLayoutSVG onZonePress={handleZonePress} />
      </ZoomableContainer>

      <Animated.View
        pointerEvents="none"
        style={[
          StyleSheet.absoluteFill,
          diveOverlayStyle,
          { backgroundColor: diveColor ?? "transparent" },
        ]}
      />

      <FAB.Group
        open={fabOpen}
        visible={!editMode}
        icon={fabOpen ? "close" : plusIcon}
        color={palette.headerTint}
        actions={[
          {
            icon: "package-variant-plus",
            label: t("map.add_item"),
            onPress: () => setAddItemVisible(true),
            style: { borderRadius: FAB_RADIUS_SMALL },
          },
          {
            icon: "shape-plus",
            label: t("map.add_zone"),
            onPress: () => setAddZoneVisible(true),
            style: { borderRadius: FAB_RADIUS_SMALL },
          },
        ]}
        onStateChange={({ open }) => setFabOpen(open)}
        fabStyle={[
          tagFabStyle(palette.secondary),
          {
            backgroundColor: palette.primary,
            shadowColor: palette.primary,
            shadowOpacity: 0.35,
            shadowOffset: { width: 0, height: 4 },
            shadowRadius: 8,
          },
        ]}
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
