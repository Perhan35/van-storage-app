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

// Durations for the programmatic dive-in / dive-out animations. Callers that
// coordinate a screen transition around the dive (e.g. overlapping it with a
// navigation fade) can import DIVE_IN_DURATION to stay in sync.
export const DIVE_IN_DURATION = 340;
export const DIVE_OUT_DURATION = 300;
// Eased both in and out so the dive accelerates gently then settles instead
// of snapping to a stop, which is what made the first pass feel abrupt.
export const DIVE_EASING = Easing.inOut(Easing.cubic);

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
  // the container, so no pan slack is allowed — this keeps it centered
  // instead of letting it drift off-screen. When zoomed in, panning is
  // bounded so the content edge never moves past the container edge.
  const maxTranslate = Math.max(0, (contentSize - containerSize) / 2);
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
  // True while a programmatic zoom animation is running: gestures stand down
  // and the transform bypasses the pan clamp so it can center an off-center
  // zone that lies outside the normal pan bounds.
  const animating = useSharedValue(false);
  const isProgrammatic = useSharedValue(false);

  // Committed translation. Each gesture contributes its own *delta* on top of
  // this base and folds that delta back into the base when it ends, so pinch
  // and pan never write the same shared value and can run simultaneously
  // without fighting over it.
  const baseTranslateX = useSharedValue(0);
  const baseTranslateY = useSharedValue(0);
  const panX = useSharedValue(0);
  const panY = useSharedValue(0);
  const pinchX = useSharedValue(0);
  const pinchY = useSharedValue(0);

  // The content-space point (pre-scale) under the focal anchor at pinch start.
  const focalContentX = useSharedValue(0);
  const focalContentY = useSharedValue(0);

  useEffect(() => {
    gesturesEnabled.value = enabled;
  }, [enabled]);

  const onLayout = (e: LayoutChangeEvent) => {
    containerWidth.value = e.nativeEvent.layout.width;
    containerHeight.value = e.nativeEvent.layout.height;
  };

  const pinch = Gesture.Pinch()
    .onStart((e) => {
      if (!gesturesEnabled.value || animating.value) return;
      savedScale.value = scale.value;
      // Focal anchor relative to the container center at pinch start, and the
      // content point currently under it (accounting for any in-flight pan).
      const fx = e.focalX - containerWidth.value / 2;
      const fy = e.focalY - containerHeight.value / 2;
      const tx = baseTranslateX.value + panX.value;
      const ty = baseTranslateY.value + panY.value;
      focalContentX.value = (fx - tx) / scale.value;
      focalContentY.value = (fy - ty) / scale.value;
      pinchX.value = 0;
      pinchY.value = 0;
    })
    .onUpdate((e) => {
      if (!gesturesEnabled.value || animating.value) return;
      const next = Math.min(
        Math.max(savedScale.value * e.scale, MIN_SCALE),
        MAX_SCALE
      );
      scale.value = next;
      // Keep the focal content point pinned under the live centroid. Subtract
      // pan's contribution so the two gestures don't double-count centroid
      // movement (pan already tracks it via e.translation).
      const fx = e.focalX - containerWidth.value / 2;
      const fy = e.focalY - containerHeight.value / 2;
      pinchX.value = fx - focalContentX.value * next - baseTranslateX.value - panX.value;
      pinchY.value = fy - focalContentY.value * next - baseTranslateY.value - panY.value;
    })
    .onEnd(() => {
      baseTranslateX.value = clampTranslate(
        baseTranslateX.value + pinchX.value,
        containerWidth.value,
        scale.value
      );
      baseTranslateY.value = clampTranslate(
        baseTranslateY.value + pinchY.value,
        containerHeight.value,
        scale.value
      );
      pinchX.value = 0;
      pinchY.value = 0;
    });

  const pan = Gesture.Pan()
    .minPointers(panMinPointers)
    .minDistance(10)
    .onStart(() => {
      if (!gesturesEnabled.value || animating.value) return;
      panX.value = 0;
      panY.value = 0;
    })
    .onUpdate((e) => {
      if (!gesturesEnabled.value || animating.value) return;
      // A descendant is dragging its own content (e.g. a picked-up zone):
      // don't also pan the canvas, and undo any pan applied before the lock.
      if (dragLock.value) {
        panX.value = 0;
        panY.value = 0;
        return;
      }
      panX.value = e.translationX;
      panY.value = e.translationY;
    })
    .onEnd(() => {
      baseTranslateX.value = clampTranslate(
        baseTranslateX.value + panX.value,
        containerWidth.value,
        scale.value
      );
      baseTranslateY.value = clampTranslate(
        baseTranslateY.value + panY.value,
        containerHeight.value,
        scale.value
      );
      panX.value = 0;
      panY.value = 0;
    });

  const doubleTap = Gesture.Tap()
    .numberOfTaps(2)
    .onEnd(() => {
      if (!gesturesEnabled.value || animating.value) return;
      scale.value = 1;
      baseTranslateX.value = 0;
      baseTranslateY.value = 0;
      panX.value = 0;
      panY.value = 0;
      pinchX.value = 0;
      pinchY.value = 0;
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
      isProgrammatic.value = true;
      panX.value = 0;
      panY.value = 0;
      pinchX.value = 0;
      pinchY.value = 0;

      const timingConfig = { duration: DIVE_IN_DURATION, easing: DIVE_EASING };
      scale.value = withTiming(targetScale, timingConfig);
      baseTranslateX.value = withTiming(targetTranslateX, timingConfig);
      baseTranslateY.value = withTiming(targetTranslateY, timingConfig, (finished) => {
        if (finished) animating.value = false;
      });
      return true;
    },
    resetZoom() {
      animating.value = true;
      const timingConfig = { duration: DIVE_OUT_DURATION, easing: DIVE_EASING };
      scale.value = withTiming(1, timingConfig);
      baseTranslateX.value = withTiming(0, timingConfig);
      baseTranslateY.value = withTiming(0, timingConfig, (finished) => {
        if (finished) {
          isProgrammatic.value = false;
          animating.value = false;
        }
      });
    },
  }));

  const animatedStyle = useAnimatedStyle(() => {
    if (isProgrammatic.value) {
      return {
        transform: [
          { translateX: baseTranslateX.value },
          { translateY: baseTranslateY.value },
          { scale: scale.value },
        ],
      };
    }
    const tx = clampTranslate(
      baseTranslateX.value + panX.value + pinchX.value,
      containerWidth.value,
      scale.value
    );
    const ty = clampTranslate(
      baseTranslateY.value + panY.value + pinchY.value,
      containerHeight.value,
      scale.value
    );
    return {
      transform: [
        { translateX: tx },
        { translateY: ty },
        { scale: scale.value },
      ],
    };
  });

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
