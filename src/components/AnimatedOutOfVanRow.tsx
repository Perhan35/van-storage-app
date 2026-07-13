import React, { useEffect, useRef, useState } from "react";
import { StyleSheet, View } from "react-native";
import { Icon } from "react-native-paper";
import Animated, {
  Easing,
  interpolate,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withSequence,
  withTiming,
} from "react-native-reanimated";

type Props = {
  outOfVan: boolean;
  outColor: string;
  inColor: string;
  outIcon: string;
  inIcon: string;
  children: React.ReactNode;
};

const FLASH_PEAK_OPACITY = 0.28;
const STAMP_DURATION = 520;

// Pulses a direction-coded highlight behind the row, and stamps a large
// translucent icon over its center — the van icon when the item comes back,
// the exit icon when it leaves — that pops in and fades out. The row itself
// never moves, so the title stays perfectly still.
export function AnimatedOutOfVanRow({
  outOfVan,
  outColor,
  inColor,
  outIcon,
  inIcon,
  children,
}: Props) {
  const outFlash = useSharedValue(0);
  const inFlash = useSharedValue(0);
  const stamp = useSharedValue(0);
  const reducedMotion = useReducedMotion();
  const mounted = useRef(false);
  const [stampContent, setStampContent] = useState<{ icon: string; color: string } | null>(null);

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

    setStampContent({
      icon: outOfVan ? outIcon : inIcon,
      color: outOfVan ? outColor : inColor,
    });
    stamp.value = 0;
    stamp.value = withTiming(1, { duration: STAMP_DURATION, easing: Easing.out(Easing.quad) });
  }, [outOfVan, reducedMotion, outFlash, inFlash, stamp, outIcon, inIcon, outColor, inColor]);

  const outOverlayStyle = useAnimatedStyle(() => ({ opacity: outFlash.value }));
  const inOverlayStyle = useAnimatedStyle(() => ({ opacity: inFlash.value }));
  const stampStyle = useAnimatedStyle(() => ({
    opacity: interpolate(stamp.value, [0, 0.15, 1], [0, 0.4, 0]),
    transform: [{ scale: interpolate(stamp.value, [0, 1], [0.5, 1.3]) }],
  }));

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
      {!!stampContent && (
        <Animated.View pointerEvents="none" style={[styles.stamp, stampStyle]}>
          <Icon source={stampContent.icon} size={40} color={stampContent.color} />
        </Animated.View>
      )}
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { overflow: "hidden" },
  stamp: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    alignItems: "center",
    justifyContent: "center",
  },
});
