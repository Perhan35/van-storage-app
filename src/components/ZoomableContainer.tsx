import React, { createContext, useContext, useEffect } from "react";
import { View, StyleSheet, LayoutChangeEvent } from "react-native";
import { GestureDetector, Gesture } from "react-native-gesture-handler";
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  SharedValue,
} from "react-native-reanimated";

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
const MIN_VISIBLE_FRACTION = 0.25;

// Live pinch-zoom level, so descendants (e.g. zone edit gesture math) can
// convert screen-pixel deltas to content-space units as the user zooms.
const ZoomScaleContext = createContext<SharedValue<number> | null>(null);

export function useZoomScale() {
  return useContext(ZoomScaleContext);
}

function clampTranslate(
  translate: number,
  containerSize: number,
  scale: number
) {
  "worklet";
  const contentSize = containerSize * scale;
  const maxTranslate =
    containerSize / 2 + MIN_VISIBLE_FRACTION * contentSize;
  return Math.min(Math.max(translate, -maxTranslate), maxTranslate);
}

export function ZoomableContainer({
  children,
  enabled = true,
  panMinPointers = 1,
}: Props) {
  const scale = useSharedValue(1);
  const savedScale = useSharedValue(1);
  const gesturesEnabled = useSharedValue(enabled);
  const containerWidth = useSharedValue(1);
  const containerHeight = useSharedValue(1);

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
      if (!gesturesEnabled.value) return;
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
      if (!gesturesEnabled.value) return;
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
      if (!gesturesEnabled.value) return;
      panX.value = 0;
      panY.value = 0;
    })
    .onUpdate((e) => {
      if (!gesturesEnabled.value) return;
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
      if (!gesturesEnabled.value) return;
      scale.value = 1;
      baseTranslateX.value = 0;
      baseTranslateY.value = 0;
      panX.value = 0;
      panY.value = 0;
      pinchX.value = 0;
      pinchY.value = 0;
    });

  const composed = Gesture.Simultaneous(pinch, pan, doubleTap);

  const animatedStyle = useAnimatedStyle(() => {
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
            {children}
          </ZoomScaleContext.Provider>
        </Animated.View>
      </GestureDetector>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  inner: { flex: 1 },
});
