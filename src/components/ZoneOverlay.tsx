import React, { useEffect } from "react";
import { Rect, G, Text as SvgText } from "react-native-svg";
import Animated, {
  useSharedValue,
  useAnimatedProps,
  withRepeat,
  withTiming,
  cancelAnimation,
} from "react-native-reanimated";
import { ItemCountBadge } from "./ItemCountBadge";
import { ZoneWithCount } from "../db/database";

const AnimatedRect = Animated.createAnimatedComponent(Rect);

type Props = {
  zone: ZoneWithCount;
  highlighted: boolean;
  onPress: () => void;
};

export function ZoneOverlay({ zone, highlighted, onPress }: Props) {
  const { x, y, w, h } = zone.geometry;
  const cx = x + w / 2;
  const cy = y + h / 2;
  const opacity = useSharedValue(0.4);

  useEffect(() => {
    if (highlighted) {
      opacity.value = withRepeat(
        withTiming(0.9, { duration: 500 }),
        -1,
        true
      );
    } else {
      cancelAnimation(opacity);
      opacity.value = 0.4;
    }
  }, [highlighted]);

  const animatedProps = useAnimatedProps(() => ({
    opacity: opacity.value,
  }));

  return (
    <G onPress={onPress}>
      <AnimatedRect
        x={x}
        y={y}
        width={w}
        height={h}
        rx={8}
        ry={8}
        fill={zone.color}
        animatedProps={animatedProps}
      />
      <Rect
        x={x}
        y={y}
        width={w}
        height={h}
        rx={8}
        ry={8}
        fill="none"
        stroke={highlighted ? "#FFFFFF" : zone.color}
        strokeWidth={highlighted ? 3 : 1.5}
      />
      <SvgText
        x={cx}
        y={y + 18}
        textAnchor="middle"
        fill="#FFFFFF"
        fontSize={11}
        fontWeight="600"
      >
        {zone.name.length > 18 ? zone.name.slice(0, 16) + "..." : zone.name}
      </SvgText>
      <ItemCountBadge cx={cx} cy={cy + 10} count={zone.item_count} />
    </G>
  );
}
