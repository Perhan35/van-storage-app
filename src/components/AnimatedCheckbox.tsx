import React, { useCallback } from "react";
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

// A quick pop gives the tap a tactile "landed" feel that the stock
// Checkbox.Android lacks. We fire it straight from the press handler rather
// than reacting to `checked`: that prop only flips after an async DB
// round-trip (setItemChecked → loadItems), so on Android the animation
// arrived too late — and too subtly, overlapping Paper's own internal
// squash — to read as a reaction to the tap. Popping up (rather than down)
// keeps it visually distinct from that built-in squash.
export function AnimatedCheckbox({ checked, onPress }: Props) {
  const scale = useSharedValue(1);
  const reducedMotion = useReducedMotion();

  const handlePress = useCallback(() => {
    if (!reducedMotion) {
      scale.value = withSequence(
        withTiming(1.35, { duration: 110 }),
        withSpring(1, { damping: 8, stiffness: 200 })
      );
    }
    onPress();
  }, [onPress, reducedMotion, scale]);

  const animatedStyle = useAnimatedStyle(() => ({
    transform: [{ scale: scale.value }],
  }));

  return (
    <Animated.View style={animatedStyle}>
      <Checkbox.Android status={checked ? "checked" : "unchecked"} onPress={handlePress} />
    </Animated.View>
  );
}
