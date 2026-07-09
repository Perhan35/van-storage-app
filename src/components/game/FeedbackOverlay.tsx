import React, { useEffect } from "react";
import { View, StyleSheet } from "react-native";
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withDelay,
  withSequence,
  withTiming,
} from "react-native-reanimated";

const SUCCESS_COLOR = "#4CAF50";
const DANGER_COLOR = "#D32F2F";
const CONFETTI_COLORS = ["#FFD54F", "#4A90D9", "#FF8A65", "#4CAF50", "#EF5350", "#AB47BC"];
const CONFETTI_COUNT = 10;

type Result = "correct" | "wrong" | null;

type Props = {
  result: Result;
  feedbackKey: string;
};

function ConfettiPiece({ index, triggerKey }: { index: number; triggerKey: string }) {
  const translateX = useSharedValue(0);
  const translateY = useSharedValue(0);
  const rotate = useSharedValue(0);
  const opacity = useSharedValue(0);

  useEffect(() => {
    const angle = (index / CONFETTI_COUNT) * Math.PI * 2;
    const distance = 90 + Math.random() * 50;
    const spin = 240 + Math.random() * 240;

    translateX.value = 0;
    translateY.value = 0;
    rotate.value = 0;
    opacity.value = 1;

    translateX.value = withTiming(Math.cos(angle) * distance, { duration: 700 });
    translateY.value = withTiming(Math.sin(angle) * distance - 20, { duration: 700 });
    rotate.value = withTiming(Math.random() > 0.5 ? spin : -spin, { duration: 700 });
    opacity.value = withDelay(350, withTiming(0, { duration: 350 }));
  }, [triggerKey]);

  const style = useAnimatedStyle(() => ({
    opacity: opacity.value,
    transform: [
      { translateX: translateX.value },
      { translateY: translateY.value },
      { rotate: `${rotate.value}deg` },
    ],
  }));

  return (
    <Animated.View
      style={[styles.confettiPiece, style, { backgroundColor: CONFETTI_COLORS[index % CONFETTI_COLORS.length] }]}
    />
  );
}

export function FeedbackOverlay({ result, feedbackKey }: Props) {
  const flashOpacity = useSharedValue(0);
  const popTranslate = useSharedValue(0);
  const popOpacity = useSharedValue(0);

  useEffect(() => {
    if (!result) return;
    flashOpacity.value = 0;
    flashOpacity.value = withSequence(
      withTiming(0.35, { duration: 90 }),
      withTiming(0, { duration: 380 })
    );
    if (result === "correct") {
      popTranslate.value = 0;
      popOpacity.value = 0;
      popOpacity.value = withSequence(
        withTiming(1, { duration: 120 }),
        withDelay(450, withTiming(0, { duration: 300 }))
      );
      popTranslate.value = withTiming(-70, { duration: 900 });
    }
  }, [feedbackKey]);

  const flashStyle = useAnimatedStyle(() => ({
    opacity: flashOpacity.value,
    backgroundColor: result === "wrong" ? DANGER_COLOR : SUCCESS_COLOR,
  }));

  const popStyle = useAnimatedStyle(() => ({
    opacity: popOpacity.value,
    transform: [{ translateY: popTranslate.value }],
  }));

  return (
    <View style={styles.overlay} pointerEvents="none">
      <Animated.View style={[StyleSheet.absoluteFill, flashStyle]} />
      {result === "correct" && (
        <View style={styles.center} pointerEvents="none">
          <Animated.Text style={[styles.pop, popStyle]}>+1</Animated.Text>
          <View style={styles.confettiContainer}>
            {Array.from({ length: CONFETTI_COUNT }).map((_, i) => (
              <ConfettiPiece key={i} index={i} triggerKey={feedbackKey} />
            ))}
          </View>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  overlay: {
    ...StyleSheet.absoluteFill,
  },
  center: {
    ...StyleSheet.absoluteFill,
    alignItems: "center",
    justifyContent: "center",
  },
  pop: {
    fontSize: 48,
    fontWeight: "900",
    color: SUCCESS_COLOR,
    textShadowColor: "rgba(0,0,0,0.3)",
    textShadowOffset: { width: 0, height: 2 },
    textShadowRadius: 4,
  },
  confettiContainer: {
    ...StyleSheet.absoluteFill,
    alignItems: "center",
    justifyContent: "center",
  },
  confettiPiece: {
    position: "absolute",
    width: 8,
    height: 8,
    borderRadius: 2,
  },
});
