import React, { useState, useCallback } from "react";
import { View, LayoutChangeEvent, StyleSheet, Pressable } from "react-native";
import Svg, { Text as SvgText } from "react-native-svg";
import { useSharedValue } from "react-native-reanimated";
import { VanOutline } from "./VanOutline";
import { ZoneOverlay } from "./ZoneOverlay";
import { ZoneEditOverlay } from "./ZoneEditOverlay";
import { useZoomScale } from "./ZoomableContainer";
import { useAppStore } from "../store/useAppStore";
import { Zone, ZoneWithCount } from "../db/database";
import { useTranslation } from "react-i18next";
import { SVG_W, SVG_H, ZONE_OVERFLOW_MARGIN } from "./vanLayoutConstants";

// Padding (in SVG units) kept around the zones' bounding box when fitting
// the default (non-edit) view to them.
const ZONES_FIT_PADDING = 24;

export type ZoneScreenRect = { left: number; top: number; width: number; height: number };

type Props = {
  onZonePress: (zoneId: string, rect: ZoneScreenRect) => void;
};

function getZonesBoundingBox(zones: ZoneWithCount[]) {
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

export function VanLayoutSVG({ onZonePress }: Props) {
  const { t } = useTranslation();
  const zones = useAppStore((s) => s.zones);
  const highlightedZoneId = useAppStore((s) => s.highlightedZoneId);
  const editMode = useAppStore((s) => s.editMode);
  const updateZoneGeometry = useAppStore((s) => s.updateZoneGeometry);

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

  // Total canvas size includes the overflow margin around the van outline,
  // so zones can be dragged/resized past the van's edges without being clipped.
  const canvasW = SVG_W + ZONE_OVERFLOW_MARGIN * 2;
  const canvasH = SVG_H + ZONE_OVERFLOW_MARGIN * 2;

  // In edit mode, fit the whole canvas (van + overflow margin) so the user
  // can see and reach every spot a zone could be dragged to. Otherwise, fit
  // tightly to the zones themselves so the default view isn't mostly empty
  // margin.
  const zonesBBox = getZonesBoundingBox(zones);
  let viewBoxMinX: number;
  let viewBoxMinY: number;
  let viewBoxW: number;
  let viewBoxH: number;
  if (editMode || !zonesBBox) {
    viewBoxMinX = -ZONE_OVERFLOW_MARGIN;
    viewBoxMinY = -ZONE_OVERFLOW_MARGIN;
    viewBoxW = canvasW;
    viewBoxH = canvasH;
  } else {
    viewBoxMinX = zonesBBox.minX - ZONES_FIT_PADDING;
    viewBoxMinY = zonesBBox.minY - ZONES_FIT_PADDING;
    viewBoxW = zonesBBox.maxX - zonesBBox.minX + ZONES_FIT_PADDING * 2;
    viewBoxH = zonesBBox.maxY - zonesBBox.minY + ZONES_FIT_PADDING * 2;
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
        <VanOutline />
        <SvgText
          x={150}
          y={15}
          textAnchor="middle"
          fill="#78909C"
          fontSize={13}
          fontWeight="bold"
        >
          {t("map.front")}
        </SvgText>
        <SvgText
          x={150}
          y={595}
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

      {/* Edit mode overlays */}
      {editMode &&
        layout &&
        zones.map((zone) => (
          <ZoneEditOverlay
            key={zone.id}
            zone={zone}
            fitScale={svgScale}
            zoomScale={zoomScale}
            offsetX={svgOffsetX}
            offsetY={svgOffsetY}
            otherZones={zones
              .filter((z) => z.id !== zone.id)
              .map((z) => z.geometry)}
            onGeometryChange={handleGeometryChange}
          />
        ))}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
});
