import { useEffect, useRef, useState, useCallback } from "react";
import { View, StyleSheet, Pressable, BackHandler, AppState } from "react-native";
import { useRouter, useNavigation, useFocusEffect } from "expo-router";
import { FAB, Text, Button, IconButton } from "react-native-paper";
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withTiming,
  withDelay,
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
  FlightStart,
  locationFlightStart,
  LOCATION_ENTER_DURATION,
  LOCATION_ENTER_EASING,
  LOCATION_EXIT_DURATION,
  LOCATION_EXIT_EASING,
  GRID_RECEDE_SCALE,
  GRID_RETURN_SCALE,
  GRID_FADE_DURATION,
  GRID_FADE_EASING,
  LOCATION_RETURN_DURATION,
  LOCATION_RETURN_EASING,
  GRID_RETURN_FADE_DELAY,
  GRID_RETURN_FADE_EASING,
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
import { BackupReminderDialog } from "../src/components/dialogs/BackupReminderDialog";
import { EditInscriptionDialog } from "../src/components/dialogs/EditInscriptionDialog";
import { plusIcon, tagFabStyle, FAB_RADIUS_SMALL } from "../src/components/AddFab";
import { Season, LabelSide, LabelDef } from "../src/db/database";
import { listItemsWithExpiration } from "../src/db/repository";
import { getExpirationStatus } from "../src/utils/expiration";
import { DEFAULT_CANVAS_H } from "../src/components/layoutConstants";
import { triggerHaptic } from "../src/utils/haptics";

