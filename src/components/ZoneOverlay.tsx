import React, { useEffect } from "react";
import { Rect, G, Text as SvgText, TSpan } from "react-native-svg";
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

function wrapText(text: string, maxWidth: number, fontSize: number): string[] {
  const charWidth = fontSize * 0.58;
  const maxChars = Math.max(Math.floor(maxWidth / charWidth), 4);
  if (text.length <= maxChars) return [text];
  const words = text.split(/\s+/);
  const lines: string[] = [];
  let currentLine = "";
  for (const word of words) {
    const test = currentLine ? `${currentLine} ${word}` : word;
    if (test.length <= maxChars) {
      currentLine = test;
    } else {
      if (currentLine) lines.push(currentLine);
      currentLine = word;
    }
  }
  if (currentLine) lines.push(currentLine);
  return lines.slice(0, 3);
}

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
        y={y + 14}
        textAnchor="middle"
        fill="#FFFFFF"
        fontSize={11}
        fontWeight="600"
      >
        {wrapText(zone.name, w - 16, 11).map((line, i) => (
          <TSpan key={i} x={cx} dy={i === 0 ? 0 : 13}>
            {line}
          </TSpan>
        ))}
      </SvgText>
      <ItemCountBadge cx={cx} cy={cy + 10} count={zone.item_count} />
    </G>
  );
}
