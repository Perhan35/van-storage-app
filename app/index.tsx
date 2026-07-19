import { useEffect, useRef, useState } from "react";
import { View, StyleSheet, Pressable } from "react-native";
import { useRouter, useNavigation } from "expo-router";
import { FAB, Text, Button, IconButton } from "react-native-paper";
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withTiming,
} from "react-native-reanimated";
import { VanLayoutSVG, ZoneScreenRect } from "../src/components/VanLayoutSVG";
import {
  ZoomableContainer,
  ZoomableContainerHandle,
  DIVE_IN_DURATION,
  DIVE_OUT_DURATION,
  DIVE_EASING,
} from "../src/components/ZoomableContainer";
import { LocationsOverview } from "../src/components/LocationsOverview";
import { useAppStore } from "../src/store/useAppStore";
import { useTranslation } from "react-i18next";
import { useAppTheme } from "../src/theme/useAppTheme";
import { CreateZoneDialog } from "../src/components/dialogs/CreateZoneDialog";
import { AddItemDialog } from "../src/components/dialogs/AddItemDialog";
import { CreateLocationDialog } from "../src/components/dialogs/CreateLocationDialog";
import { ExpirationOverviewDialog } from "../src/components/dialogs/ExpirationOverviewDialog";
import { EditInscriptionDialog } from "../src/components/dialogs/EditInscriptionDialog";
import { plusIcon, tagFabStyle, FAB_RADIUS_SMALL } from "../src/components/AddFab";
import { Season, LabelSide, LabelDef } from "../src/db/database";
import { listItemsWithExpiration } from "../src/db/repository";
import { getExpirationStatus } from "../src/utils/expiration";
import { DEFAULT_CANVAS_H } from "../src/components/layoutConstants";

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
  const activeLocation = useAppStore((s) =>
    s.locations.find((l) => l.id === s.activeLocationId)
  );
  const locationCount = useAppStore((s) => s.locations.length);
  const setActiveLocation = useAppStore((s) => s.setActiveLocation);
  const addLocation = useAppStore((s) => s.addLocation);
  // Overview vs. single-location map lives in the store (the header, defined in
  // the Stack config, reads it too). `overview` shows every location at once,
  // entered by tapping the header title — mirrors, one level up, the map->zone
  // dive; the start view is chosen in the store's init() (#3).
  const overviewMode = useAppStore((s) => s.overviewMode);
  const setOverviewMode = useAppStore((s) => s.setOverviewMode);
  const updateLocationLabel = useAppStore((s) => s.updateLocationLabel);
  const resetLocationLabel = useAppStore((s) => s.resetLocationLabel);

  const [fabOpen, setFabOpen] = useState(false);
  const [addZoneVisible, setAddZoneVisible] = useState(false);
  const [addItemVisible, setAddItemVisible] = useState(false);
  const [addLocationVisible, setAddLocationVisible] = useState(false);
  const [startupOverviewVisible, setStartupOverviewVisible] = useState(false);
  // Inscription (front/rear/left/right label) currently open in the editor —
  // opened by tapping a label directly on the plan while editing the layout.
  const [editingSide, setEditingSide] = useState<LabelSide | null>(null);

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

  const handleTitlePress = () => {
    if (editMode || overviewMode) return;
    setOverviewMode(true);
  };

  // Header title is screen-controlled (rather than a static Stack.Screen
  // option) so it can show the active location's name and react to it —
  // expo-router lets a focused screen override its own header via
  // navigation.setOptions.
  useEffect(() => {
    navigation.setOptions({
      headerLeft:
        !editMode && !overviewMode
          ? () => (
              <IconButton
                icon="arrow-left"
                size={24}
                iconColor={palette.headerTint}
                style={{ margin: 0 }}
                accessibilityLabel={t("nav.back_to_locations")}
                onPress={() => setOverviewMode(true)}
              />
            )
          : undefined,
      headerTitle: () => (
        <Pressable onPress={handleTitlePress} disabled={editMode || overviewMode}>
          {!editMode && overviewMode ? (
            // All-locations overview: app name as the title, "Locations" as a
            // subtitle beneath it.
            <View>
              <Text
                style={{ color: palette.headerTint, fontWeight: "bold", fontSize: 18 }}
                numberOfLines={1}
              >
                {t("nav.app_title")}
              </Text>
              <Text
                style={{ color: palette.headerTint, opacity: 0.8, fontSize: 12 }}
                numberOfLines={1}
              >
                {t("nav.location_count", { count: locationCount })}
              </Text>
            </View>
          ) : editMode ? (
            <Text
              style={{ color: palette.headerTint, fontWeight: "bold", fontSize: 18 }}
              numberOfLines={1}
            >
              {t("nav.edit_mode")}
            </Text>
          ) : (
            // Single location: location name as the title, zone count as a
            // subtitle beneath it.
            <View>
              <Text
                style={{ color: palette.headerTint, fontWeight: "bold", fontSize: 18 }}
                numberOfLines={1}
              >
                {t("nav.app_title_named", { name: activeLocation?.name ?? "" })}
              </Text>
              <Text
                style={{ color: palette.headerTint, opacity: 0.8, fontSize: 12 }}
                numberOfLines={1}
              >
                {t("nav.zone_count", { count: zones.length })}
              </Text>
            </View>
          )}
        </Pressable>
      ),
    });
  }, [
    navigation,
    editMode,
    overviewMode,
    activeLocation?.name,
    zones.length,
    locationCount,
    palette.headerTint,
    t,
    setOverviewMode,
  ]);

  const handleSelectLocation = (locationId: string) => {
    // setActiveLocation also clears overviewMode in the store.
    setActiveLocation(locationId);
  };

  const handleCreateLocation = async (name: string, templateId: string, icon: string) => {
    await addLocation(name, templateId, icon);
    setAddLocationVisible(false);
  };

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
    const canvasH = activeLocation?.outline.h ?? DEFAULT_CANVAS_H;
    let maxBottom = 70;
    for (const z of zones) {
      const bottom = z.geometry.y + z.geometry.h;
      if (bottom > maxBottom) maxBottom = bottom;
    }
    const y = Math.min(maxBottom + 10, canvasH - 80);
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

  // --- Orientation inscriptions (front/rear/left/right labels on the plan) ---
  const labels = activeLocation?.labels ?? {};
  // front/rear have a built-in default; left/right have none.
  const inscriptionDefault = (side: LabelSide): string | null =>
    side === "front" ? t("map.front") : side === "rear" ? t("map.rear") : null;

  const handleSaveLabel = (side: LabelSide, def: LabelDef) => {
    if (activeLocation) updateLocationLabel(activeLocation.id, side, def);
    setEditingSide(null);
  };
  const handleResetLabel = (side: LabelSide) => {
    if (activeLocation) resetLocationLabel(activeLocation.id, side);
    setEditingSide(null);
  };

  return (
    <View style={[styles.container, { backgroundColor: palette.background }]}>
      {!overviewMode ? (
        // Plain instant swap — no entering/exiting layout animation. The fade
        // animation occasionally failed to settle, leaving the map stuck dim
        // ("greyed-out") and/or the ZoomableContainer measured before it was
        // laid out; swapping instantly guarantees full opacity and a correct
        // fit every time a location opens (#B, and keeps #6 fixed).
        <View style={StyleSheet.absoluteFill}>
          {/* One-finger pan works in edit mode too now that moving a zone requires
              a press-and-hold to pick it up first (the canvas stands down while a
              zone is grabbed). */}
          <ZoomableContainer ref={zoomRef} panMinPointers={1}>
            <VanLayoutSVG onZonePress={handleZonePress} onEditInscription={setEditingSide} />
          </ZoomableContainer>
        </View>
      ) : (
        <View style={StyleSheet.absoluteFill}>
          <LocationsOverview
            onSelectLocation={handleSelectLocation}
            onCreateNew={() => setAddLocationVisible(true)}
          />
        </View>
      )}

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
        visible={!editMode && !overviewMode}
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

      {editingSide && (
        <EditInscriptionDialog
          side={editingSide}
          currentText={labels[editingSide]?.text?.trim() ?? ""}
          defaultText={inscriptionDefault(editingSide)}
          hidden={!!labels[editingSide]?.hidden}
          onCancel={() => setEditingSide(null)}
          onSave={handleSaveLabel}
          onReset={handleResetLabel}
        />
      )}

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

      <CreateLocationDialog
        visible={addLocationVisible}
        onCancel={() => setAddLocationVisible(false)}
        onCreate={handleCreateLocation}
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
