import React from "react";
import { StyleSheet, View } from "react-native";
import { Gesture, GestureDetector } from "react-native-gesture-handler";
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  useAnimatedReaction,
  runOnJS,
  withTiming,
  SharedValue,
} from "react-native-reanimated";
import { ZoneWithCount, Zone } from "../db/database";
import { usePanLock, useMultiTouch } from "./ZoomableContainer";
import {
  ZONE_SNAP_THRESHOLD_PX,
  ZONE_SNAP_GAP_SVG,
  ZONE_GRAB_DELAY_MS,
} from "./layoutConstants";
import { triggerHaptic } from "../utils/haptics";

const HANDLE_SIZE = 24;
const HANDLE_BORDER = 2;
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

function ZoneEditOverlayInner({
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
  // Goes true as soon as a second finger is on the canvas (anywhere, not just
  // on this zone): that's a pinch, so a grabbed zone lets go — see `grab*`.
  const multiTouch = useMultiTouch();

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

  // Whether the current gesture actually picked the zone up (reached onStart
  // with a single finger), and whether it was then called off by a second
  // finger. A called-off gesture puts the zone back where it was and commits
  // nothing, so zooming over a zone can't nudge it by accident.
  const grabbed = useSharedValue(false);
  const grabCancelled = useSharedValue(false);

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

  // Shared start/stop logic for the three gestures below.
  const beginGrab = () => {
    "worklet";
    // Another of this zone's gestures already holds it (body vs. a handle).
    if (grabbed.value) return false;
    grabbed.value = false;
    grabCancelled.value = false;
    // The second finger may already be down by the time the hold elapses.
    if (multiTouch?.value) return false;
    startX.value = svgX.value;
    startY.value = svgY.value;
    startW.value = svgW.value;
    startH.value = svgH.value;
    grabbed.value = true;
    runOnJS(triggerHaptic)();
    dragActive.value = withTiming(1, { duration: 120 });
    if (panLock) panLock.value = true;
    return true;
  };

  // Restores the pre-gesture geometry and drops the zone.
  const releaseGrab = (restore: boolean) => {
    "worklet";
    if (grabbed.value && restore) {
      svgX.value = startX.value;
      svgY.value = startY.value;
      svgW.value = startW.value;
      svgH.value = startH.value;
    }
    grabbed.value = false;
    dragActive.value = withTiming(0, { duration: 150 });
    if (panLock) panLock.value = false;
  };

  // Called on every update: true if the gesture should keep going. Checks the
  // canvas-wide flag *and* this gesture's own pointer count, since which of
  // the two sees the second finger depends on where it lands and the platform.
  const keepGrab = (numberOfPointers: number) => {
    "worklet";
    if (!grabbed.value || grabCancelled.value) return false;
    if (numberOfPointers > 1 || multiTouch?.value) {
      grabCancelled.value = true;
      releaseGrab(true);
      return false;
    }
    return true;
  };

  const endGrab = (success: boolean) => {
    "worklet";
    // multiTouch is a backstop for the reaction below: the order in which
    // the canvas' touch tracker and this gesture hear about lifted fingers
    // isn't guaranteed.
    if (success && grabbed.value && !grabCancelled.value && !multiTouch?.value) {
      runOnJS(commitGeometry)(
        svgX.value,
        svgY.value,
        svgW.value,
        svgH.value
      );
    }
  };

  // The usual pinch posture is a thumb resting still on a zone while the other
  // finger moves — the zone's own gesture then gets no update to notice the
  // second finger in. Reacting to the canvas-wide flag directly covers that.
  useAnimatedReaction(
    () => multiTouch?.value ?? false,
    (isMulti) => {
      if (isMulti && grabbed.value && !grabCancelled.value) {
        grabCancelled.value = true;
        releaseGrab(true);
      }
    }
  );

  // Always drop the zone back down and release the canvas lock, even if the
  // gesture is cancelled or interrupted before onEnd. Anything not committed
  // goes back to where it started.
  const finalizeGrab = (success: boolean) => {
    "worklet";
    const committed = success && !grabCancelled.value;
    if (grabbed.value) releaseGrab(!committed);
    grabCancelled.value = false;
  };

  // --- Drag gesture (move entire zone) ---
  // Requires a short press-and-hold before it activates, so a single-finger
  // touch that's really meant for panning/zooming the canvas doesn't drag a
  // zone by accident. The zone visibly lifts once the hold registers.
  const dragGesture = Gesture.Pan()
    .activateAfterLongPress(ZONE_GRAB_DELAY_MS)
    .maxPointers(1)
    .onStart(() => {
      beginGrab();
    })
    .onUpdate((e) => {
      if (!keepGrab(e.numberOfPointers)) return;
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
    .onEnd((_e, success) => {
      endGrab(success);
    })
    .onFinalize((_e, success) => {
      finalizeGrab(success);
    });

  // --- Resize gesture (bottom-right handle) ---
  // Same press-and-hold gate (and second-finger cancel) as the move gesture,
  // so a touch meant for panning/zooming the canvas doesn't start a resize by
  // accident.
  const resizeGesture = Gesture.Pan()
    .activateAfterLongPress(ZONE_GRAB_DELAY_MS)
    .maxPointers(1)
    .onStart(() => {
      beginGrab();
    })
    .onUpdate((e) => {
      if (!keepGrab(e.numberOfPointers)) return;
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
    .onEnd((_e, success) => {
      endGrab(success);
    })
    .onFinalize((_e, success) => {
      finalizeGrab(success);
    });

  // --- Resize gesture (top-left handle) ---
  const resizeTLGesture = Gesture.Pan()
    .activateAfterLongPress(ZONE_GRAB_DELAY_MS)
    .maxPointers(1)
    .onStart(() => {
      beginGrab();
    })
    .onUpdate((e) => {
      if (!keepGrab(e.numberOfPointers)) return;
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
    .onEnd((_e, success) => {
      endGrab(success);
    })
    .onFinalize((_e, success) => {
      finalizeGrab(success);
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

  // The handles sit inside the zoomed canvas, so every dimension is divided by
  // the live zoom: the dot then keeps a constant on-screen size (and touch
  // target) at any zoom level, instead of a 24pt circle rendering at 96pt at
  // max zoom and swallowing the very corner it's meant to grab.
  //
  // Deliberately done with real layout dimensions rather than an inverse
  // `transform: [{ scale: 1 / zoom }]`: a layer that carries a shrinking scale
  // is rasterised at its shrunken size and then blown back up by the canvas
  // transform, so at 4x zoom the dot was drawn from ~6pt of source and looked
  // like a pixelated blob. Sizing the box for real leaves the circle on the
  // compositor's analytic path (the same one that keeps the solid zone borders
  // sharp when zoomed), so it stays crisp.

  // Bottom-right handle
  const brHandleStyle = useAnimatedStyle(() => {
    const size = HANDLE_SIZE / zoomScale.value;
    return {
      position: "absolute" as const,
      left: (svgX.value + svgW.value) * fitScale + offsetX - size / 2,
      top: (svgY.value + svgH.value) * fitScale + offsetY - size / 2,
      width: size,
      height: size,
      borderRadius: size / 2,
      borderWidth: HANDLE_BORDER / zoomScale.value,
    };
  });

  // Top-left handle
  const tlHandleStyle = useAnimatedStyle(() => {
    const size = HANDLE_SIZE / zoomScale.value;
    return {
      position: "absolute" as const,
      left: svgX.value * fitScale + offsetX - size / 2,
      top: svgY.value * fitScale + offsetY - size / 2,
      width: size,
      height: size,
      borderRadius: size / 2,
      borderWidth: HANDLE_BORDER / zoomScale.value,
    };
  });

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

      {/* Top-left resize handle. The gesture target *is* the dot: a nested
          fixed-size child would need its own zoom-compensated dimensions for
          no benefit. */}
      <GestureDetector gesture={resizeTLGesture}>
        <Animated.View
          style={[styles.handle, { backgroundColor: zone.color }, tlHandleStyle]}
        />
      </GestureDetector>

      {/* Bottom-right resize handle */}
      <GestureDetector gesture={resizeGesture}>
        <Animated.View
          style={[styles.handle, { backgroundColor: zone.color }, brHandleStyle]}
        />
      </GestureDetector>
    </>
  );
}

// Memoized, mirroring OutlineEditOverlay: without this, every zone re-rendered
// (and, before VanLayoutSVG's otherZonesByZoneId memo, rebuilt its `otherZones`
// array) whenever VanLayoutSVG re-rendered for any reason — a gesture-only
// update elsewhere, a layout change — not just when this zone's own props
// changed.
export const ZoneEditOverlay = React.memo(ZoneEditOverlayInner);

const styles = StyleSheet.create({
  dragBody: {
    flex: 1,
    borderWidth: 2,
    borderStyle: "dashed",
    borderRadius: 8,
    backgroundColor: "rgba(255,255,255,0.1)",
  },
  // Overlaid solid ring + shadow that opacity-fades in when the zone is grabbed.
  // `boxShadow`, not shadow*/elevation: the fill is translucent, so iOS can't
  // derive a shadowPath and falls back to a per-pixel offscreen shadow (and
  // logs an "(ADVICE) ... cannot calculate shadow efficiently" warning for
  // every zone). boxShadow is drawn from the border path regardless of the
  // background. Blur is 2× the old shadowRadius since RN maps
  // shadowRadius = blur / 2 on iOS.
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
    boxShadow: "0px 6px 28px rgba(0, 0, 0, 0.35)",
  },
  // Size, radius and border width are zoom-compensated in the animated style;
  // only the colour lives here. No `opacity`: a translucent layer can be
  // composited off-screen, which is exactly the bitmap round-trip the sizing
  // above avoids, and 0.9 vs 1.0 on a solid dot isn't worth it.
  handle: {
    borderColor: "#FFFFFF",
  },
});
