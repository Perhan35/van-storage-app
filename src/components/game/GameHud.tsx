import React, { useEffect } from "react";
import { View, StyleSheet } from "react-native";
import { Text } from "react-native-paper";
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withSequence,
  withTiming,
} from "react-native-reanimated";
import { useTranslation } from "react-i18next";
import { useAppTheme } from "../../theme/useAppTheme";

const STREAK_COLOR = "#FFD54F";

type Props = {
  score: number;
  streak: number;
};

export function GameHud({ score, streak }: Props) {
  const { t } = useTranslation();
  const { palette } = useAppTheme();
  const scoreScale = useSharedValue(1);

  useEffect(() => {
    scoreScale.value = withSequence(
      withTiming(1.3, { duration: 120 }),
      withTiming(1, { duration: 180 })
    );
  }, [score]);

  const scoreStyle = useAnimatedStyle(() => ({
    transform: [{ scale: scoreScale.value }],
  }));

  return (
    <View style={styles.container}>
      <Animated.View
        style={[styles.pill, scoreStyle, { backgroundColor: palette.primary }]}
      >
        <Text style={styles.pillLabel}>{t("game.score")}</Text>
        <Text style={styles.pillValue}>{score}</Text>
      </Animated.View>
      {streak >= 2 && (
        <View style={[styles.pill, { backgroundColor: STREAK_COLOR }]}>
          <Text style={[styles.pillLabel, { color: "#3E2C00" }]}>
            {t("game.streak")}
          </Text>
          <Text style={[styles.pillValue, { color: "#3E2C00" }]}>
            {"\u{1F525}"} {streak}
          </Text>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flexDirection: "row",
    gap: 10,
    paddingHorizontal: 16,
    paddingTop: 8,
  },
  pill: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingHorizontal: 14,
    paddingVertical: 6,
    borderRadius: 20,
  },
  pillLabel: {
    color: "#FFFFFF",
    fontSize: 12,
    fontWeight: "600",
    textTransform: "uppercase",
  },
  pillValue: {
    color: "#FFFFFF",
    fontSize: 16,
    fontWeight: "800",
  },
});
