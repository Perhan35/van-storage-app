import React, { useEffect } from "react";
import { StyleSheet, View } from "react-native";
import Animated, {
  runOnJS,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withRepeat,
  withSequence,
  withTiming,
} from "react-native-reanimated";

type Props = {
  active: boolean;
  color: string;
  onDone: () => void;
  children: React.ReactNode;
};

const FLASH_PEAK_OPACITY = 0.35;
const FLASH_PULSE_DURATION = 350;
const FLASH_PULSE_COUNT = 3;

// Pulses a translucent color overlay behind a row a few times to draw the
// eye to it after scrolling there, e.g. from a cross-screen deep link.
export function HighlightFlashRow({ active, color, onDone, children }: Props) {
  const flash = useSharedValue(0);
  const reducedMotion = useReducedMotion();

  useEffect(() => {
    if (!active) return;

    if (reducedMotion) {
      flash.value = withSequence(
        withTiming(FLASH_PEAK_OPACITY, { duration: FLASH_PULSE_DURATION }),
        withTiming(0, { duration: FLASH_PULSE_DURATION }, (finished) => {
          if (finished) runOnJS(onDone)();
        })
      );
      return;
    }

    flash.value = withRepeat(
      withSequence(
        withTiming(FLASH_PEAK_OPACITY, { duration: FLASH_PULSE_DURATION }),
        withTiming(0, { duration: FLASH_PULSE_DURATION })
      ),
      FLASH_PULSE_COUNT,
      false,
      (finished) => {
        if (finished) runOnJS(onDone)();
      }
    );
  }, [active, reducedMotion, flash, onDone]);

  const overlayStyle = useAnimatedStyle(() => ({ opacity: flash.value }));

  return (
    <View style={styles.wrap}>
      <Animated.View
        pointerEvents="none"
        style={[StyleSheet.absoluteFill, { backgroundColor: color }, overlayStyle]}
      />
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { overflow: "hidden" },
});
