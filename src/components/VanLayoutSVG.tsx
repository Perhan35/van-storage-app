import React, { useState, useCallback } from "react";
import { View, LayoutChangeEvent, StyleSheet, Pressable } from "react-native";
import Svg, { Text as SvgText } from "react-native-svg";
import { useSharedValue } from "react-native-reanimated";
import { LocationOutline } from "./LocationOutline";
import { ZoneOverlay } from "./ZoneOverlay";
import { ZoneEditOverlay } from "./ZoneEditOverlay";
import { OutlineEditOverlay } from "./OutlineEditOverlay";
import { useZoomScale } from "./ZoomableContainer";
import { useAppStore } from "../store/useAppStore";
import { Zone, ZoneWithCount } from "../db/database";
import { Outline } from "../db/templates";
import { useTranslation } from "react-i18next";
import { DEFAULT_CANVAS_W, DEFAULT_CANVAS_H, ZONE_OVERFLOW_MARGIN, getZoneBounds } from "./layoutConstants";

// Padding (in SVG units) kept around the zones' bounding box when fitting
// the default (non-edit) view to them.
const ZONES_FIT_PADDING = 24;

export type ZoneScreenRect = { left: number; top: number; width: number; height: number };

type Props = {
  onZonePress: (zoneId: string, rect: ZoneScreenRect) => void;
};

type BBox = { minX: number; minY: number; maxX: number; maxY: number };

function unionBBox(a: BBox | null, b: BBox | null): BBox | null {
  if (!a) return b;
  if (!b) return a;
  return {
    minX: Math.min(a.minX, b.minX),
    minY: Math.min(a.minY, b.minY),
    maxX: Math.max(a.maxX, b.maxX),
    maxY: Math.max(a.maxY, b.maxY),
  };
}

function getZonesBoundingBox(zones: ZoneWithCount[]): BBox | null {
  if (zones.length === 0) return null;
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const zone of zones) {
    const { x, y, w, h } = zone.geometry;
    minX = Math.min(minX, x);
    minY = Math.min(minY, y);
    maxX = Math.max(maxX, x + w);
    maxY = Math.max(maxY, y + h);
  }
  return { minX, minY, maxX, maxY };
}

// Bounds of the outline itself, including each vertex *and* each curve control
// point — a control can sit well outside the vertices (a curve bowed past the
// frame), so it must count or that part of the outline would render clipped.
function getOutlineBoundingBox(outline: Outline): BBox {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  const consider = (x: number, y: number) => {
    minX = Math.min(minX, x);
    minY = Math.min(minY, y);
    maxX = Math.max(maxX, x);
    maxY = Math.max(maxY, y);
  };
  for (const p of outline.points) {
    consider(p.x, p.y);
    if (p.control) consider(p.control.x, p.control.y);
  }
  if (!Number.isFinite(minX)) return { minX: 0, minY: 0, maxX: outline.w, maxY: outline.h };
  return { minX, minY, maxX, maxY };
}

