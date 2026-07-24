import { useEffect, useRef, useState, useCallback } from "react";
import { View, StyleSheet, Pressable } from "react-native";
import { useRouter, useNavigation, useFocusEffect } from "expo-router";
import { FAB, Text, Button, IconButton } from "react-native-paper";
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withTiming,
  runOnJS,
} from "react-native-reanimated";
import { VanLayoutSVG, ZoneScreenRect } from "../src/components/VanLayoutSVG";
import {
  ZoomableContainer,
  ZoomableContainerHandle,
  DIVE_IN_DURATION,
  DIVE_OUT_DURATION,
  DIVE_EASING,
  DIVE_OUT_EASING,
} from "../src/components/ZoomableContainer";
import { LocationsOverview } from "../src/components/LocationsOverview";
import {
  Rect,
  locationFlightStart,
  LOCATION_ENTER_DURATION,
  LOCATION_ENTER_EASING,
  LOCATION_EXIT_DURATION,
  LOCATION_EXIT_EASING,
  GRID_RECEDE_SCALE,
  GRID_RETURN_SCALE,
  GRID_FADE_DURATION,
  GRID_FADE_EASING,
  MAP_EXIT_SCALE,
  HEADER_FADE_DURATION,
  HEADER_FADE_EASING,
} from "../src/components/locationTransition";
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

  // --- Overview <-> location flight (see locationTransition.ts) ---
  // Both layers stay mounted while one is running; `transition` says which is
  // moving, and null means "resting", when only one of them exists.
  const [transition, setTransition] = useState<"enter" | "exit" | null>(null);
  const containerRef = useRef<View>(null);
  const containerRect = useRef<Rect | null>(null);
  const transitionTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const mapScale = useSharedValue(1);
  const mapX = useSharedValue(0);
  const mapY = useSharedValue(0);
  const mapOpacity = useSharedValue(1);
  const gridScale = useSharedValue(1);
  const gridOpacity = useSharedValue(1);
  // Vanishing point of the grid's recede, relative to the container center: the
  // tapped tile. Tiles beside your finger barely move while distant ones sweep
  // outward, so the grid reads as a plane you fly through, not one that resizes.
  const gridOriginX = useSharedValue(0);
  const gridOriginY = useSharedValue(0);

  const mapFlightStyle = useAnimatedStyle(() => ({
    opacity: mapOpacity.value,
    transform: [
      { translateX: mapX.value },
      { translateY: mapY.value },
      { scale: mapScale.value },
    ],
  }));

  // Scale about the tapped tile rather than the layer's own center: shift the
  // origin there, scale, shift back.
  const gridFlightStyle = useAnimatedStyle(() => ({
    opacity: gridOpacity.value,
    transform: [
      { translateX: gridOriginX.value },
      { translateY: gridOriginY.value },
      { scale: gridScale.value },
      { translateX: -gridOriginX.value },
      { translateY: -gridOriginY.value },
    ],
  }));

  // Both layers return to their resting values whenever nothing is running.
  // An effect (rather than the animation's completion callback) because it
  // fires after the commit that unmounts the outgoing layer — so resetting the
  // map's opacity here can't flash it back into view, and the map can never be
  // left stranded faded out the way the old fade transition sometimes was.
  useEffect(() => {
    if (transition !== null) return;
    mapScale.value = 1;
    mapX.value = 0;
    mapY.value = 0;
    mapOpacity.value = 1;
    gridScale.value = 1;
    gridOpacity.value = 1;
    gridOriginX.value = 0;
    gridOriginY.value = 0;
  }, [transition]);

  // Ending on a timer rather than on the animation finishing: a completion
  // callback that never fires (an interrupted animation) would strand both
  // layers non-interactive, and this screen has been bitten by that before.
  const armTransitionEnd = useCallback((duration: number) => {
    if (transitionTimer.current) clearTimeout(transitionTimer.current);
    transitionTimer.current = setTimeout(() => {
      transitionTimer.current = null;
      setTransition(null);
    }, duration + 40);
  }, []);

  // --- Header title handoff ---
  // The title lags `overviewMode` so its text can change at the bottom of the
  // dip, while it's invisible, instead of cutting mid-flight. Everything in the
  // header reads this rather than the store value.
  const [titleOverview, setTitleOverview] = useState(overviewMode);
  const titleTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const headerOpacity = useSharedValue(1);
  const headerFadeStyle = useAnimatedStyle(() => ({ opacity: headerOpacity.value }));

  const beginTitleSwap = useCallback((toOverview: boolean) => {
    if (titleTimer.current) clearTimeout(titleTimer.current);
    const config = { duration: HEADER_FADE_DURATION, easing: HEADER_FADE_EASING };
    headerOpacity.value = withTiming(0, config);
    titleTimer.current = setTimeout(() => {
      titleTimer.current = null;
      setTitleOverview(toOverview);
    }, HEADER_FADE_DURATION);
  }, []);

  // Fading back in is driven off the committed title, so it starts once the new
  // text is actually on screen — never while the old one is still rendered.
  useEffect(() => {
    headerOpacity.value = withTiming(1, {
      duration: HEADER_FADE_DURATION,
      easing: HEADER_FADE_EASING,
    });
  }, [titleOverview]);

  // Locations can also be opened without a flight (the overview's "edit
  // outline" menu item, creating one, startup). Nothing dips the title there,
  // so catch up to the store as soon as nothing is moving.
  useEffect(() => {
    if (transition === null && titleOverview !== overviewMode) {
      setTitleOverview(overviewMode);
    }
  }, [transition, overviewMode, titleOverview]);

  useEffect(
    () => () => {
      if (transitionTimer.current) clearTimeout(transitionTimer.current);
      if (titleTimer.current) clearTimeout(titleTimer.current);
    },
    []
  );

  const handleContainerLayout = useCallback(() => {
    containerRef.current?.measureInWindow((x, y, width, height) => {
      containerRect.current = { x, y, width, height };
    });
  }, []);

  // Leaving isn't the entry played backwards: opening a location is a
  // deliberate act, closing one is a dismissal. The map falls away as the grid
  // rises to meet it, quickly, with no particular tile to aim at.
  const goToOverview = useCallback(() => {
    if (overviewMode || editMode) return;
    gridScale.value = GRID_RETURN_SCALE;
    gridOpacity.value = 0;
    gridOriginX.value = 0;
    gridOriginY.value = 0;
    setTransition("exit");
    setOverviewMode(true);
    beginTitleSwap(true);

    const config = { duration: LOCATION_EXIT_DURATION, easing: LOCATION_EXIT_EASING };
    mapScale.value = withTiming(MAP_EXIT_SCALE, config);
    mapOpacity.value = withTiming(0, config);
    gridScale.value = withTiming(1, config);
    gridOpacity.value = withTiming(1, config);
    armTransitionEnd(LOCATION_EXIT_DURATION);
  }, [overviewMode, editMode, setOverviewMode, armTransitionEnd, beginTitleSwap]);

  // Reverses the "dive into zone" effect when returning to this screen (e.g.
  // navigating back from the zone screen). Executed on screen focus so the
  // color overlay smoothly fades back to transparent and zoom is reset.
  useFocusEffect(
    useCallback(() => {
      zoomRef.current?.resetZoom();
      diveOpacity.value = withTiming(
        0,
        { duration: DIVE_OUT_DURATION, easing: DIVE_OUT_EASING },
        (finished) => {
          if (finished) {
            runOnJS(setDiveColor)(null);
          }
        }
      );
    }, [diveOpacity])
  );

  const handleTitlePress = () => {
    goToOverview();
  };

  // Header title is screen-controlled (rather than a static Stack.Screen
  // option) so it can show the active location's name and react to it —
  // expo-router lets a focused screen override its own header via
  // navigation.setOptions.
  //
  // Both pieces read `titleOverview` rather than the store's `overviewMode`, so
  // they change together at the bottom of the dip while the layers are flying.
  useEffect(() => {
    navigation.setOptions({
      headerLeft:
        !editMode && !titleOverview
          ? () => (
              <Animated.View style={headerFadeStyle}>
                <IconButton
                  icon="chevron-left"
                  size={30}
                  iconColor={palette.headerTint}
                  style={{ margin: 0, width: 30, height: 30 }}
                  accessibilityLabel={t("nav.back_to_locations")}
                  onPress={goToOverview}
                />
              </Animated.View>
            )
          : undefined,
      headerTitle: () => (
        <Animated.View style={headerFadeStyle}>
          <Pressable onPress={handleTitlePress} disabled={editMode || titleOverview}>
            {!editMode && titleOverview ? (
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
        </Animated.View>
      ),
    });
  }, [
    navigation,
    editMode,
    titleOverview,
    activeLocation?.name,
    zones.length,
    locationCount,
    palette.headerTint,
    headerFadeStyle,
    t,
    goToOverview,
  ]);

  // Opening a location: the map is placed on the tapped tile at the size the
  // plan is drawn there, then flown up to full screen — the tile and the map
  // are the same drawing, so this is a change of distance, not of screen.
  const handleSelectLocation = async (locationId: string, planRect: Rect | null) => {
    const outline = useAppStore.getState().locations.find((l) => l.id === locationId)?.outline;
    const start =
      planRect && containerRect.current && outline
        ? locationFlightStart(planRect, containerRect.current, outline)
        : null;

    if (!start) {
      // Nothing measured to fly from: open it the plain way.
      await setActiveLocation(locationId);
      return;
    }

    // Seeded before the map layer mounts, so its very first frame already sits
    // on the tile instead of appearing full-screen for a frame.
    mapScale.value = start.scale;
    mapX.value = start.x;
    mapY.value = start.y;
    mapOpacity.value = 1;
    gridScale.value = 1;
    gridOpacity.value = 1;
    gridOriginX.value = start.x;
    gridOriginY.value = start.y;
    setTransition("enter");
    beginTitleSwap(false);
    // Covers the store call below failing outright: the flight would never
    // start, and the layers must not be left stuck mid-transition.
    armTransitionEnd(2000);

    // Awaited: the map has to mount with the new location's zones already in
    // place, or the flight would carry the previous location's layout up.
    await setActiveLocation(locationId);

    const config = { duration: LOCATION_ENTER_DURATION, easing: LOCATION_ENTER_EASING };
    mapScale.value = withTiming(1, config);
    mapX.value = withTiming(0, config);
    mapY.value = withTiming(0, config);
    gridScale.value = withTiming(GRID_RECEDE_SCALE, config);
    // Clears out ahead of the map landing, so the last stretch of the flight is
    // over an empty background rather than a still-visible grid.
    gridOpacity.value = withTiming(0, {
      duration: GRID_FADE_DURATION,
      easing: GRID_FADE_EASING,
    });
    armTransitionEnd(LOCATION_ENTER_DURATION);
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
    <View
      ref={containerRef}
      onLayout={handleContainerLayout}
      style={[styles.container, { backgroundColor: palette.background }]}
    >
      {/* Both layers are mounted together only while a flight is running. The
          grid is rendered first so the map sits above it: on the way in the map
          grows out of the tile it's covering, on the way out it dissolves off
          the top. Only transforms are animated on the map layer, so it stays
          laid out at full size — the ZoomableContainer measures itself
          correctly whatever the flight is doing (keeps #6 and #B fixed). */}
      {(overviewMode || transition === "enter") && (
        <Animated.View
          style={[StyleSheet.absoluteFill, gridFlightStyle]}
          pointerEvents={transition === null ? "auto" : "none"}
        >
          <LocationsOverview
            onSelectLocation={handleSelectLocation}
            onCreateNew={() => setAddLocationVisible(true)}
          />
        </Animated.View>
      )}

      {(!overviewMode || transition === "exit") && (
        <Animated.View
          style={[StyleSheet.absoluteFill, mapFlightStyle]}
          pointerEvents={transition === null ? "auto" : "none"}
        >
          {/* One-finger pan works in edit mode too now that moving a zone requires
              a press-and-hold to pick it up first (the canvas stands down while a
              zone is grabbed). */}
          <ZoomableContainer ref={zoomRef} panMinPointers={1}>
            <VanLayoutSVG onZonePress={handleZonePress} onEditInscription={setEditingSide} />
          </ZoomableContainer>
        </Animated.View>
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
