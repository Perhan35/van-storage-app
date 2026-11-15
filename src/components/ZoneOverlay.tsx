import React, { useEffect, useMemo, useRef } from "react";
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
import { DEFAULT_ZONE_COLOR, getReadableTextColor } from "../utils/color";
import { useAppTheme } from "../theme/useAppTheme";
import { lightPalette, darkPalette } from "../theme/palette";

const AnimatedRect = Animated.createAnimatedComponent(Rect);

// Fallback for zones with a missing/empty color; react-native-svg rejects "".

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
  dimmed: boolean;
  // Zone editing: draw the dashed "editable" outline (see EditDashOutline).
  editing?: boolean;
};

// The dashed outline zone editing puts on every zone. It used to be a dashed
// RN border on ZoneEditOverlay's body, but iOS draws non-solid borders into a
// bitmap, which the zoomed canvas then magnified into blocky dashes; drawn
// here it's part of the SVG, which the sharp layer redraws at screen
// resolution. Same look as that border: 2 wide, dash = gap = 3x width (RN's
// pattern), inset so it sits inside the edge like a border does.
function EditDashOutline({ geometry, color }: { geometry: ZoneWithCount["geometry"]; color: string }) {
  const { x, y, w, h } = geometry;
  return (
    <Rect
      x={x + 1}
      y={y + 1}
      width={Math.max(w - 2, 0)}
      height={Math.max(h - 2, 0)}
      rx={7}
      ry={7}
      fill="none"
      stroke={color}
      strokeWidth={2}
      strokeDasharray="6 6"
    />
  );
}

type ZoneLabelLayout = {
  lines: string[];
  fontSize: number;
  lineHeight: number;
  textCx: number;
  textCy: number;
  firstBaselineY: number;
  rotation: number;
  badgeCx: number;
  badgeCy: number;
};

// Where the name and the item-count badge go inside a zone. Pure, so the
// animated zone and the still one (StaticZoneOverlay) lay out identically.
function zoneLabelLayout(zone: ZoneWithCount): ZoneLabelLayout {
  const { x, y, w, h } = zone.geometry;
  const cx = x + w / 2;
  const cy = y + h / 2;

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

  const { lines, fontSize, lineHeight } = fitText(zone.name, textMaxWidth, textMaxHeight);

  // Center the multi-line block on (textCx, textCy). For SVG text the y
  // coordinate is the baseline of the first line.
  const textBlockHeight = lines.length * lineHeight;
  const firstBaselineY =
    textCy - textBlockHeight / 2 + fontSize * 0.85;

  return {
    lines,
    fontSize,
    lineHeight,
    textCx,
    textCy,
    firstBaselineY,
    rotation,
    badgeCx,
    badgeCy,
  };
}

function ZoneLabel({
  label,
  color,
  count,
}: {
  label: ZoneLabelLayout;
  color: string;
  count: number;
}) {
  const { lines, fontSize, lineHeight, textCx, textCy, firstBaselineY, rotation } = label;
  return (
    <>
      <SvgText
        x={textCx}
        y={firstBaselineY}
        textAnchor="middle"
        fill={color}
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
      <ItemCountBadge cx={label.badgeCx} cy={label.badgeCy} count={count} />
    </>
  );
}

