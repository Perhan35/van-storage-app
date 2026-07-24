import React, {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useRef,
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

  // `translateX/Y` is the clamped, rendered value — the render path is a
  // pure read of these, nothing else. `rawTranslateX/Y` is the *unclamped*
  // ground truth the gesture math is built on: what the transform would be
  // if it were free to go past the pan bounds. They only diverge once a
  // gesture pushes past a bound.
  //
  // This split matters because the pinch/pan math is incremental — each
  // frame computes its result from "where the content already is". If that
  // baseline were the *clamped* value, then every frame the clamp actually
  // bites, the next frame's math starts from a number that doesn't match
  // what the focal-anchoring formula assumed, producing a wrong correction,
  // which gets clamped differently, corrupting the frame after that — a
  // feedback loop. Near `MIN_SCALE` the clamp bound collapses to
  // `PAN_MARGIN` (32px), tight enough that ordinary hand tremor during a
  // pinch keeps the clamp continuously active rather than only at the
  // edges, which is why the wobble only showed up "once you zoom out far
  // enough". Keeping a separate always-unclamped baseline for the math
  // means the clamp never feeds back into itself.
  const translateX = useSharedValue(0);
  const translateY = useSharedValue(0);
  const rawTranslateX = useSharedValue(0);
  const rawTranslateY = useSharedValue(0);

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

  // True for the entire span a second finger is down. This is the *only*
  // thing pan checks to stand down during a pinch — not pointer count. On
  // iOS, RNGH's pan `maxPointers` maps straight to UIPanGestureRecognizer's
  // `maximumNumberOfTouches`, which does not cancel the recognizer when an
  // extra touch lands: it just keeps tracking the original finger and
  // reports numberOfPointers as if nothing changed. So a pointer-count check
  // is a no-op there, and pan kept writing translateX/Y for the *entire*
  // two-finger gesture, racing pinch's writes every frame — the "oscillates
  // between two positions" behaviour. This flag is set/cleared directly by
  // pinch's own lifecycle, independent of what any recognizer reports.
  const pinchActive = useSharedValue(false);

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
  //
  // Memoized (as are pan/doubleTap/composed below): every callback here
  // closes only over shared values, which are stable refs, so this never
  // needs to change identity. Rebuilding and reattaching the composed
  // gesture on every render of this component — which happens whenever the
  // parent re-renders for unrelated reasons, e.g. app/index.tsx's own state —
  // risks resetting the native recognizer's in-flight state mid-gesture.
  const pinch = useMemo(() => Gesture.Pinch()
    .onStart((e) => {
      // Claim exclusivity the moment a pinch is recognized, unconditionally —
      // pan must stand down even if gesturesEnabled/animating below causes
      // pinch itself to do nothing this gesture.
      pinchActive.value = true;
      if (!gesturesEnabled.value || animating.value) return;
      savedScale.value = scale.value;
      prevFocalX.value = e.focalX - containerWidth.value / 2;
      prevFocalY.value = e.focalY - containerHeight.value / 2;
      // Defensive resync: every other writer of translateX/Y (doubleTap,
      // zoomToRect, resetZoom, and this gesture's own onFinalize below) keeps
      // raw in lockstep, so this should be a no-op — but starting a fresh
      // gesture from a guaranteed-consistent baseline costs nothing.
      rawTranslateX.value = translateX.value;
      rawTranslateY.value = translateY.value;
      pinchPrimed.value = true;
    })
    .onUpdate((e) => {
      if (!gesturesEnabled.value || animating.value) return;
      // A finger lifting mid-pinch is reported here (not via onEnd) for one
      // last event with a stale/unreliable focal & scale — RNGH hasn't yet
      // decided the gesture is over. Skip it and force a re-prime, so if a
      // third finger re-engages the pinch it recomputes from where the
      // content actually is instead of lurching off the stale baseline.
      if (e.numberOfPointers < 2) {
        pinchPrimed.value = false;
        return;
      }
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
        rawTranslateX.value = translateX.value;
        rawTranslateY.value = translateY.value;
        pinchPrimed.value = true;
        return;
      }

      const next = Math.min(
        Math.max(savedScale.value * e.scale, MIN_SCALE),
        MAX_SCALE
      );

      // 1. Follow the centroid, so moving both fingers together drags. Uses
      // the unclamped raw baseline — see rawTranslateX/Y's comment above.
      let tx = rawTranslateX.value + (fx - prevFocalX.value);
      let ty = rawTranslateY.value + (fy - prevFocalY.value);
      // 2. Scale about the focal point, keeping the content under it pinned.
      const ratio = next / scale.value;
      tx = fx - (fx - tx) * ratio;
      ty = fy - (fy - ty) * ratio;

      scale.value = next;
      rawTranslateX.value = tx;
      rawTranslateY.value = ty;
      translateX.value = clampTranslate(tx, containerWidth.value, next);
      translateY.value = clampTranslate(ty, containerHeight.value, next);
      prevFocalX.value = fx;
      prevFocalY.value = fy;
    })
    .onFinalize(() => {
      pinchPrimed.value = false;
      pinchActive.value = false;
      // Drop any past-the-bound overshoot rather than carrying it into the
      // next gesture, so releasing and re-grabbing never feels "sticky".
      rawTranslateX.value = translateX.value;
      rawTranslateY.value = translateY.value;
    }), []);

  // Pan is single-finger by config (see maxPointers), but that alone doesn't
  // keep it from running during a pinch (see pinchActive's comment above) —
  // the `pinchActive` check below is what actually excludes it. Deltas come
  // from e.change rather than the cumulative e.translation, so a dragLock
  // pause resumes from where the content actually is rather than jumping by
  // the whole travel since touch-down.
  const pan = useMemo(() => Gesture.Pan()
    .minPointers(panMinPointers)
    .maxPointers(panMinPointers)
    .minDistance(10)
    .onStart(() => {
      panPrimed.value = false;
    })
    .onChange((e) => {
      if (!gesturesEnabled.value || animating.value) return;
      if (pinchActive.value) {
        // A second finger is down and pinch owns the transform. Re-prime so
        // panning resumes cleanly (no jump) once pinch releases, instead of
        // applying everything that happened while it was locked out in one
        // big delta.
        panPrimed.value = false;
        return;
      }
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
      // Accumulate on the unclamped raw baseline — see rawTranslateX/Y's
      // comment above for why reading back the clamped value here would
      // corrupt the next frame's delta once the bound is actively binding.
      rawTranslateX.value += e.changeX;
      rawTranslateY.value += e.changeY;
      translateX.value = clampTranslate(
        rawTranslateX.value,
        containerWidth.value,
        scale.value
      );
      translateY.value = clampTranslate(
        rawTranslateY.value,
        containerHeight.value,
        scale.value
      );
    })
    .onFinalize(() => {
      // Drop any past-the-bound overshoot rather than carrying it into the
      // next gesture, so releasing and re-grabbing never feels "sticky".
      rawTranslateX.value = translateX.value;
      rawTranslateY.value = translateY.value;
    }), [panMinPointers]);

  const doubleTap = useMemo(() => Gesture.Tap()
    .numberOfTaps(2)
    .onEnd(() => {
      if (!gesturesEnabled.value || animating.value) return;
      scale.value = 1;
      translateX.value = 0;
      translateY.value = 0;
      rawTranslateX.value = 0;
      rawTranslateY.value = 0;
    }), []);

  const composed = useMemo(
    () => Gesture.Simultaneous(pinch, pan, doubleTap),
    [pinch, pan, doubleTap]
  );

  // Claims the transform for a programmatic run and returns its generation, so
  // the timing callback can tell whether it's still the current one.
  //
  // The release is armed here on a JS timer as well as on that callback,
  // because the callback is not guaranteed to run at all: a shared value
  // written directly (a gesture worklet in the same frame the animation is
  // started — a finger still down as the screen regains focus) *cancels* the
  // animation rather than finishing it, and a cancelled animation never calls
  // back. `animating` would then stay true forever and every gesture would
  // stand down for the rest of the screen's life — no zoom, no pan, no
  // double-tap. Nothing on the UI thread can cancel this timer.
  const releaseTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const beginAnimation = (duration: number) => {
    animating.value = true;
    animGen.value += 1;
    const gen = animGen.value;
    if (releaseTimer.current) clearTimeout(releaseTimer.current);
    releaseTimer.current = setTimeout(() => {
      releaseTimer.current = null;
      if (animGen.value === gen) animating.value = false;
    }, duration + 60);
    return gen;
  };

  useEffect(
    () => () => {
      if (releaseTimer.current) clearTimeout(releaseTimer.current);
    },
    []
  );

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

      const gen = beginAnimation(DIVE_IN_DURATION);

      // Raw is set to the *final* target immediately, not animated: gesture
      // math is a no-op for the whole animation (gated by `animating`), so
      // raw only needs to be correct by the time a gesture can read it again
      // — which is exactly when this animation has settled at its target.
      rawTranslateX.value = targetTranslateX;
      rawTranslateY.value = targetTranslateY;

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
      const gen = beginAnimation(DIVE_OUT_DURATION);

      rawTranslateX.value = 0;
      rawTranslateY.value = 0;

      const timingConfig = { duration: DIVE_OUT_DURATION, easing: DIVE_OUT_EASING };
      scale.value = withTiming(1, timingConfig);
      translateX.value = withTiming(0, timingConfig);
      translateY.value = withTiming(0, timingConfig, () => {
        if (animGen.value === gen) animating.value = false;
      });
    },
  }));

  // A pure read: gestures already clamp as they write (zoomToRect/resetZoom
  // are the deliberate exception, see above), so there's no recombination
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
