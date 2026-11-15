import React, { useCallback } from "react";
import { StyleSheet } from "react-native";
import Animated, {
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withSequence,
  withSpring,
  withTiming,
} from "react-native-reanimated";
import { Icon, TouchableRipple, useTheme } from "react-native-paper";

type Props = {
  checked: boolean;
  onPress: () => void;
};

// Paper's Checkbox.Android ripple is the checked color faded by 32%.
function fadedRipple(hex: string): string | undefined {
  return /^#[0-9a-f]{6}$/i.test(hex) ? `${hex}AD` : undefined;
}

// A plain icon swap with our own Reanimated pop, rather than Paper's
// Checkbox.Android. Paper draws a hidden 14×14 "fill" square over the icon
// and, on uncheck, snaps its borderWidth to ~5 and animates it back to 0
// with a JS-driven (useNativeDriver: false) Animated timing. When the row
// re-renders or slides out of "Completed" under the list's layout
// transition mid-animation, that last frame can be lost on Fabric and the
// square stays painted — an unchecked box that looks filled in. Swapping
// icons has no intermediate state to get stuck in.
//
// The pop fires straight from the press handler rather than reacting to
// `checked`, so it lands with the tap instead of after the state update.
// It runs on the UI thread (Reanimated), so it can't get stuck the same way.
export function AnimatedCheckbox({ checked, onPress }: Props) {
  const theme = useTheme();
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
      <TouchableRipple
        borderless
        rippleColor={fadedRipple(theme.colors.primary)}
        onPress={handlePress}
        accessibilityRole="checkbox"
        accessibilityState={{ checked }}
        accessibilityLiveRegion="polite"
        style={styles.container}
      >
        <Icon
          source={checked ? "checkbox-marked" : "checkbox-blank-outline"}
          size={24}
          color={checked ? theme.colors.primary : theme.colors.onSurfaceVariant}
        />
      </TouchableRipple>
    </Animated.View>
  );
}

// Same footprint as Checkbox.Android so the List.Item left slot doesn't shift.
const styles = StyleSheet.create({
  container: {
    borderRadius: 18,
    width: 36,
    height: 36,
    padding: 6,
  },
});