const DIVE_FADE_PEAK = 0.5;
// A startup still unfinished after this long isn't slow, it's stuck — a
// database call that will never come back takes the whole startup sequence
// with it (see resetDbConnection), and this screen would sit blank for as long
// as the app stayed open. Long enough that a cold start with a migration to
// run never trips it.
const STARTUP_STALL_MS = 8000;
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
  const retryInit = useAppStore((s) => s.retryInit);
  const zones = useAppStore((s) => s.zones);
  const addZone = useAppStore((s) => s.addZone);
  const addItem = useAppStore((s) => s.addItem);
  const editMode = useAppStore((s) => s.editMode);
  const toggleEditMode = useAppStore((s) => s.toggleEditMode);
  const requestDiscard = useAppStore((s) => s.requestDiscard);
  const expirationAlertShown = useAppStore((s) => s.expirationAlertShown);
  const setExpirationAlertShown = useAppStore((s) => s.setExpirationAlertShown);
  const checkBackupReminder = useAppStore((s) => s.checkBackupReminder);
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
  // Startup that never arrived, and the retries offered for it (see below).
  const [startupStalled, setStartupStalled] = useState(false);
  const [startupAttempt, setStartupAttempt] = useState(0);
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
  // The flight the current location was opened with, so leaving can retrace it
  // back onto the same tile. Null when it was opened without one.
  const lastFlight = useRef<{ locationId: string; start: FlightStart } | null>(null);
  const transitionTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Identifies the flight that owns the layers. Bumped when one starts, and by
  // the recovery below — so a flight that has to wait on the database before it
  // can animate (see handleSelectLocation) can tell, when it resumes, whether
  // it is still the one in charge, and keep its hands off the layers if not.
  const flightSeq = useRef(0);

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

  // Whether the shared values below get any say in how the layers look. They
  // live outside React, so anything that interrupts a flight can strand them
  // part-way through a move — and a layer stranded at opacity 0 is a main
  // screen that is simply blank: no tiles, nothing to pull on, and no way back
  // short of restarting the app. So they're only read while a flight is
  // actually running; the rest of the time both styles state the resting
  // values outright, and whatever the shared values happen to hold is
  // irrelevant. (Each flight seeds every value it animates before it starts, so
  // none of them depend on having been left tidy.)
  //
  // Read from the render rather than mirrored into a shared value on purpose:
  // it puts the decision on the React state that also decides which layers are
  // mounted, where it can't itself get stranded.
  const flying = transition !== null;

  const mapFlightStyle = useAnimatedStyle(() =>
    flying
      ? {
          opacity: mapOpacity.value,
          transform: [
            { translateX: mapX.value },
            { translateY: mapY.value },
            { scale: mapScale.value },
          ],
        }
      : { opacity: 1, transform: [] }
  );

  // Scale about the tapped tile rather than the layer's own center: shift the
  // origin there, scale, shift back.
  const gridFlightStyle = useAnimatedStyle(() =>
    flying
      ? {
          opacity: gridOpacity.value,
          transform: [
            { translateX: gridOriginX.value },
            { translateY: gridOriginY.value },
            { scale: gridScale.value },
            { translateX: -gridOriginX.value },
            { translateY: -gridOriginY.value },
          ],
        }
      : { opacity: 1, transform: [] }
  );

  const restLayers = useCallback(() => {
    mapScale.value = 1;
    mapX.value = 0;
    mapY.value = 0;
    mapOpacity.value = 1;
    gridScale.value = 1;
    gridOpacity.value = 1;
    gridOriginX.value = 0;
    gridOriginY.value = 0;
  }, []);

  // Both layers return to their resting values whenever nothing is running.
  // An effect (rather than the animation's completion callback) because it
  // fires after the commit that unmounts the outgoing layer — so resetting the
  // map's opacity here can't flash it back into view, and the map can never be
  // left stranded faded out the way the old fade transition sometimes was.
  useEffect(() => {
    if (transition !== null) return;
    restLayers();
  }, [transition, restLayers]);

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

  // Leaving retraces the flight that opened the location: the map shrinks back
  // down onto its tile while the grid falls back in around that same point, at
  // the same duration with mirrored easing, so the two directions are one move
  // and its undo rather than two unrelated effects.
  //
  // Without a flight to retrace (opened from the overview's menu, at startup,
  // just created) there's no tile to aim at, so it falls back to the plain
  // dismissal: the map falls away as the grid rises to meet it.
  const goToOverview = useCallback(() => {
    if (overviewMode || editMode) return;
    const activeId = useAppStore.getState().activeLocationId;
    const back =
      lastFlight.current && lastFlight.current.locationId === activeId
        ? lastFlight.current.start
        : null;

    flightSeq.current++;

    if (back) {
      // The grid starts where the entry left it — receded, invisible, about the
      // same vanishing point — and comes back from there. Set before the state
      // change that mounts it, so its first frame is never the resting state.
      gridScale.value = GRID_RECEDE_SCALE;
      gridOpacity.value = 0;
      gridOriginX.value = back.x;
      gridOriginY.value = back.y;
      // The map is on screen at full size, so that is where the return starts
      // from. Stated rather than assumed: an interrupted flight can leave these
      // holding stale values (the resting render ignores them, so nothing shows
      // it), and animating out of those would fling the map in from nowhere.
      mapScale.value = 1;
      mapX.value = 0;
      mapY.value = 0;

      setTransition("exit");
      setOverviewMode(true);
      beginTitleSwap(true);

      const config = {
        duration: LOCATION_RETURN_DURATION,
        easing: LOCATION_RETURN_EASING,
      };
      mapScale.value = withTiming(back.scale, config);
      mapX.value = withTiming(back.x, config);
      mapY.value = withTiming(back.y, config);
      mapOpacity.value = 1;
      gridScale.value = withTiming(1, config);
      gridOpacity.value = withDelay(
        GRID_RETURN_FADE_DELAY,
        withTiming(1, { duration: GRID_FADE_DURATION, easing: GRID_RETURN_FADE_EASING })
      );
      armTransitionEnd(LOCATION_RETURN_DURATION);
      return;
    }

    gridScale.value = GRID_RETURN_SCALE;
    gridOpacity.value = 0;
    gridOriginX.value = 0;
    gridOriginY.value = 0;
    mapScale.value = 1;
    mapX.value = 0;
    mapY.value = 0;
    mapOpacity.value = 1;

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

  // Nothing can legitimately be mid-flight while this screen isn't the one the
  // user is looking at: the layers only ever move in answer to a tap here, and
  // both are untouchable (pointerEvents="none") for as long as they do. So
  // "at rest" is always the right state to force whenever we can't be sure the
  // in-flight animation's own ending will still run — repairing a flight whose
  // timer-based ending never fired. That ending hangs off a setTimeout, and a
  // timer dropped while the screen was off-screen (or the app backgrounded)
  // used to strand `transition` non-null for good: the map frozen at tile size
  // in the corner (its seeded start-of-flight transform) with every layer,
  // gesture and header control dead — or the grid left unmounted/invisible.
  // Resetting the shared values directly rather than through setTransition
  // alone, because when the state is already null there is no re-render to run
  // the effect that does it.
  const recoverTransitionState = useCallback(() => {
    if (transitionTimer.current) {
      clearTimeout(transitionTimer.current);
      transitionTimer.current = null;
    }
    if (titleTimer.current) {
      clearTimeout(titleTimer.current);
      titleTimer.current = null;
    }
    // Takes the layers away from whichever flight held them: one that is
    // waiting on the database mid-take-off would otherwise resume afterwards
    // and re-apply its animations onto layers that are supposed to be at rest.
    flightSeq.current++;
    setTransition(null);
    // Read from the store rather than closing over the rendered value: this
    // callback must not take `overviewMode` as a dependency, or entering and
    // leaving a location would re-run it and wipe out the very flight that
    // changed the mode.
    setTitleOverview(useAppStore.getState().overviewMode);
    headerOpacity.value = 1;
    restLayers();
  }, [restLayers]);

  // Reverses the "dive into zone" effect when returning to this screen (e.g.
  // navigating back from the zone screen). Executed on screen focus so the
  // color overlay smoothly fades back to transparent and zoom is reset.
  useFocusEffect(
    useCallback(() => {
      recoverTransitionState();

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
    }, [diveOpacity, recoverTransitionState])
  );

  // Navigation focus alone doesn't cover every way this screen's JS can get
  // interrupted mid-flight: locking the phone, a call, or switching apps while
  // `transition` is "enter"/"exit" suspends the timer that would otherwise
  // clear it, and none of that involves leaving the `index` route, so
  // useFocusEffect never re-fires to repair it. Reusing the same recovery on
  // the next foreground catches that gap too.
  useEffect(() => {
    const sub = AppState.addEventListener("change", (state) => {
      if (state === "active") recoverTransitionState();
    });
    return () => sub.remove();
  }, [recoverTransitionState]);

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
                  size={36}
                  iconColor={palette.headerTint}
                  style={{ margin: 0, width: 36, height: 36 }}
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
                  style={{ color: palette.headerTint, fontWeight: "bold", fontSize: 22 }}
                  numberOfLines={1}
                >
                  {t("nav.app_title")}
                </Text>
                <Text
                  style={{ color: palette.headerTint, opacity: 0.8, fontSize: 14 }}
                  numberOfLines={1}
                >
                  {t("nav.location_count", { count: locationCount })}
                </Text>
              </View>
            ) : editMode ? (
              <Text
                style={{ color: palette.headerTint, fontWeight: "bold", fontSize: 22 }}
                numberOfLines={1}
              >
                {t("nav.edit_mode")}
              </Text>
            ) : (
              // Single location: location name as the title, zone count as a
              // subtitle beneath it.
              <View>
                <Text
                  style={{ color: palette.headerTint, fontWeight: "bold", fontSize: 22 }}
                  numberOfLines={1}
                >
                  {t("nav.app_title_named", { name: activeLocation?.name ?? "" })}
                </Text>
                <Text
                  style={{ color: palette.headerTint, opacity: 0.8, fontSize: 14 }}
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
  //
  // useCallback'd (along with the other handlers below passed down to
  // LocationsOverview/VanLayoutSVG): a plain inline function here gets a new
  // identity every render of this screen, which is disproportionately often
  // during a flight/dive (shared-value-driven re-renders, focus effects).
  const handleSelectLocation = useCallback(async (locationId: string, planRect: Rect | null) => {
    const outline = useAppStore.getState().locations.find((l) => l.id === locationId)?.outline;
    const start =
      planRect && containerRect.current && outline
        ? locationFlightStart(planRect, containerRect.current, outline)
        : null;

    if (!start) {
      // Nothing measured to fly from: open it the plain way, and leave nothing
      // for the return to retrace.
      lastFlight.current = null;
      await setActiveLocation(locationId);
      return;
    }

    // Kept so leaving can play this same flight backwards.
    lastFlight.current = { locationId, start };
    const seq = ++flightSeq.current;

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

    // Somebody else has taken the layers over during that wait — a newer tap,
    // or the recovery below putting everything back at rest. Taking off now
    // would animate layers that are no longer ours: at best it fights the newer
    // flight, at worst (nothing running any more, so no ending left to clean up
    // after it) it leaves the overview faded to nothing, with the "flight over"
    // reset that would have restored it never firing again.
    if (seq !== flightSeq.current) return;

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
  }, [setActiveLocation, beginTitleSwap, armTransitionEnd]);

  const handleCreateLocation = async (name: string, templateId: string, icon: string) => {
    await addLocation(name, templateId, icon);
    setAddLocationVisible(false);
  };

  const handleZonePress = useCallback(
    (zoneId: string, rect: ZoneScreenRect) => {
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
    },
    [zones, router, diveOpacity]
  );

  // A deliberate hold anywhere on the map drops into edit mode to move/resize
  // its zones (reshaping the outline itself is reached from the locations
  // overview menu). Recognized by the canvas' own gesture composition rather
  // than a detector nested inside it — see ZoomableContainer's `composed`.
  const handleCanvasLongPress = useCallback(() => {
    triggerHaptic();
    toggleEditMode();
  }, [toggleEditMode]);

  // Watches for a startup that never lands. Re-armed on every attempt, and
  // stood down the moment the data is in, so it only ever speaks up when this
  // screen would otherwise be showing nothing at all.
  useEffect(() => {
    if (initialized) return;
    setStartupStalled(false);
    const timer = setTimeout(() => setStartupStalled(true), STARTUP_STALL_MS);
    return () => clearTimeout(timer);
  }, [initialized, startupAttempt]);

  const handleRetryInit = useCallback(() => {
    setStartupAttempt((n) => n + 1);
    retryInit();
  }, [retryInit]);

  // Shown once per app launch: surfaces items that are already expired or
  // expiring soon, right after the data has finished loading.
  //
  // Deferred behind requestIdleCallback so this query doesn't compete with
  // the first screen's own startup queries on the serialized DB queue (see
  // withDb) — the first paint happens sooner, and this alert (a one-per-
  // launch nicety, not something the user is waiting on) arrives a beat
  // later instead.
  useEffect(() => {
    if (!initialized || expirationAlertShown) return;
    setExpirationAlertShown(true);
    const handle = requestIdleCallback(() => {
      listItemsWithExpiration().then((items) => {
        const hasUrgent = items.some(
          (item) => getExpirationStatus(item.expiration_date as string, item.reminder_days) !== "ok"
        );
        if (hasUrgent) setStartupOverviewVisible(true);
        // The other launch-time prompt. Both are dialogs, so they're sequenced
        // rather than stacked: the backup reminder waits for the expiration
        // overview to be closed (see onDismiss below).
        else checkBackupReminder();
      });
    });
    return () => cancelIdleCallback(handle);
  }, [initialized, expirationAlertShown]);

  // Edit mode and the overview both hide the FAB; close it too, for two
  // reasons. It mustn't reappear already-open the next time it's shown — and,
  // more importantly, an open speed dial lays a full-screen backdrop over
  // everything, whose touch handling follows `open` alone and ignores
  // `visible`. Left open on the way to the overview, that invisible sheet
  // swallows every tap and pull the locations grid should have received.
  useEffect(() => {
    if (editMode || overviewMode) setFabOpen(false);
  }, [editMode, overviewMode]);

  // Android's back button/gesture is the other way out of an edit session, and
  // this is the root screen — left alone it would drop the changes on the way
  // to backgrounding the app. Route it through the same confirmation as the
  // header's ✕. Registered on focus so it can't outlive the screen; only while
  // editing, so back behaves normally everywhere else.
  useFocusEffect(
    useCallback(() => {
      if (!editMode) return;
      const sub = BackHandler.addEventListener("hardwareBackPress", () => {
        requestDiscard();
        return true;
      });
      return () => sub.remove();
    }, [editMode, requestDiscard])
  );

  // These four (like handleSelectLocation/handleZonePress above) are
  // useCallback'd rather than plain functions, and defined here — above the
  // early returns below — rather than at their original spot after them,
  // since a hook can't run conditionally: it has to execute on every render
  // in the same order, including the renders that bail out early below.
  const handleCreateZone = useCallback(
    async (name: string, color: string, checklist: boolean) => {
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
    },
    [activeLocation, zones, addZone]
  );

  const handleCreateItem = useCallback(
    async (
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
    },
    [addItem, router]
  );

  const handleSaveLabel = useCallback(
    (side: LabelSide, def: LabelDef) => {
      if (activeLocation) updateLocationLabel(activeLocation.id, side, def);
      setEditingSide(null);
    },
    [activeLocation, updateLocationLabel]
  );
  const handleResetLabel = useCallback(
    (side: LabelSide) => {
      if (activeLocation) resetLocationLabel(activeLocation.id, side);
      setEditingSide(null);
    },
    [activeLocation, resetLocationLabel]
  );

  // Both ways startup can fail the user land here: it reported an error, or it
  // never came back at all. The second used to be indistinguishable from a very
  // slow launch — a blank screen with nothing on it to press — so it stayed
  // blank until the app was killed and started again. That's what this offers
  // instead, without leaving the app.
  if (initError || (!initialized && startupStalled)) {
    return (
      <View style={[styles.container, styles.centered, { backgroundColor: palette.background }]}>
        <Text style={{ color: palette.onSurface, textAlign: "center", marginBottom: 16 }}>
          {t(initError ? "startup.error" : "startup.stalled")}
        </Text>
        <Button mode="contained" onPress={handleRetryInit}>
          {t("startup.retry")}
        </Button>
      </View>
    );
  }

  if (!initialized) {
    return <View style={[styles.container, { backgroundColor: palette.background }]} />;
  }

  // --- Orientation inscriptions (front/rear/left/right labels on the plan) ---
  const labels = activeLocation?.labels ?? {};
  // front/rear have a built-in default; left/right have none.
  const inscriptionDefault = (side: LabelSide): string | null =>
    side === "front" ? t("map.front") : side === "rear" ? t("map.rear") : null;

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
          <ZoomableContainer
            ref={zoomRef}
            panMinPointers={1}
            onLongPress={handleCanvasLongPress}
            longPressEnabled={!editMode}
          >
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
            backgroundColor: palette.headerBackground,
            shadowColor: palette.headerBackground,
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
        onDismiss={() => {
          setStartupOverviewVisible(false);
          checkBackupReminder();
        }}
      />

      <BackupReminderDialog />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  centered: { justifyContent: "center", alignItems: "center", padding: 24 },
});
