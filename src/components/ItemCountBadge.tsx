import React from "react";
import { Circle, Text as SvgText, G } from "react-native-svg";

type Props = {
  cx: number;
  cy: number;
  count: number;
};

export function ItemCountBadge({ cx, cy, count }: Props) {
  if (count === 0) return null;
  const radius = count >= 100 ? 18 : count >= 10 ? 15 : 12;
  return (
    <G>
      <Circle cx={cx} cy={cy} r={radius} fill="#D32F2F" />
      <SvgText
        x={cx}
        y={cy + 5}
        textAnchor="middle"
        fill="white"
        fontSize={radius > 12 ? 12 : 11}
        fontWeight="bold"
      >
        {count}
      </SvgText>
    </G>
  );
}
