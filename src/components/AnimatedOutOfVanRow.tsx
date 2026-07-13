import React, { useEffect, useRef } from "react";
import { StyleSheet, View } from "react-native";
import Animated, {
  Easing,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withSequence,
  withSpring,
  withTiming,
} from "react-native-reanimated";

type Props = {
  outOfVan: boolean;
  outColor: string;
  inColor: string;
  children: React.ReactNode;
};

const FLASH_PEAK_OPACITY = 0.28;
const SHIFT_PX = 10;

// Pulses a direction-coded highlight behind the row and gives it a small
// shove the way the item itself would move — right when it leaves the van,
// left when it comes back — so the toggle reads as a small physical event
// instead of an instant icon swap.
export function AnimatedOutOfVanRow({ outOfVan, outColor, inColor, children }: Props) {
  const outFlash = useSharedValue(0);
  const inFlash = useSharedValue(0);
  const shift = useSharedValue(0);
  const reducedMotion = useReducedMotion();
  const mounted = useRef(false);

  useEffect(() => {
    if (!mounted.current) {
      mounted.current = true;
      return;
    }
    if (reducedMotion) return;

    const flash = outOfVan ? outFlash : inFlash;
    flash.value = withSequence(
      withTiming(FLASH_PEAK_OPACITY, { duration: 100, easing: Easing.out(Easing.quad) }),
      withTiming(0, { duration: 420, easing: Easing.in(Easing.quad) })
    );

    const direction = outOfVan ? 1 : -1;
    shift.value = withSequence(
      withTiming(direction * SHIFT_PX, { duration: 110, easing: Easing.out(Easing.quad) }),
      withSpring(0, { damping: 12, stiffness: 260 })
    );
  }, [outOfVan, reducedMotion, outFlash, inFlash, shift]);

  const contentStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: shift.value }],
  }));
  const outOverlayStyle = useAnimatedStyle(() => ({ opacity: outFlash.value }));
  const inOverlayStyle = useAnimatedStyle(() => ({ opacity: inFlash.value }));

  return (
    <View style={styles.wrap}>
      <Animated.View
        pointerEvents="none"
        style={[StyleSheet.absoluteFill, { backgroundColor: outColor }, outOverlayStyle]}
      />
      <Animated.View
        pointerEvents="none"
        style={[StyleSheet.absoluteFill, { backgroundColor: inColor }, inOverlayStyle]}
      />
      <Animated.View style={contentStyle}>{children}</Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { overflow: "hidden" },
});
