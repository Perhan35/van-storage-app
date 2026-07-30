import React, { useEffect } from "react";
import { StyleSheet, View } from "react-native";
import { Icon, Text } from "react-native-paper";
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withTiming,
} from "react-native-reanimated";
import { useAppTheme } from "../../theme/useAppTheme";

type Props = {
  text: string;
  questionKey: string;
  // The subject's location icon; omitted (null) for "where is" questions,
  // since those ask the player to find the location rather than showing it.
  icon?: string | null;
};

export function QuestionBanner({ text, questionKey, icon }: Props) {
  const { palette } = useAppTheme();
  const translateY = useSharedValue(-24);
  const opacity = useSharedValue(0);

  useEffect(() => {
    translateY.value = -24;
    opacity.value = 0;
    translateY.value = withTiming(0, { duration: 280 });
    opacity.value = withTiming(1, { duration: 280 });
  }, [questionKey]);

  const style = useAnimatedStyle(() => ({
    transform: [{ translateY: translateY.value }],
    opacity: opacity.value,
  }));

  return (
    <Animated.View
      style={[styles.banner, style, { backgroundColor: palette.surface }]}
    >
      <View style={styles.row}>
        {icon && <Icon source={icon} size={18} color={palette.onSurfaceVariant} />}
        <Text style={[styles.text, { color: palette.onSurface }]}>{text}</Text>
      </View>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  banner: {
    marginHorizontal: 16,
    marginTop: 12,
    paddingHorizontal: 16,
    paddingVertical: 14,
    borderRadius: 14,
    elevation: 3,
    shadowColor: "#000",
    shadowOpacity: 0.15,
    shadowRadius: 6,
    shadowOffset: { width: 0, height: 2 },
  },
  row: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
  },
  text: {
    flexShrink: 1,
    fontSize: 17,
    fontWeight: "700",
    textAlign: "center",
  },
});
