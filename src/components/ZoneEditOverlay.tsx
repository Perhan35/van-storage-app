import React from "react";
import { StyleSheet, View } from "react-native";
import { Gesture, GestureDetector } from "react-native-gesture-handler";
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  runOnJS,
  withTiming,
  SharedValue,
} from "react-native-reanimated";
import { ZoneWithCount, Zone } from "../db/database";
import { usePanLock } from "./ZoomableContainer";
import { ZONE_SNAP_THRESHOLD_PX, ZONE_SNAP_GAP_SVG } from "./layoutConstants";
import { triggerHaptic } from "../utils/haptics";

const HANDLE_SIZE = 24;
const MIN_ZONE_SIZE_SVG = 30;

// --- Edge-snapping helpers (run on the UI thread inside gesture worklets) ---
//
// For one axis, "main" is the axis being moved (e.g. x while dragging
// horizontally) and "cross" is the other one (e.g. y), used only to decide
// whether two zones are actually side by side before offering an adjacency
// snap - otherwise a zone on the other side of the van could snap to an
// unrelated edge just because the numbers line up.

function startSnapCandidates(
  mainOthers: [number, number][],
  crossOthers: [number, number][],
  crossStart: number,
  crossEnd: number,
  gap: number
): number[] {
  "worklet";
  const candidates: number[] = [];
  for (let i = 0; i < mainOthers.length; i++) {
    const [os, oe] = mainOthers[i];
    candidates.push(os); // flush alignment: our start matches their start
    const [cs, ce] = crossOthers[i];
    if (crossStart < ce && cs < crossEnd) {
      candidates.push(oe + gap); // adjacency: we start right after them
    }
  }
  return candidates;
}

function endSnapCandidates(
  mainOthers: [number, number][],
  crossOthers: [number, number][],
  crossStart: number,
  crossEnd: number,
  gap: number
): number[] {
  "worklet";
  const candidates: number[] = [];
  for (let i = 0; i < mainOthers.length; i++) {
    const [os, oe] = mainOthers[i];
    candidates.push(oe); // flush alignment: our end matches their end
    const [cs, ce] = crossOthers[i];
    if (crossStart < ce && cs < crossEnd) {
      candidates.push(os - gap); // adjacency: we end right before them
    }
  }
  return candidates;
}

function snapToNearest(
  value: number,
  candidates: number[],
  threshold: number
): number {
  "worklet";
  let best = value;
  let bestDist = threshold;
  for (let i = 0; i < candidates.length; i++) {
    const dist = Math.abs(candidates[i] - value);
    if (dist < bestDist) {
      bestDist = dist;
      best = candidates[i];
    }
  }
  return best;
}

type Props = {
  zone: ZoneWithCount;
  // Fixed SVG-to-screen fit scale (from the viewBox fit, ignores pinch zoom).
  fitScale: number;
  // Live pinch-zoom level applied on top of fitScale by the ancestor
  // ZoomableContainer. Read directly in gesture worklets so drag/resize
  // math stays accurate while the user is actively zooming.
  zoomScale: SharedValue<number>;
  offsetX: number;
  offsetY: number;
  // Allowed geometry range for this location's canvas (size + overflow margin).
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
  otherZones: Zone["geometry"][];
  onGeometryChange: (zoneId: string, geometry: Zone["geometry"]) => void;
};