export function VanLayoutSVG({ onZonePress }: Props) {
  const { t } = useTranslation();
  const zones = useAppStore((s) => s.zones);
  const activeLocation = useAppStore((s) =>
    s.locations.find((l) => l.id === s.activeLocationId)
  );
  const highlightedZoneId = useAppStore((s) => s.highlightedZoneId);
  const editMode = useAppStore((s) => s.editMode);
  const outlineEditMode = useAppStore((s) => s.outlineEditMode);
  const updateZoneGeometry = useAppStore((s) => s.updateZoneGeometry);
  const updateLocationOutline = useAppStore((s) => s.updateLocationOutline);

  const outline: Outline = activeLocation?.outline ?? {
    w: DEFAULT_CANVAS_W,
    h: DEFAULT_CANVAS_H,
    points: [
      { x: 0, y: 0 },
      { x: DEFAULT_CANVAS_W, y: 0 },
      { x: DEFAULT_CANVAS_W, y: DEFAULT_CANVAS_H },
      { x: 0, y: DEFAULT_CANVAS_H },
    ],
  };
  const canvasW = outline.w;
  const canvasH = outline.h;
  const zoneBounds = getZoneBounds(canvasW, canvasH);

  const [layout, setLayout] = useState<{
    width: number;
    height: number;
  } | null>(null);

  // Live pinch-zoom level from the ancestor ZoomableContainer, used to
  // convert screen-pixel drag deltas to SVG units as the user zooms in.
  const fallbackZoomScale = useSharedValue(1);
  const zoomScale = useZoomScale() ?? fallbackZoomScale;

  const onLayout = useCallback((e: LayoutChangeEvent) => {
    const { width, height } = e.nativeEvent.layout;
    setLayout({ width, height });
  }, []);

  // Content = the zones plus the outline (with its curve control points). Both
  // views frame this so nothing the user drew — including a curve pushed past
  // the frame — is ever clipped out of view.
  const contentBBox = unionBBox(getZonesBoundingBox(zones), getOutlineBoundingBox(outline))!;

  let viewBoxMinX: number;
  let viewBoxMinY: number;
  let viewBoxW: number;
  let viewBoxH: number;
  if (editMode) {
    // Show the standard editable area (canvas + overflow margin, where zones
    // and vertices may be dragged) unioned with any content already beyond it,
    // so curves bowed past the frame stay visible and grabbable while editing.
    const minX = Math.min(-ZONE_OVERFLOW_MARGIN, contentBBox.minX);
    const minY = Math.min(-ZONE_OVERFLOW_MARGIN, contentBBox.minY);
    const maxX = Math.max(canvasW + ZONE_OVERFLOW_MARGIN, contentBBox.maxX);
    const maxY = Math.max(canvasH + ZONE_OVERFLOW_MARGIN, contentBBox.maxY);
    viewBoxMinX = minX;
    viewBoxMinY = minY;
    viewBoxW = maxX - minX;
    viewBoxH = maxY - minY;
  } else {
    viewBoxMinX = contentBBox.minX - ZONES_FIT_PADDING;
    viewBoxMinY = contentBBox.minY - ZONES_FIT_PADDING;
    viewBoxW = contentBBox.maxX - contentBBox.minX + ZONES_FIT_PADDING * 2;
    viewBoxH = contentBBox.maxY - contentBBox.minY + ZONES_FIT_PADDING * 2;
  }

  // Compute SVG -> screen mapping
  let svgScale = 1;
  let svgOffsetX = 0;
  let svgOffsetY = 0;
  if (layout) {
    svgScale = Math.min(layout.width / viewBoxW, layout.height / viewBoxH);
    svgOffsetX =
      (layout.width - viewBoxW * svgScale) / 2 - viewBoxMinX * svgScale;
    svgOffsetY =
      (layout.height - viewBoxH * svgScale) / 2 - viewBoxMinY * svgScale;
  }

  const handleGeometryChange = useCallback(
    (zoneId: string, geometry: Zone["geometry"]) => {
      updateZoneGeometry(zoneId, geometry);
    },
    [updateZoneGeometry]
  );

  return (
    <View style={styles.container} onLayout={onLayout}>
      <Svg
        viewBox={`${viewBoxMinX} ${viewBoxMinY} ${viewBoxW} ${viewBoxH}`}
        style={{ flex: 1 }}
      >
        <LocationOutline outline={outline} />
        <SvgText
          x={canvasW / 2}
          y={15}
          textAnchor="middle"
          fill="#78909C"
          fontSize={13}
          fontWeight="bold"
        >
          {t("map.front")}
        </SvgText>
        <SvgText
          x={canvasW / 2}
          y={canvasH - 5}
          textAnchor="middle"
          fill="#78909C"
          fontSize={13}
          fontWeight="bold"
        >
          {t("map.rear")}
        </SvgText>
        {zones.map((zone) => (
          <ZoneOverlay
            key={zone.id}
            zone={zone}
            highlighted={highlightedZoneId === zone.id}
            dimmed={
              highlightedZoneId !== null && highlightedZoneId !== zone.id
            }
          />
        ))}
      </Svg>

      {/* Native pressable overlays for zone tapping (works reliably on Android) */}
      {!editMode &&
        !outlineEditMode &&
        layout &&
        zones.map((zone) => {
          const { x, y, w, h } = zone.geometry;
          const left = x * svgScale + svgOffsetX;
          const top = y * svgScale + svgOffsetY;
          const width = w * svgScale;
          const height = h * svgScale;
          return (
            <Pressable
              key={zone.id}
              onPress={() => onZonePress(zone.id, { left, top, width, height })}
              style={{
                position: "absolute",
                left,
                top,
                width,
                height,
                borderRadius: 8,
              }}
            />
          );
        })}

      {/* Edit mode overlays: either move/resize zones, or edit the outline. */}
      {editMode &&
        !outlineEditMode &&
        layout &&
        zones.map((zone) => (
          <ZoneEditOverlay
            key={zone.id}
            zone={zone}
            fitScale={svgScale}
            zoomScale={zoomScale}
            offsetX={svgOffsetX}
            offsetY={svgOffsetY}
            minX={zoneBounds.minX}
            maxX={zoneBounds.maxX}
            minY={zoneBounds.minY}
            maxY={zoneBounds.maxY}
            otherZones={zones
              .filter((z) => z.id !== zone.id)
              .map((z) => z.geometry)}
            onGeometryChange={handleGeometryChange}
          />
        ))}

      {editMode && outlineEditMode && layout && activeLocation && (
        <OutlineEditOverlay
          outline={outline}
          fitScale={svgScale}
          zoomScale={zoomScale}
          offsetX={svgOffsetX}
          offsetY={svgOffsetY}
          color="#546E7A"
          onChange={(points) =>
            updateLocationOutline(activeLocation.id, { ...outline, points })
          }
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
});
