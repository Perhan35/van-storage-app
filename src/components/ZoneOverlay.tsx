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
import { DEFAULT_FILL_OPACITY } from "../db/repository";
import { getReadableTextColor } from "../utils/color";
import { useAppTheme } from "../theme/useAppTheme";
import { lightPalette } from "../theme/palette";

const AnimatedRect = Animated.createAnimatedComponent(Rect);

// Fallback for zones with a missing/empty color; react-native-svg rejects "".
const FALLBACK_ZONE_COLOR = "#78909C";

const FONT_SIZES = [11, 10, 9, 8] as const;
const CHAR_WIDTH_RATIO = 0.58;
const LINE_HEIGHT_RATIO = 1.18;

type FitResult = {
  lines: string[];
  fontSize: number;
  lineHeight: number;
};

function tryWrapNoBreak(text: string, maxChars: number): string[] | null {
  const words = text.split(/\s+/);
  const lines: string[] = [];
  let current = "";
  for (const word of words) {
    if (word.length > maxChars) return null;
    const test = current ? `${current} ${word}` : word;
    if (test.length <= maxChars) {
      current = test;
    } else {
      lines.push(current);
      current = word;
    }
  }
  if (current) lines.push(current);
  return lines;
}

function wrapWithTruncate(
  text: string,
  maxChars: number,
  maxLines: number
): string[] {
  const words = text.split(/\s+/);
  const lines: string[] = [];
  let current = "";
  const flush = () => {
    if (current) {
      lines.push(current);
      current = "";
    }
  };
  for (const word of words) {
    if (word.length > maxChars) {
      flush();
      let rest = word;
      while (rest.length > maxChars) {
        lines.push(rest.slice(0, maxChars));
        rest = rest.slice(maxChars);
      }
      current = rest;
      continue;
    }
    const test = current ? `${current} ${word}` : word;
    if (test.length <= maxChars) {
      current = test;
    } else {
      flush();
      current = word;
    }
  }
  flush();
  if (lines.length > maxLines) {
    const truncated = lines.slice(0, maxLines);
    const last = truncated[maxLines - 1];
    truncated[maxLines - 1] =
      last.length > maxChars - 1
        ? last.slice(0, Math.max(maxChars - 1, 1)) + "…"
        : last + "…";
    return truncated;
  }
  return lines;
}

function fitText(
  text: string,
  maxWidth: number,
  maxHeight: number
): FitResult {
  for (const fontSize of FONT_SIZES) {
    const charWidth = fontSize * CHAR_WIDTH_RATIO;
    const lineHeight = fontSize * LINE_HEIGHT_RATIO;
    const maxChars = Math.floor(maxWidth / charWidth);
    const maxLines = Math.max(Math.floor(maxHeight / lineHeight), 1);
    if (maxChars < 2) continue;
    const lines = tryWrapNoBreak(text, maxChars);
    if (lines && lines.length <= maxLines) {
      return { lines, fontSize, lineHeight };
    }
  }
  const fontSize = FONT_SIZES[FONT_SIZES.length - 1];
  const charWidth = fontSize * CHAR_WIDTH_RATIO;
  const lineHeight = fontSize * LINE_HEIGHT_RATIO;
  const maxChars = Math.max(Math.floor(maxWidth / charWidth), 2);
  const maxLines = Math.max(Math.floor(maxHeight / lineHeight), 1);
  return {
    lines: wrapWithTruncate(text, maxChars, maxLines),
    fontSize,
    lineHeight,
  };
}

type Props = {
  zone: ZoneWithCount;
  highlighted: boolean;
};

export function ZoneOverlay({ zone, highlighted }: Props) {
  const { isDark } = useAppTheme();
  const { x, y, w, h } = zone.geometry;
  const cx = x + w / 2;
  const cy = y + h / 2;

  const zoneColor = zone.color || FALLBACK_ZONE_COLOR;
  const restOpacity = zone.fill_opacity ?? DEFAULT_FILL_OPACITY;
  const opacity = useSharedValue(restOpacity);

  useEffect(() => {
    if (highlighted) {
      opacity.value = withRepeat(
        withTiming(0.9, { duration: 500 }),
        -1,
        true
      );
    } else {
      cancelAnimation(opacity);
      opacity.value = restOpacity;
    }
  }, [highlighted, restOpacity]);

  const animatedProps = useAnimatedProps(() => ({
    opacity: opacity.value,
  }));

  // Badge: small, hugging the top-right corner.
  const count = zone.item_count;
  const badgeRadius = count >= 100 ? 11 : count >= 10 ? 9 : 7.5;
  const badgeMargin = 2;
  const badgeCx = x + w - badgeRadius - badgeMargin;
  const badgeCy = y + badgeRadius + badgeMargin;
  const badgeFootprint = count > 0 ? badgeRadius * 2 + badgeMargin : 0;

  // Hybrid orientation: rotate 90° (reading bottom-to-top) when the zone is
  // clearly portrait. Threshold avoids flipping near-square zones.
  const useVertical = h > w * 1.3;

  const padX = 5;
  const padY = 5;

  let textMaxWidth: number;
  let textMaxHeight: number;
  let textCx: number;
  let textCy: number;
  let rotation = 0;

  if (useVertical) {
    // After -90° rotation, the reading axis follows the zone height.
    // Reserve a notch at the "top end" of the reading direction (zone top)
    // so the label clears the badge corner.
    textMaxWidth = h - padY * 2 - badgeFootprint;
    textMaxHeight = w - padX * 2;
    rotation = -90;
    // Shift the center down by half the reserved notch so the rotated text
    // sits below the badge instead of being globally centered.
    textCx = cx;
    textCy = cy + badgeFootprint / 2;
  } else {
    // Horizontal: reserve on the right for the badge.
    const leftEdge = x + padX;
    const rightEdge = x + w - padX - badgeFootprint;
    textMaxWidth = Math.max(rightEdge - leftEdge, 16);
    textMaxHeight = h - padY * 2;
    textCx = (leftEdge + rightEdge) / 2;
    textCy = cy;
  }

  const { lines, fontSize, lineHeight } = fitText(
    zone.name,
    textMaxWidth,
    textMaxHeight
  );

  // Center the multi-line block on (textCx, textCy). For SVG text the y
  // coordinate is the baseline of the first line.
  const textBlockHeight = lines.length * lineHeight;
  const firstBaselineY =
    textCy - textBlockHeight / 2 + fontSize * 0.85;

  return (
    <G>
      <AnimatedRect
        x={x}
        y={y}
        width={w}
        height={h}
        rx={8}
        ry={8}
        fill={zoneColor}
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
        stroke={highlighted ? "#FFFFFF" : zoneColor}
        strokeWidth={highlighted ? 3 : 1.5}
      />
      <SvgText
        x={textCx}
        y={firstBaselineY}
        textAnchor="middle"
        fill={isDark ? "#FFFFFF" : getReadableTextColor(zoneColor, zone.fill_opacity ?? DEFAULT_FILL_OPACITY, lightPalette.background)}
        fontSize={fontSize}
        fontWeight="600"
        transform={
          rotation !== 0
            ? `rotate(${rotation} ${textCx} ${textCy})`
            : undefined
        }
      >
        {lines.map((line, i) => (
          <TSpan key={i} x={textCx} dy={i === 0 ? 0 : lineHeight}>
            {line}
          </TSpan>
        ))}
      </SvgText>
      <ItemCountBadge cx={badgeCx} cy={badgeCy} count={count} />
    </G>
  );
}
