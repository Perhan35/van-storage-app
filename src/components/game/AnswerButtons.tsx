import React from "react";
import { View, Pressable, StyleSheet } from "react-native";
import { Text, Icon } from "react-native-paper";
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withSpring,
} from "react-native-reanimated";
import { useAppTheme } from "../../theme/useAppTheme";

const SUCCESS_COLOR = "#4CAF50";

export type AnswerChoice = {
  key: string;
  label: string;
  icon?: string;
};

type ButtonState = "idle" | "correct" | "wrong" | "dimmed";

type Props = {
  choices: AnswerChoice[];
  disabled: boolean;
  correctKey: string | null;
  selectedKey: string | null;
  onSelect: (key: string) => void;
};

function stateOf(
  choice: AnswerChoice,
  correctKey: string | null,
  selectedKey: string | null
): ButtonState {
  if (!correctKey) return "idle";
  if (choice.key === correctKey) return "correct";
  if (choice.key === selectedKey) return "wrong";
  return "dimmed";
}

function AnswerButton({
  choice,
  state,
  disabled,
  onPress,
}: {
  choice: AnswerChoice;
  state: ButtonState;
  disabled: boolean;
  onPress: () => void;
}) {
  const { palette } = useAppTheme();
  const scale = useSharedValue(1);
  const style = useAnimatedStyle(() => ({ transform: [{ scale: scale.value }] }));

  const highlighted = state === "correct" || state === "wrong";
  const bg =
    state === "correct"
      ? SUCCESS_COLOR
      : state === "wrong"
        ? palette.danger
        : state === "dimmed"
          ? palette.surfaceVariant
          : palette.surface;
  const textColor = highlighted ? "#FFFFFF" : palette.onSurface;

  return (
    <Animated.View style={[styles.buttonWrap, style]}>
      <Pressable
        disabled={disabled}
        onPressIn={() => {
          scale.value = withSpring(0.94);
        }}
        onPressOut={() => {
          scale.value = withSpring(1);
        }}
        onPress={onPress}
        style={[styles.button, { backgroundColor: bg, borderColor: palette.outline }]}
      >
        {choice.icon && <Icon source={choice.icon} size={22} color={textColor} />}
        <Text style={[styles.label, { color: textColor }]}>{choice.label}</Text>
      </Pressable>
    </Animated.View>
  );
}

export function AnswerButtons({ choices, disabled, correctKey, selectedKey, onSelect }: Props) {
  return (
    <View style={styles.row}>
      {choices.map((choice) => (
        <AnswerButton
          key={choice.key}
          choice={choice}
          state={stateOf(choice, correctKey, selectedKey)}
          disabled={disabled}
          onPress={() => onSelect(choice.key)}
        />
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: "row",
    flexWrap: "wrap",
    justifyContent: "center",
    gap: 10,
    paddingHorizontal: 16,
    paddingBottom: 24,
    paddingTop: 12,
  },
  buttonWrap: {
    minWidth: "42%",
  },
  button: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    paddingVertical: 14,
    paddingHorizontal: 12,
    borderRadius: 12,
    borderWidth: 1,
  },
  label: {
    fontSize: 15,
    fontWeight: "700",
  },
});
