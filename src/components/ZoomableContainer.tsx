import React, { useEffect } from "react";
import { View, StyleSheet, LayoutChangeEvent } from "react-native";
import { GestureDetector, Gesture } from "react-native-gesture-handler";
import Animated, {
  useSharedValue,
  useAnimatedStyle,
} from "react-native-reanimated";

type Props = {
  children: React.ReactNode;
  enabled?: boolean;
};

const MIN_SCALE = 0.5;
const MAX_SCALE = 4;
const MIN_VISIBLE_FRACTION = 0.25;

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

export function ZoomableContainer({ children, enabled = true }: Props) {
  const scale = useSharedValue(1);
  const savedScale = useSharedValue(1);
  const translateX = useSharedValue(0);
  const translateY = useSharedValue(0);
  const savedTranslateX = useSharedValue(0);
  const savedTranslateY = useSharedValue(0);
  const gesturesEnabled = useSharedValue(enabled);
  const containerWidth = useSharedValue(1);
  const containerHeight = useSharedValue(1);

  // Anchor point (relative to container center) that the pinch should keep fixed on screen.
  const focalX = useSharedValue(0);
  const focalY = useSharedValue(0);
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
      focalX.value = e.focalX - containerWidth.value / 2;
      focalY.value = e.focalY - containerHeight.value / 2;
      focalContentX.value = (focalX.value - translateX.value) / scale.value;
      focalContentY.value = (focalY.value - translateY.value) / scale.value;
    })
    .onUpdate((e) => {
      if (!gesturesEnabled.value) return;
      const next = Math.min(
        Math.max(savedScale.value * e.scale, MIN_SCALE),
        MAX_SCALE
      );
      scale.value = next;
      translateX.value = clampTranslate(
        focalX.value - focalContentX.value * next,
        containerWidth.value,
        next
      );
      translateY.value = clampTranslate(
        focalY.value - focalContentY.value * next,
        containerHeight.value,
        next
      );
    });

  const pan = Gesture.Pan()
    .minPointers(1)
    .minDistance(10)
    .onStart(() => {
      if (!gesturesEnabled.value) return;
      savedTranslateX.value = translateX.value;
      savedTranslateY.value = translateY.value;
    })
    .onUpdate((e) => {
      if (!gesturesEnabled.value) return;
      translateX.value = clampTranslate(
        savedTranslateX.value + e.translationX,
        containerWidth.value,
        scale.value
      );
      translateY.value = clampTranslate(
        savedTranslateY.value + e.translationY,
        containerHeight.value,
        scale.value
      );
    });

  const doubleTap = Gesture.Tap()
    .numberOfTaps(2)
    .onEnd(() => {
      if (!gesturesEnabled.value) return;
      scale.value = 1;
      translateX.value = 0;
      translateY.value = 0;
    });

  const composed = Gesture.Simultaneous(pinch, pan, doubleTap);

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
          {children}
        </Animated.View>
      </GestureDetector>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  inner: { flex: 1 },
});
