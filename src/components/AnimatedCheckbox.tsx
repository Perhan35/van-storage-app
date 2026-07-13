import React, { useEffect } from "react";
import Animated, {
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withSequence,
  withSpring,
  withTiming,
} from "react-native-reanimated";
import { Checkbox } from "react-native-paper";

type Props = {
  checked: boolean;
  onPress: () => void;
};

// A quick squash-and-pop gives the tap a tactile "landed" feel that the
// stock Checkbox.Android lacks — same widget underneath, just wrapped.
export function AnimatedCheckbox({ checked, onPress }: Props) {
  const scale = useSharedValue(1);
  const reducedMotion = useReducedMotion();

  useEffect(() => {
    if (reducedMotion) return;
    scale.value = withSequence(
      withTiming(0.75, { duration: 90 }),
      withSpring(1, { damping: 9, stiffness: 220 })
    );
  }, [checked, reducedMotion, scale]);

  const animatedStyle = useAnimatedStyle(() => ({
    transform: [{ scale: scale.value }],
  }));

  return (
    <Animated.View style={animatedStyle}>
      <Checkbox.Android status={checked ? "checked" : "unchecked"} onPress={onPress} />
    </Animated.View>
  );
}
