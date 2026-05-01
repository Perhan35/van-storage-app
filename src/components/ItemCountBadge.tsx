import React from "react";
import { Circle, Text as SvgText, G } from "react-native-svg";

type Props = {
  cx: number;
  cy: number;
  count: number;
};

export function ItemCountBadge({ cx, cy, count }: Props) {
  if (count === 0) return null;
  const radius = count >= 100 ? 11 : count >= 10 ? 9 : 7.5;
  const fontSize = count >= 100 ? 9 : count >= 10 ? 10 : 10;
  return (
    <G>
      <Circle cx={cx} cy={cy} r={radius + 1} fill="#FFFFFF" opacity={0.9} />
      <Circle cx={cx} cy={cy} r={radius} fill="#D32F2F" />
      <SvgText
        x={cx}
        y={cy + fontSize / 3}
        textAnchor="middle"
        fill="white"
        fontSize={fontSize}
        fontWeight="bold"
      >
        {count}
      </SvgText>
    </G>
  );
}
