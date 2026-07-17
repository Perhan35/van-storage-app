import React from "react";
import { Path } from "react-native-svg";
import { Outline } from "../db/templates";

// Builds an SVG path from the outline's points, drawing each segment as a line
// or, when the segment's end point carries a `control`, a quadratic Bézier.
// The segment ending at points[0] is the closing segment back to the start.
export function outlineToPath(outline: Outline): string {
  const { points } = outline;
  if (points.length === 0) return "";
  const p0 = points[0];
  let d = `M ${p0.x} ${p0.y}`;
  for (let i = 1; i < points.length; i++) {
    const p = points[i];
    d += p.control ? ` Q ${p.control.x} ${p.control.y} ${p.x} ${p.y}` : ` L ${p.x} ${p.y}`;
  }
  // Closing segment (last -> first): a curve if points[0] has a control.
  d += p0.control ? ` Q ${p0.control.x} ${p0.control.y} ${p0.x} ${p0.y} Z` : " Z";
  return d;
}

type Props = {
  outline: Outline;
};

export function LocationOutline({ outline }: Props) {
  return <Path d={outlineToPath(outline)} fill="none" stroke="#546E7A" strokeWidth={3} />;
}
