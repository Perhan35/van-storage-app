import React, { useEffect, useMemo } from "react";
import { StyleSheet, useWindowDimensions, View } from "react-native";
import { Icon } from "react-native-paper";
import Animated, {
  cancelAnimation,
  Easing,
  runOnJS,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withDelay,
  withRepeat,
  withSequence,
  withSpring,
  withTiming,
} from "react-native-reanimated";
import { useTranslation } from "react-i18next";
import { triggerSuccessHaptic } from "../../utils/haptics";

// The "you found the secret game mode" celebration: a van zooms across the
// screen leaving a trail of sparkles, then onFinish navigates to the game.
// Rendered as an absolute overlay inside the settings screen (not a Modal) so
// the router push at the end doesn't race a native modal dismissal.

const VAN_SIZE = 72;
const CROSS_MS = 1100;
const TOTAL_MS = 1700;
const STAR_COUNT = 9;
const STAR_COLORS = ["#FFD54F", "#FFB300", "#FFF59D", "#FF8A65", "#4FC3F7"];

type Props = {
  onFinish: () => void;
};

function TrailStar({
  index,
  x,
  y,
  delay,
}: {
  index: number;
  x: number;
  y: number;
  delay: number;
}) {
  const scale = useSharedValue(0);
  const opacity = useSharedValue(0);
  const drift = useSharedValue(0);
  // Alternate above/below the van's path so the trail looks scattered.
  const driftTo = useMemo(() => (index % 2 === 0 ? -1 : 1) * (14 + Math.random() * 22), [index]);
  const size = useMemo(() => 14 + Math.random() * 12, []);

  useEffect(() => {
    scale.value = withDelay(delay, withSpring(1, { damping: 6, stiffness: 220 }));
    opacity.value = withDelay(
      delay,
      withSequence(withTiming(1, { duration: 80 }), withDelay(260, withTiming(0, { duration: 380 })))
    );
    drift.value = withDelay(delay, withTiming(driftTo, { duration: 700, easing: Easing.out(Easing.quad) }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const style = useAnimatedStyle(() => ({
    opacity: opacity.value,
    transform: [
      { translateY: drift.value },
      { scale: scale.value },
      { rotate: `${scale.value * 90}deg` },
    ],
  }));

  return (
    <Animated.View style={[styles.star, { left: x - size / 2, top: y - size / 2 }, style]}>
      <Icon source="star-four-points" size={size} color={STAR_COLORS[index % STAR_COLORS.length]} />
    </Animated.View>
  );
}

export function GameUnlockOverlay({ onFinish }: Props) {
  const { t } = useTranslation();
  const { width, height } = useWindowDimensions();
  const reducedMotion = useReducedMotion();

  const backdrop = useSharedValue(0);
  const vanX = useSharedValue(-VAN_SIZE * 1.5);
  const vanBounce = useSharedValue(0);
  const titleScale = useSharedValue(0);
  const titleOpacity = useSharedValue(0);

  const pathY = height * 0.4;
  const startX = -VAN_SIZE * 1.5;
  const endX = width + VAN_SIZE * 0.5;

  useEffect(() => {
    triggerSuccessHaptic();

    if (reducedMotion) {
      // No zooming van for people who asked for less motion: just a short
      // fade of the message, then into the game.
      backdrop.value = withSequence(
        withTiming(1, { duration: 150 }),
        withDelay(600, withTiming(0, { duration: 150 }))
      );
      titleScale.value = 1;
      titleOpacity.value = withSequence(
        withTiming(1, { duration: 150 }),
        withDelay(600, withTiming(0, { duration: 150 }, (done) => {
          if (done) runOnJS(onFinish)();
        }))
      );
      return;
    }

    backdrop.value = withSequence(
      withTiming(1, { duration: 200 }),
      withDelay(TOTAL_MS - 450, withTiming(0, { duration: 250 }))
    );
    // Constant speed, so the sparkle trail below can be timed exactly.
    vanX.value = withTiming(endX, { duration: CROSS_MS, easing: Easing.linear });
    // Little road bumps while driving.
    vanBounce.value = withRepeat(
      withSequence(withTiming(-4, { duration: 90 }), withTiming(0, { duration: 90 })),
      Math.ceil(CROSS_MS / 180),
      false
    );
    titleScale.value = withDelay(450, withSpring(1, { damping: 7, stiffness: 180 }));
    titleOpacity.value = withSequence(
      withDelay(450, withTiming(1, { duration: 150 })),
      withDelay(TOTAL_MS - 450 - 150 - 250, withTiming(0, { duration: 250 }, (done) => {
        if (done) runOnJS(onFinish)();
      }))
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // If the screen goes away mid-animation (back button), stop the timing so
  // its completion callback runs with done=false and never navigates.
  useEffect(() => () => cancelAnimation(titleOpacity), [titleOpacity]);

  const backdropStyle = useAnimatedStyle(() => ({ opacity: backdrop.value * 0.6 }));
  const vanStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: vanX.value }, { translateY: vanBounce.value }],
  }));
  const titleStyle = useAnimatedStyle(() => ({
    opacity: titleOpacity.value,
    transform: [{ scale: titleScale.value }],
  }));

  // Each star pops the moment the van's rear (its left edge, since it drives
  // right) passes the star's x position.
  const stars = useMemo(() => {
    if (reducedMotion) return [];
    return Array.from({ length: STAR_COUNT }, (_, i) => {
      const x = ((i + 1) / (STAR_COUNT + 1)) * width;
      return {
        x,
        y: pathY + VAN_SIZE * 0.55,
        delay: Math.round(((x - startX) / (endX - startX)) * CROSS_MS),
      };
    });
  }, [reducedMotion, width, pathY, startX, endX]);

  return (
    <View style={StyleSheet.absoluteFill} pointerEvents="auto">
      <Animated.View style={[StyleSheet.absoluteFill, styles.backdrop, backdropStyle]} />
      {stars.map((s, i) => (
        <TrailStar key={i} index={i} x={s.x} y={s.y} delay={s.delay} />
      ))}
      {!reducedMotion && (
        <Animated.View style={[styles.van, { top: pathY, left: 0 }, vanStyle]}>
          <Icon source="van-utility" size={VAN_SIZE} color="#FFFFFF" />
        </Animated.View>
      )}
      <Animated.View
        style={[styles.titleWrap, { top: pathY + VAN_SIZE + 36 }, titleStyle]}
        pointerEvents="none"
      >
        <Animated.Text style={styles.title}>{t("game.unlocked")}</Animated.Text>
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  backdrop: { backgroundColor: "#000" },
  van: { position: "absolute" },
  star: { position: "absolute" },
  titleWrap: {
    position: "absolute",
    left: 0,
    right: 0,
    alignItems: "center",
  },
  title: {
    fontSize: 26,
    fontWeight: "900",
    color: "#FFFFFF",
    textAlign: "center",
    paddingHorizontal: 16,
    textShadowColor: "rgba(0,0,0,0.5)",
    textShadowOffset: { width: 0, height: 2 },
    textShadowRadius: 6,
  },
});
