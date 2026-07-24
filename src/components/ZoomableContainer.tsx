import React, {
  createContext,
  useContext,
  useEffect,
  forwardRef,
  useImperativeHandle,
} from "react";
import { View, StyleSheet, LayoutChangeEvent } from "react-native";
import { GestureDetector, Gesture } from "react-native-gesture-handler";
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withTiming,
  Easing,
  SharedValue,
} from "react-native-reanimated";

// Screen-pixel rect (relative to the container) of the content region to zoom
// into, expressed in content-space (pre-transform) coordinates.
export type ZoomRect = {
  left: number;
  top: number;
  width: number;
  height: number;
};

// Imperative handle exposed to callers that want to drive the transform
// programmatically (e.g. a "dive into the tapped zone" transition) rather than
// through gestures.
export type ZoomableContainerHandle = {
  // Returns whether the dive animation actually started (false if the
  // container hasn't measured its layout yet, e.g. called before first paint).
  zoomToRect: (rect: ZoomRect) => boolean;
  resetZoom: () => void;
};

type Props = {
  children: React.ReactNode;
  enabled?: boolean;
  // Minimum touch points required to pan the canvas. Callers that also host
  // their own single-finger drag gestures inside the canvas (e.g. zone
  // editing) should raise this so a 1-finger drag isn't stolen by panning.
  panMinPointers?: number;
};

const MIN_SCALE = 0.5;
const MAX_SCALE = 4;

// Extra pan slack (screen px) allowed beyond the content edge, so the van
// layout can be nudged off-center a bit instead of sitting completely flush
// against the container edge even at rest / min zoom.
const PAN_MARGIN = 32;

// Durations for the programmatic dive-in / dive-out animations. Callers that
// coordinate a screen transition around the dive (e.g. overlapping it with a
// navigation fade) can import DIVE_IN_DURATION to stay in sync.
export const DIVE_IN_DURATION = 300;
export const DIVE_OUT_DURATION = 180;
export const DIVE_EASING = Easing.inOut(Easing.cubic);
export const DIVE_OUT_EASING = Easing.out(Easing.quad);

// Live pinch-zoom level, so descendants (e.g. zone edit gesture math) can
// convert screen-pixel deltas to content-space units as the user zooms.
const ZoomScaleContext = createContext<SharedValue<number> | null>(null);

export function useZoomScale() {
  return useContext(ZoomScaleContext);
}

// Set to true by a descendant while it's actively dragging its own content
// (e.g. a zone that's been picked up). The canvas pan stands down whenever
// this is true so the two don't move at the same time.
const PanLockContext = createContext<SharedValue<boolean> | null>(null);

export function usePanLock() {
  return useContext(PanLockContext);
}

function clampTranslate(
  translate: number,
  containerSize: number,
  scale: number
) {
  "worklet";
  const contentSize = containerSize * scale;
  // When zoomed out (or at 1:1), the content already fits entirely within
  // the container, so panning is bounded by PAN_MARGIN alone, keeping it
  // roughly centered while still allowing a bit of edge slack. When zoomed
  // in, that same margin is added on top of the point where the content
  // edge would otherwise be flush with the container edge.
  const maxTranslate = Math.max(0, (contentSize - containerSize) / 2) + PAN_MARGIN;
  return Math.min(Math.max(translate, -maxTranslate), maxTranslate);
}

