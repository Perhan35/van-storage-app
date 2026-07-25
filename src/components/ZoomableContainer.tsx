import React, {
  createContext,
  useCallback,
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
  runOnJS,
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
  // A deliberate one-finger, stationary hold anywhere on the canvas. Lives
  // here rather than in a GestureDetector nested inside this one — see the
  // comment on `composed` below for why that nesting had to go.
  onLongPress?: () => void;
  longPressEnabled?: boolean;
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

// Slack added to a programmatic animation's duration before gestures are
// allowed to touch the transform again, covering the frame or two between the
// animation reaching its target and settling.
const ANIM_LOCKOUT_SLACK = 60;

const LONG_PRESS_DURATION = 450;
// Matches the pan's minDistance, so the moment a drag travels far enough to
// pan, the hold fails instead of firing.
const LONG_PRESS_MAX_DISTANCE = 10;

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
    {
      children,
      enabled = true,
      panMinPointers = 1,
      onLongPress,
      longPressEnabled = true,
    },
    ref
  ) {
  const scale = useSharedValue(1);
  const savedScale = useSharedValue(1);
  const gesturesEnabled = useSharedValue(enabled);
  const dragLock = useSharedValue(false);
  const containerWidth = useSharedValue(1);
  const containerHeight = useSharedValue(1);

  // Deadline (wall-clock ms) until which a programmatic zoom animation owns the
  // transform and gestures stand down instead of fighting it for it.
  //
  // A deadline rather than an `animating` boolean released by the animation's
  // own completion callback: that callback is not guaranteed to run at all — a
  // shared value written directly (a gesture worklet in the same frame the
  // animation starts, e.g. a finger still down as the screen regains focus)
  // *cancels* the animation, and a cancelled animation never calls back. The
  // flag would then stay true forever and every gesture would stand down for
  // the rest of the screen's life: no zoom, no pan. A deadline expires on its
  // own, so that failure mode does not exist.
  const animUntil = useSharedValue(0);

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

  // Live count of fingers on the canvas, and a latch that goes true the moment
  // a second one lands and only clears once *every* finger is back up.
  //
  // The latch is what keeps pan and pinch from both writing the transform.
  // Recognizer state can't be used for this: on iOS the pan's `maxPointers`
  // maps straight to UIPanGestureRecognizer's `maximumNumberOfTouches`, which
  // does not cancel the recognizer when an extra touch lands — it keeps
  // tracking the original finger and reports as if nothing happened. And the
  // pinch's own onStart only fires once UIPinchGestureRecognizer *activates*,
  // which needs a real scale change, so it does not cover the window between
  // the second finger landing and the pinch taking off. In that window both
  // gestures were writing: pan mutating rawTranslate by its one finger's delta
  // and pinch overwriting it from the centroid, in a per-frame order that isn't
  // fixed. Zoomed out, where the clamp bound collapses to PAN_MARGIN, the two
  // results straddle that bound and the canvas snaps between two positions —
  // the "flickers between two spots, depends where my fingers are" behaviour.
  //
  // Counting raw touch events instead is independent of every recognizer, and
  // latching until all fingers are up means pan can never take the transform
  // back mid-sequence.
  const activeTouches = useSharedValue(0);
  const multiTouch = useSharedValue(false);

  useEffect(() => {
    gesturesEnabled.value = enabled;
  }, [enabled]);

  // Read inside the long-press worklet rather than through `.enabled()`, so
  // toggling edit mode never changes the gesture's identity — see `composed`.
  const longPressArmed = useSharedValue(longPressEnabled);
  useEffect(() => {
    longPressArmed.value = longPressEnabled;
  }, [longPressEnabled]);

  // Indirection so the gesture below can stay memoized for the component's
  // whole life while still calling the latest handler.
  const onLongPressRef = useRef(onLongPress);
  onLongPressRef.current = onLongPress;
  const fireLongPress = useCallback(() => {
    onLongPressRef.current?.();
  }, []);

  const onLayout = (e: LayoutChangeEvent) => {
    containerWidth.value = e.nativeEvent.layout.width;
    containerHeight.value = e.nativeEvent.layout.height;
  };

  // Touch counting rides on a manual gesture, which never activates and never
  // fails on its own, so it sees the whole touch stream for the entire
  // sequence — unlike pan/pinch, which stop reporting once their recognizer
  // resolves.
  //
  // The count is re-anchored from `numberOfTouches` on every touch-down (where
  // it unambiguously means "fingers currently down") and only decremented from
  // `changedTouches` on the way up, so a miscount can't accumulate across
  // sequences.
  const touchTracker = useMemo(() => Gesture.Manual()
    .onTouchesDown((e) => {
      activeTouches.value = e.numberOfTouches;
      if (activeTouches.value >= 2) multiTouch.value = true;
    })
    .onTouchesUp((e) => {
      activeTouches.value = Math.max(
        0,
        activeTouches.value - e.changedTouches.length
      );
      if (activeTouches.value === 0) multiTouch.value = false;
    })
    .onTouchesCancelled((e) => {
      activeTouches.value = Math.max(
        0,
        activeTouches.value - e.changedTouches.length
      );
      if (activeTouches.value === 0) multiTouch.value = false;
    }), []);

  // Pinch owns *everything* two-finger: both the scaling and the drag that
  // comes with it (tracked from the centroid). Nothing here reads the pan
  // gesture, so the two can't disagree about who moved the content.
  const pinch = useMemo(() => Gesture.Pinch()
    .onStart((e) => {
      // A recognized pinch means two fingers are down, whatever the touch
      // tracker believes — a floor under it, in case its handler was reset
      // mid-interaction and it lost count. Set unconditionally, before the
      // guards below: pan must stand down even if this pinch itself ends up
      // doing nothing.
      multiTouch.value = true;
      if (!gesturesEnabled.value || Date.now() < animUntil.value) return;
      savedScale.value = scale.value;
      prevFocalX.value = e.focalX - containerWidth.value / 2;
      prevFocalY.value = e.focalY - containerHeight.value / 2;
      // Defensive resync: every other writer of translateX/Y (zoomToRect,
      // resetZoom, and this gesture's own onFinalize below) keeps raw in
      // lockstep, so this should be a no-op — but starting a fresh gesture
      // from a guaranteed-consistent baseline costs nothing.
      rawTranslateX.value = translateX.value;
      rawTranslateY.value = translateY.value;
      pinchPrimed.value = true;
    })
    .onUpdate((e) => {
      // Re-asserted every frame, not just in onStart: resetZoom clears the
      // latch to un-stick whatever a navigation interrupted, and it can land
      // while a pinch is already in flight — after which onStart is never
      // coming again to put it back.
      multiTouch.value = true;
      if (!gesturesEnabled.value || Date.now() < animUntil.value) return;
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
      // Drop any past-the-bound overshoot rather than carrying it into the
      // next gesture, so releasing and re-grabbing never feels "sticky".
      rawTranslateX.value = translateX.value;
      rawTranslateY.value = translateY.value;
    }), []);

  // Pan is single-finger by config (see maxPointers), but that alone doesn't
  // keep it from running during a pinch (see multiTouch's comment above) — the
  // `multiTouch` check below is what actually excludes it. Deltas come from
  // e.change rather than the cumulative e.translation, so a dragLock pause
  // resumes from where the content actually is rather than jumping by the
  // whole travel since touch-down.
  const pan = useMemo(() => Gesture.Pan()
    .minPointers(panMinPointers)
    .maxPointers(panMinPointers)
    .minDistance(10)
    .onStart(() => {
      panPrimed.value = false;
    })
    .onChange((e) => {
      if (!gesturesEnabled.value || Date.now() < animUntil.value) return;
      if (multiTouch.value) {
        // A second finger has been down at some point in this touch sequence
        // and pinch owns the transform for the rest of it. Re-prime so panning
        // resumes cleanly (no jump) on the next sequence, instead of applying
        // everything that happened while it was locked out in one big delta.
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
      // Same exclusion as onChange, and for a sharper reason: on iOS the pan
      // recognizer can resolve part-way through a two-finger gesture, and
      // slamming the pinch's unclamped working baseline back to the clamped
      // value mid-pinch is exactly the corruption rawTranslate exists to
      // prevent.
      if (multiTouch.value) return;
      // Drop any past-the-bound overshoot rather than carrying it into the
      // next gesture, so releasing and re-grabbing never feels "sticky".
      rawTranslateX.value = translateX.value;
      rawTranslateY.value = translateY.value;
    }), [panMinPointers]);

  // A deliberate one-finger, stationary press drops into edit mode. Constrained
  // so it can't be mistaken for the canvas' own navigation: one pointer, and a
  // max travel matching the pan's minDistance. `multiTouch` covers the rest —
  // a pinch whose fingers landed a beat apart can't be read as a hold.
  const longPress = useMemo(() => Gesture.LongPress()
    .minDuration(LONG_PRESS_DURATION)
    .numberOfPointers(1)
    .maxDistance(LONG_PRESS_MAX_DISTANCE)
    .onStart(() => {
      if (!gesturesEnabled.value || !longPressArmed.value) return;
      if (multiTouch.value || Date.now() < animUntil.value) return;
      runOnJS(fireLongPress)();
    }), [fireLongPress]);

  // One GestureDetector for the whole canvas, and a composition whose identity
  // never changes for the life of the component.
  //
  // Both halves of that matter. This used to be two nested detectors — this one
  // plus a long-press detector inside VanLayoutSVG — with no relation declared
  // between them, and the inner gesture rebuilt on every render. RNGH rewires
  // the relations across the whole detector tree whenever any detector
  // re-attaches, and doing that while this one's recognizers were live left
  // them wedged: after diving into a zone and back, the canvas' pinch and pan
  // would stop responding until the container was unmounted (going out to the
  // locations overview and back in). Everything the canvas recognizes now lives
  // in this one composition, and every gesture in it closes only over shared
  // values — including the enabled flags, deliberately read inside the worklets
  // rather than set with `.enabled()` — so nothing here ever needs to reattach.
  const composed = useMemo(
    () => Gesture.Simultaneous(touchTracker, pinch, pan, longPress),
    [touchTracker, pinch, pan, longPress]
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

      animUntil.value = Date.now() + DIVE_IN_DURATION + ANIM_LOCKOUT_SLACK;

      // Raw is set to the *final* target immediately, not animated: gesture
      // math is a no-op for the whole animation (gated by `animUntil`), so raw
      // only needs to be correct by the time a gesture can read it again —
      // which is exactly when this animation has settled at its target.
      rawTranslateX.value = targetTranslateX;
      rawTranslateY.value = targetTranslateY;

      const timingConfig = { duration: DIVE_IN_DURATION, easing: DIVE_EASING };
      scale.value = withTiming(targetScale, timingConfig);
      // Deliberately unclamped: framing an edge zone needs a translation
      // outside the normal pan bounds. Nothing re-clamps until the next
      // gesture, which is what lets the dive center any zone.
      translateX.value = withTiming(targetTranslateX, timingConfig);
      translateY.value = withTiming(targetTranslateY, timingConfig);
      return true;
    },
    resetZoom() {
      // Called on every focus of the map screen, which makes it the natural
      // place to guarantee a clean slate: whatever a gesture interrupted by the
      // navigation away left behind (a latched multi-touch, a zone still
      // holding the pan lock, a half-primed pinch) is cleared here rather than
      // surviving into the next interaction.
      activeTouches.value = 0;
      multiTouch.value = false;
      dragLock.value = false;
      pinchPrimed.value = false;
      panPrimed.value = false;

      animUntil.value = Date.now() + DIVE_OUT_DURATION + ANIM_LOCKOUT_SLACK;

      rawTranslateX.value = 0;
      rawTranslateY.value = 0;

      const timingConfig = { duration: DIVE_OUT_DURATION, easing: DIVE_OUT_EASING };
      scale.value = withTiming(1, timingConfig);
      translateX.value = withTiming(0, timingConfig);
      translateY.value = withTiming(0, timingConfig);
    },
  }), []);

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