function ZoneOverlayInner({ zone, highlighted, dimmed, editing }: Props) {
  const { isDark } = useAppTheme();
  const { x, y, w, h } = zone.geometry;

  const zoneColor = zone.color || DEFAULT_ZONE_COLOR;
  const restOpacity = zone.fill_opacity ?? DEFAULT_FILL_OPACITY;
  const opacity = useSharedValue(restOpacity);
  const strokeWidth = useSharedValue(1.5);
  const strokeOpacity = useSharedValue(1);

  // The shared values above already start at rest. Without this, mounting a
  // zone at rest ran the "back to rest" branch below anyway: three 300 ms
  // timings from each value to itself. Invisible, but with two dozen zones that
  // was 60 animations pushing SVG prop updates every frame — on app start and,
  // worse, on every van opening, right on top of the opening flight.
  const isFirstRun = useRef(true);

  useEffect(() => {
    if (isFirstRun.current) {
      isFirstRun.current = false;
      if (!highlighted && !dimmed) return;
    }
    if (highlighted) {
      opacity.value = withRepeat(withTiming(1, { duration: 350 }), -1, true);
      strokeWidth.value = withRepeat(
        withTiming(6, { duration: 350 }),
        -1,
        true
      );
      strokeOpacity.value = withTiming(1, { duration: 200 });
    } else if (dimmed) {
      cancelAnimation(opacity);
      cancelAnimation(strokeWidth);
      opacity.value = withTiming(restOpacity * 0.15, { duration: 300 });
      strokeWidth.value = withTiming(1.5, { duration: 300 });
      strokeOpacity.value = withTiming(0.15, { duration: 300 });
    } else {
      cancelAnimation(opacity);
      cancelAnimation(strokeWidth);
      opacity.value = withTiming(restOpacity, { duration: 300 });
      strokeWidth.value = withTiming(1.5, { duration: 300 });
      strokeOpacity.value = withTiming(1, { duration: 300 });
    }
  }, [highlighted, dimmed, restOpacity]);

  const animatedProps = useAnimatedProps(() => ({
    opacity: opacity.value,
  }));

  const animatedStrokeProps = useAnimatedProps(() => ({
    strokeWidth: strokeWidth.value,
    opacity: strokeOpacity.value,
  }));

  // Word-wrapping tries up to 4 font sizes per call — worth memoizing since it
  // otherwise reran every time this component rendered, including renders
  // where the zone's name/size/count haven't actually changed (see the
  // React.memo below).
  const label = useMemo(
    () => zoneLabelLayout(zone),
    [zone.name, x, y, w, h, zone.item_count]
  );
  const textColor = getReadableTextColor(
    zoneColor,
    restOpacity,
    isDark ? darkPalette.background : lightPalette.background
  );

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
      <AnimatedRect
        x={x}
        y={y}
        width={w}
        height={h}
        rx={8}
        ry={8}
        fill="none"
        stroke={highlighted ? "#FFFFFF" : zoneColor}
        animatedProps={animatedStrokeProps}
      />
      <ZoneLabel label={label} color={textColor} count={zone.item_count} />
      {editing && <EditDashOutline geometry={zone.geometry} color={zoneColor} />}
    </G>
  );
}

// Memoized: VanLayoutSVG renders one of these per zone, and re-renders for
// reasons that touch only one zone at a time (highlight/dim on select,
// geometry drag) or none of them (layout/gesture-only updates). Without this,
// every zone repeated the text-fit + animated-prop work above on every one of
// those renders.
export const ZoneOverlay = React.memo(ZoneOverlayInner);

// The zone exactly as ZoneOverlay draws it at rest, with no animation at all:
// no shared values, no animated props, no mount-time transitions. For short-
// lived copies of the plan (the edit-mode transition cover), where mounting
// two dozen animated zones — each one then running its three mount
// transitions on every frame — made entering edit mode visibly slow.
function StaticZoneOverlayInner({
  zone,
  editing,
}: {
  zone: ZoneWithCount;
  editing?: boolean;
}) {
  const { isDark } = useAppTheme();
  const { x, y, w, h } = zone.geometry;
  const zoneColor = zone.color || DEFAULT_ZONE_COLOR;
  const restOpacity = zone.fill_opacity ?? DEFAULT_FILL_OPACITY;
  const label = useMemo(
    () => zoneLabelLayout(zone),
    [zone.name, x, y, w, h, zone.item_count]
  );
  const textColor = getReadableTextColor(
    zoneColor,
    restOpacity,
    isDark ? darkPalette.background : lightPalette.background
  );
  return (
    <G>
      <Rect x={x} y={y} width={w} height={h} rx={8} ry={8} fill={zoneColor} opacity={restOpacity} />
      <Rect
        x={x}
        y={y}
        width={w}
        height={h}
        rx={8}
        ry={8}
        fill="none"
        stroke={zoneColor}
        strokeWidth={1.5}
      />
      <ZoneLabel label={label} color={textColor} count={zone.item_count} />
      {editing && <EditDashOutline geometry={zone.geometry} color={zoneColor} />}
    </G>
  );
}

export const StaticZoneOverlay = React.memo(StaticZoneOverlayInner);