export function ZoneEditOverlay({
  zone,
  fitScale,
  zoomScale,
  offsetX,
  offsetY,
  minX,
  maxX,
  minY,
  maxY,
  otherZones,
  onGeometryChange,
}: Props) {
  const { x, y, w, h } = zone.geometry;

  // While this zone is picked up, the ancestor canvas pan stands down so a
  // one-finger drag moves the zone, not the whole map.
  const panLock = usePanLock();

  // Other zones' edges, split by axis, recomputed whenever the set of
  // zones or their geometry changes (used inside the gesture worklets).
  const othersX: [number, number][] = otherZones.map((o) => [o.x, o.x + o.w]);
  const othersY: [number, number][] = otherZones.map((o) => [o.y, o.y + o.h]);

  // Shared values track the current SVG-coordinate geometry during gestures
  const svgX = useSharedValue(x);
  const svgY = useSharedValue(y);
  const svgW = useSharedValue(w);
  const svgH = useSharedValue(h);

  // Saved values at gesture start
  const startX = useSharedValue(x);
  const startY = useSharedValue(y);
  const startW = useSharedValue(w);
  const startH = useSharedValue(h);

  // 0 = idle, 1 = zone is "picked up" (long-press held) and moving. Drives the
  // lift feedback so it's obvious the zone is now grabbed vs. just tapped.
  const dragActive = useSharedValue(0);

  // Sync when zone prop changes (e.g. after DB update)
  React.useEffect(() => {
    svgX.value = zone.geometry.x;
    svgY.value = zone.geometry.y;
    svgW.value = zone.geometry.w;
    svgH.value = zone.geometry.h;
  }, [zone.geometry.x, zone.geometry.y, zone.geometry.w, zone.geometry.h]);

  const commitGeometry = (nx: number, ny: number, nw: number, nh: number) => {
    const w = Math.min(Math.max(MIN_ZONE_SIZE_SVG, nw), maxX - minX);
    const h = Math.min(Math.max(MIN_ZONE_SIZE_SVG, nh), maxY - minY);
    const x = Math.min(Math.max(minX, nx), maxX - w);
    const y = Math.min(Math.max(minY, ny), maxY - h);
    onGeometryChange(zone.id, {
      type: "rect",
      x: Math.round(x),
      y: Math.round(y),
      w: Math.round(w),
      h: Math.round(h),
    });
  };

  // --- Drag gesture (move entire zone) ---
  // Requires a short press-and-hold before it activates, so a single-finger
  // touch that's really meant for panning/zooming the canvas doesn't drag a
  // zone by accident. The zone visibly lifts once the hold registers.
  const dragGesture = Gesture.Pan()
    .activateAfterLongPress(250)
    .onStart(() => {
      runOnJS(triggerHaptic)();
      startX.value = svgX.value;
      startY.value = svgY.value;
      dragActive.value = withTiming(1, { duration: 120 });
      if (panLock) panLock.value = true;
    })
    .onUpdate((e) => {
      const scale = fitScale * zoomScale.value;
      const dx = e.translationX / scale;
      const dy = e.translationY / scale;
      const w = svgW.value;
      const h = svgH.value;
      const threshold = ZONE_SNAP_THRESHOLD_PX / scale;

      let newX = startX.value + dx;
      let newY = startY.value + dy;

      const xCandidates = startSnapCandidates(
        othersX,
        othersY,
        newY,
        newY + h,
        ZONE_SNAP_GAP_SVG
      ).concat(
        endSnapCandidates(
          othersX,
          othersY,
          newY,
          newY + h,
          ZONE_SNAP_GAP_SVG
        ).map((c) => c - w)
      );
      newX = snapToNearest(newX, xCandidates, threshold);

      const yCandidates = startSnapCandidates(
        othersY,
        othersX,
        newX,
        newX + w,
        ZONE_SNAP_GAP_SVG
      ).concat(
        endSnapCandidates(
          othersY,
          othersX,
          newX,
          newX + w,
          ZONE_SNAP_GAP_SVG
        ).map((c) => c - h)
      );
      newY = snapToNearest(newY, yCandidates, threshold);

      svgX.value = Math.min(Math.max(minX, newX), maxX - w);
      svgY.value = Math.min(Math.max(minY, newY), maxY - h);
    })
    .onEnd(() => {
      runOnJS(commitGeometry)(
        svgX.value,
        svgY.value,
        svgW.value,
        svgH.value
      );
    })
    .onFinalize(() => {
      // Always drop the zone back down and release the canvas lock, even if the
      // gesture is cancelled or interrupted before onEnd.
      dragActive.value = withTiming(0, { duration: 150 });
      if (panLock) panLock.value = false;
    });

  // --- Resize gesture (bottom-right handle) ---
  // Same press-and-hold gate as the move gesture, so a single-finger touch
  // meant for panning/zooming the canvas doesn't start a resize by accident.
  const resizeGesture = Gesture.Pan()
    .activateAfterLongPress(250)
    .onStart(() => {
      runOnJS(triggerHaptic)();
      startW.value = svgW.value;
      startH.value = svgH.value;
      dragActive.value = withTiming(1, { duration: 120 });
      if (panLock) panLock.value = true;
    })
    .onUpdate((e) => {
      const scale = fitScale * zoomScale.value;
      const dw = e.translationX / scale;
      const dh = e.translationY / scale;
      const x = svgX.value;
      const y = svgY.value;
      const maxW = maxX - x;
      const maxH = maxY - y;
      const threshold = ZONE_SNAP_THRESHOLD_PX / scale;

      const rawW = Math.min(Math.max(MIN_ZONE_SIZE_SVG, startW.value + dw), maxW);
      const rawH = Math.min(Math.max(MIN_ZONE_SIZE_SVG, startH.value + dh), maxH);

      const endXCandidates = endSnapCandidates(
        othersX,
        othersY,
        y,
        y + rawH,
        ZONE_SNAP_GAP_SVG
      );
      const endX = snapToNearest(x + rawW, endXCandidates, threshold);

      const endYCandidates = endSnapCandidates(
        othersY,
        othersX,
        x,
        x + rawW,
        ZONE_SNAP_GAP_SVG
      );
      const endY = snapToNearest(y + rawH, endYCandidates, threshold);

      svgW.value = Math.min(Math.max(MIN_ZONE_SIZE_SVG, endX - x), maxW);
      svgH.value = Math.min(Math.max(MIN_ZONE_SIZE_SVG, endY - y), maxH);
    })
    .onEnd(() => {
      runOnJS(commitGeometry)(
        svgX.value,
        svgY.value,
        svgW.value,
        svgH.value
      );
    })
    .onFinalize(() => {
      dragActive.value = withTiming(0, { duration: 150 });
      if (panLock) panLock.value = false;
    });

  // --- Resize gesture (top-left handle) ---
  const resizeTLGesture = Gesture.Pan()
    .activateAfterLongPress(250)
    .onStart(() => {
      runOnJS(triggerHaptic)();
      startX.value = svgX.value;
      startY.value = svgY.value;
      startW.value = svgW.value;
      startH.value = svgH.value;
      dragActive.value = withTiming(1, { duration: 120 });
      if (panLock) panLock.value = true;
    })
    .onUpdate((e) => {
      const scale = fitScale * zoomScale.value;
      const dx = e.translationX / scale;
      const dy = e.translationY / scale;
      const anchorX = startX.value + startW.value;
      const anchorY = startY.value + startH.value;
      const threshold = ZONE_SNAP_THRESHOLD_PX / scale;

      const rawW = Math.min(
        Math.max(MIN_ZONE_SIZE_SVG, startW.value - dx),
        anchorX - minX
      );
      const rawH = Math.min(
        Math.max(MIN_ZONE_SIZE_SVG, startH.value - dy),
        anchorY - minY
      );
      const rawX = anchorX - rawW;
      const rawY = anchorY - rawH;

      const startXCandidates = startSnapCandidates(
        othersX,
        othersY,
        rawY,
        anchorY,
        ZONE_SNAP_GAP_SVG
      );
      const newX = snapToNearest(rawX, startXCandidates, threshold);

      const startYCandidates = startSnapCandidates(
        othersY,
        othersX,
        rawX,
        anchorX,
        ZONE_SNAP_GAP_SVG
      );
      const newY = snapToNearest(rawY, startYCandidates, threshold);

      const newW = Math.min(
        Math.max(MIN_ZONE_SIZE_SVG, anchorX - newX),
        anchorX - minX
      );
      const newH = Math.min(
        Math.max(MIN_ZONE_SIZE_SVG, anchorY - newY),
        anchorY - minY
      );
      svgX.value = anchorX - newW;
      svgY.value = anchorY - newH;
      svgW.value = newW;
      svgH.value = newH;
    })
    .onEnd(() => {
      runOnJS(commitGeometry)(
        svgX.value,
        svgY.value,
        svgW.value,
        svgH.value
      );
    })
    .onFinalize(() => {
      dragActive.value = withTiming(0, { duration: 150 });
      if (panLock) panLock.value = false;
    });

  // Animated style for the zone body (moves + resizes in real time).
  // Positioned in fit-scale units only - the ancestor ZoomableContainer's
  // transform applies pinch zoom visually on top of this.
  const bodyStyle = useAnimatedStyle(() => ({
    position: "absolute" as const,
    left: svgX.value * fitScale + offsetX,
    top: svgY.value * fitScale + offsetY,
    width: svgW.value * fitScale,
    height: svgH.value * fitScale,
    // Lift the whole zone slightly while it's grabbed.
    transform: [{ scale: 1 + dragActive.value * 0.05 }],
  }));

  // Solid "grabbed" ring that fades in over the resting dashed outline. Only a
  // numeric opacity is animated here (Reanimated 4 can crash when animating
  // string props like borderStyle/backgroundColor on the native side).
  const grabbedRingStyle = useAnimatedStyle(() => ({
    opacity: dragActive.value,
  }));

  // Bottom-right handle
  const brHandleStyle = useAnimatedStyle(() => ({
    position: "absolute" as const,
    left:
      (svgX.value + svgW.value) * fitScale + offsetX - HANDLE_SIZE / 2,
    top:
      (svgY.value + svgH.value) * fitScale + offsetY - HANDLE_SIZE / 2,
    width: HANDLE_SIZE,
    height: HANDLE_SIZE,
  }));

  // Top-left handle
  const tlHandleStyle = useAnimatedStyle(() => ({
    position: "absolute" as const,
    left: svgX.value * fitScale + offsetX - HANDLE_SIZE / 2,
    top: svgY.value * fitScale + offsetY - HANDLE_SIZE / 2,
    width: HANDLE_SIZE,
    height: HANDLE_SIZE,
  }));

  return (
    <>
      {/* Draggable zone body (press and hold to pick up, then drag) */}
      <GestureDetector gesture={dragGesture}>
        <Animated.View style={bodyStyle}>
          <View style={[styles.dragBody, { borderColor: zone.color }]} />
          <Animated.View
            pointerEvents="none"
            style={[styles.grabbedRing, { borderColor: zone.color }, grabbedRingStyle]}
          />
        </Animated.View>
      </GestureDetector>

      {/* Top-left resize handle */}
      <GestureDetector gesture={resizeTLGesture}>
        <Animated.View style={tlHandleStyle}>
          <View style={[styles.handle, { backgroundColor: zone.color }]} />
        </Animated.View>
      </GestureDetector>

      {/* Bottom-right resize handle */}
      <GestureDetector gesture={resizeGesture}>
        <Animated.View style={brHandleStyle}>
          <View style={[styles.handle, { backgroundColor: zone.color }]} />
        </Animated.View>
      </GestureDetector>
    </>
  );
}

const styles = StyleSheet.create({
  dragBody: {
    flex: 1,
    borderWidth: 2,
    borderStyle: "dashed",
    borderRadius: 8,
    backgroundColor: "rgba(255,255,255,0.1)",
  },
  // Overlaid solid ring + shadow that opacity-fades in when the zone is grabbed.
  grabbedRing: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    borderWidth: 2.5,
    borderStyle: "solid",
    borderRadius: 8,
    backgroundColor: "rgba(255,255,255,0.22)",
    shadowColor: "#000000",
    shadowOpacity: 0.35,
    shadowRadius: 14,
    shadowOffset: { width: 0, height: 6 },
    elevation: 10,
  },
  handle: {
    width: HANDLE_SIZE,
    height: HANDLE_SIZE,
    borderRadius: HANDLE_SIZE / 2,
    borderWidth: 2,
    borderColor: "#FFFFFF",
    opacity: 0.9,
  },
});
