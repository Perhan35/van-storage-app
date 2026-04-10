import React, { useEffect } from "react";
import { StyleSheet } from "react-native";
import {
  GestureDetector,
  Gesture,
  GestureHandlerRootView,
} from "react-native-gesture-handler";
import Animated, {
  useSharedValue,
  useAnimatedStyle,
} from "react-native-reanimated";

type Props = {
  children: React.ReactNode;
  enabled?: boolean;
};

const MIN_SCALE = 1;
const MAX_SCALE = 4;

export function ZoomableContainer({ children, enabled = true }: Props) {
  const scale = useSharedValue(1);
  const savedScale = useSharedValue(1);
  const translateX = useSharedValue(0);
  const translateY = useSharedValue(0);
  const savedTranslateX = useSharedValue(0);
  const savedTranslateY = useSharedValue(0);
  const gesturesEnabled = useSharedValue(enabled);

  useEffect(() => {
    gesturesEnabled.value = enabled;
  }, [enabled]);

  const pinch = Gesture.Pinch()
    .onStart(() => {
      if (!gesturesEnabled.value) return;
      savedScale.value = scale.value;
    })
    .onUpdate((e) => {
      if (!gesturesEnabled.value) return;
      const next = savedScale.value * e.scale;
      scale.value = Math.min(Math.max(next, MIN_SCALE), MAX_SCALE);
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
      translateX.value = savedTranslateX.value + e.translationX;
      translateY.value = savedTranslateY.value + e.translationY;
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
    <GestureHandlerRootView style={styles.container}>
      <GestureDetector gesture={composed}>
        <Animated.View style={[styles.inner, animatedStyle]}>
          {children}
        </Animated.View>
      </GestureDetector>
    </GestureHandlerRootView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  inner: { flex: 1 },
});
