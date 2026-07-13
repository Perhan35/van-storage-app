import React, { useEffect } from "react";
import Animated, {
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withTiming,
} from "react-native-reanimated";

type Props = {
  checked: boolean;
  children: React.ReactNode;
};

const CHECKED_OPACITY = 0.55;

// Fades the row toward its dimmed "done" look instead of snapping to it,
// so the check/uncheck reads as one continuous motion rather than a flicker.
export function AnimatedCheckRow({ checked, children }: Props) {
  const opacity = useSharedValue(checked ? CHECKED_OPACITY : 1);
  const reducedMotion = useReducedMotion();

  useEffect(() => {
    const target = checked ? CHECKED_OPACITY : 1;
    opacity.value = reducedMotion ? target : withTiming(target, { duration: 240 });
  }, [checked, reducedMotion, opacity]);

  const animatedStyle = useAnimatedStyle(() => ({ opacity: opacity.value }));

  return <Animated.View style={animatedStyle}>{children}</Animated.View>;
}