export const ZoomableContainer = forwardRef<ZoomableContainerHandle, Props>(
  function ZoomableContainer(
    { children, enabled = true, panMinPointers = 1 },
    ref
  ) {
  const scale = useSharedValue(1);
  const savedScale = useSharedValue(1);
  const gesturesEnabled = useSharedValue(enabled);
  const dragLock = useSharedValue(false);
  const containerWidth = useSharedValue(1);
  const containerHeight = useSharedValue(1);
  // True while a programmatic zoom animation is running, so gestures stand
  // down instead of fighting the animation for the transform.
  const animating = useSharedValue(false);
  // Bumped by each programmatic run so a superseded animation's completion
  // callback can tell it's stale and leave `animating` to the newer one.
  const animGen = useSharedValue(0);

  // The single source of truth for the transform. Gestures update these
  // *incrementally* and clamp as they write, so what the gesture math believes
  // is on screen and what's actually rendered can never drift apart — the
  // render path below is a pure read.
  const translateX = useSharedValue(0);
  const translateY = useSharedValue(0);

  // Pinch centroid (relative to the container center) at the previous update,
  // so two-finger drag can be tracked as a per-frame delta.
  const prevFocalX = useSharedValue(0);
  const prevFocalY = useSharedValue(0);

  // False until the pan's first change event has been discarded — see below.
  const panPrimed = useSharedValue(false);
  // Whether the live pinch has a baseline (savedScale / prevFocal) it can
  // trust. Its onStart is skipped when gestures are standing down, so this
  // also covers fingers that were already down when a dive animation ended.
  const pinchPrimed = useSharedValue(false);

  useEffect(() => {
    gesturesEnabled.value = enabled;
  }, [enabled]);

  const onLayout = (e: LayoutChangeEvent) => {
    containerWidth.value = e.nativeEvent.layout.width;
    containerHeight.value = e.nativeEvent.layout.height;
  };

  // Pinch owns *everything* two-finger: both the scaling and the drag that
  // comes with it (tracked from the centroid). Nothing here reads the pan
  // gesture, so the two can't disagree about who moved the content.
  const pinch = Gesture.Pinch()
    .onStart((e) => {
      if (!gesturesEnabled.value || animating.value) return;
      savedScale.value = scale.value;
      prevFocalX.value = e.focalX - containerWidth.value / 2;
      prevFocalY.value = e.focalY - containerHeight.value / 2;
      pinchPrimed.value = true;
    })
    .onUpdate((e) => {
      if (!gesturesEnabled.value || animating.value) return;
      const fx = e.focalX - containerWidth.value / 2;
      const fy = e.focalY - containerHeight.value / 2;

      // Adopt the current state as the baseline rather than acting on a stale
      // one, so picking the gesture up mid-flight continues from where the
      // content is instead of snapping. Dividing out e.scale makes this
      // update a no-op; the next one moves for real.
      if (!pinchPrimed.value) {
        savedScale.value = scale.value / (e.scale || 1);
        prevFocalX.value = fx;
        prevFocalY.value = fy;
        pinchPrimed.value = true;
        return;
      }

      const next = Math.min(
        Math.max(savedScale.value * e.scale, MIN_SCALE),
        MAX_SCALE
      );

      // 1. Follow the centroid, so moving both fingers together drags.
      let tx = translateX.value + (fx - prevFocalX.value);
      let ty = translateY.value + (fy - prevFocalY.value);
      // 2. Scale about the focal point, keeping the content under it pinned.
      const ratio = next / scale.value;
      tx = fx - (fx - tx) * ratio;
      ty = fy - (fy - ty) * ratio;

      scale.value = next;
      translateX.value = clampTranslate(tx, containerWidth.value, next);
      translateY.value = clampTranslate(ty, containerHeight.value, next);
      prevFocalX.value = fx;
      prevFocalY.value = fy;
    })
    .onFinalize(() => {
      pinchPrimed.value = false;
    });

  // Pan is strictly single-finger (see maxPointers), so it never runs during a
  // pinch — two-finger dragging is the pinch's job above. Deltas come from
  // e.change rather than the cumulative e.translation, so a dragLock pause
  // resumes from where the content actually is rather than jumping by the
  // whole travel since touch-down.
  const pan = Gesture.Pan()
    .minPointers(panMinPointers)
    .maxPointers(panMinPointers)
    .minDistance(10)
    .onStart(() => {
      panPrimed.value = false;
    })
    .onChange((e) => {
      if (!gesturesEnabled.value || animating.value) return;
      // RNGH reports the *first* change after activation as the full
      // translation since touch-down, not a delta — with minDistance that's an
      // instant >=10px jump. Drop it so the drag starts from the finger's
      // current position; every later event is a true per-frame delta.
      if (!panPrimed.value) {
        panPrimed.value = true;
        return;
      }
      // A descendant is dragging its own content (e.g. a picked-up zone):
      // don't also pan the canvas.
      if (dragLock.value) return;
      translateX.value = clampTranslate(
        translateX.value + e.changeX,
        containerWidth.value,
        scale.value
      );
      translateY.value = clampTranslate(
        translateY.value + e.changeY,
        containerHeight.value,
        scale.value
      );
    });

  const doubleTap = Gesture.Tap()
    .numberOfTaps(2)
    .onEnd(() => {
      if (!gesturesEnabled.value || animating.value) return;
      scale.value = 1;
      translateX.value = 0;
      translateY.value = 0;
    });

  const composed = Gesture.Simultaneous(pinch, pan, doubleTap);

  useImperativeHandle(ref, () => ({
    zoomToRect(rect) {
      const cw = containerWidth.value;
      const ch = containerHeight.value;
      if (cw <= 1 || ch <= 1 || rect.width <= 0 || rect.height <= 0) {
        return false;
      }
      const rawScale = Math.min(cw / rect.width, ch / rect.height);
      const targetScale = Math.min(Math.max(rawScale, 1), MAX_SCALE);
      const zoneCenterRelX = rect.left + rect.width / 2 - cw / 2;
      const zoneCenterRelY = rect.top + rect.height / 2 - ch / 2;
      const targetTranslateX = -zoneCenterRelX * targetScale;
      const targetTranslateY = -zoneCenterRelY * targetScale;

      animating.value = true;
      animGen.value += 1;
      const gen = animGen.value;

      const timingConfig = { duration: DIVE_IN_DURATION, easing: DIVE_EASING };
      scale.value = withTiming(targetScale, timingConfig);
      // Deliberately unclamped: framing an edge zone needs a translation
      // outside the normal pan bounds. Nothing re-clamps until the next
      // gesture, which is what lets the dive center any zone.
      translateX.value = withTiming(targetTranslateX, timingConfig);
      translateY.value = withTiming(targetTranslateY, timingConfig, () => {
        if (animGen.value === gen) animating.value = false;
      });
      return true;
    },
    resetZoom() {
      animating.value = true;
      animGen.value += 1;
      const gen = animGen.value;

      const timingConfig = { duration: DIVE_OUT_DURATION, easing: DIVE_OUT_EASING };
      scale.value = withTiming(1, timingConfig);
      translateX.value = withTiming(0, timingConfig);
      translateY.value = withTiming(0, timingConfig, () => {
        if (animGen.value === gen) animating.value = false;
      });
    },
  }));

  // A pure read: every writer already clamped, so there's no recombination
  // here that could disagree with what a gesture believes is on screen.
  const animatedStyle = useAnimatedStyle(() => ({
    transform: [
      { translateX: translateX.value },
      { translateY: translateY.value },
      { scale: scale.value },
    ],
  }));

  return (
    <View style={styles.container} onLayout={onLayout}>
      <GestureDetector gesture={composed}>
        <Animated.View style={[styles.inner, animatedStyle]}>
          <ZoomScaleContext.Provider value={scale}>
            <PanLockContext.Provider value={dragLock}>
              {children}
            </PanLockContext.Provider>
          </ZoomScaleContext.Provider>
        </Animated.View>
      </GestureDetector>
    </View>
  );
  }
);

const styles = StyleSheet.create({
  container: { flex: 1 },
  inner: { flex: 1 },
});
