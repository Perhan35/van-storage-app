import React, { useMemo } from "react";
import { IconButton } from "react-native-paper";
import { useAppTheme } from "../theme/useAppTheme";

type Tone =
  | "default"
  | "danger"
  | "success"
  | "accent"
  | "utility"
  | "outOfVan"
  | "search"
  | "action";

type Props = {
  icon: string;
  onPress: () => void;
  tone?: Tone;
  disabled?: boolean;
  size?: number;
  accessibilityLabel?: string;
};

/**
 * A single icon in a navigation header.
 *
 * Paper's IconButton drops the `iconColor` prop whenever `disabled` is set and
 * falls back to `onSurfaceDisabled` — a 38%-alpha tint meant for the app's
 * surfaces, which on the header bar rendered at 2.35:1 (dark) and 1.84:1
 * (light) and left undo/redo effectively invisible. Overriding that token per
 * instance keeps the disabled state on the header's own contrast-checked scale
 * while leaving Paper's press/ripple behaviour intact.
 */
export function HeaderIcon({
  icon,
  onPress,
  tone = "default",
  disabled,
  size = 24,
  accessibilityLabel,
}: Props) {
  const { palette } = useAppTheme();

  const iconColor =
    tone === "danger"
      ? palette.headerDanger
      : tone === "success"
        ? palette.headerSuccess
        : tone === "accent"
          ? palette.secondary // the app's coral CTA color, e.g. the add-item FAB
          : tone === "utility"
            ? palette.headerUtility
            : tone === "outOfVan"
              ? palette.headerOutOfVan
              : tone === "search"
                ? palette.headerSearch
                : tone === "action"
                  ? palette.headerActionTint // undo/redo — distinct from headerTint, which also drives the title text
                  : palette.headerTint;

  // "action" (undo/redo) is the only tone that's ever actually disabled today,
  // so it's the only one with a dedicated muted color; everything else still
  // falls back to headerTintMuted.
  const disabledColor = tone === "action" ? palette.headerActionTintMuted : palette.headerTintMuted;

  const theme = useMemo(
    () => ({ colors: { onSurfaceDisabled: disabledColor } }),
    [disabledColor]
  );

  return (
    <IconButton
      icon={icon}
      size={size}
      iconColor={iconColor}
      disabled={disabled}
      theme={theme}
      accessibilityLabel={accessibilityLabel}
      style={{ margin: 0 }}
      onPress={onPress}
    />
  );
}
