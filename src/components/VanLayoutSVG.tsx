import React, { useState, useCallback } from "react";
import { View, LayoutChangeEvent, StyleSheet } from "react-native";
import Svg, { Text as SvgText } from "react-native-svg";
import { VanOutline } from "./VanOutline";
import { ZoneOverlay } from "./ZoneOverlay";
import { ZoneEditOverlay } from "./ZoneEditOverlay";
import { useAppStore } from "../store/useAppStore";
import { Zone } from "../db/database";

const SVG_W = 300;
const SVG_H = 600;

type Props = {
  onZonePress: (zoneId: string) => void;
};

export function VanLayoutSVG({ onZonePress }: Props) {
  const zones = useAppStore((s) => s.zones);
  const highlightedZoneId = useAppStore((s) => s.highlightedZoneId);
  const editMode = useAppStore((s) => s.editMode);
  const updateZoneGeometry = useAppStore((s) => s.updateZoneGeometry);

  const [layout, setLayout] = useState<{
    width: number;
    height: number;
  } | null>(null);

  const onLayout = useCallback((e: LayoutChangeEvent) => {
    const { width, height } = e.nativeEvent.layout;
    setLayout({ width, height });
  }, []);

  // Compute SVG -> screen mapping
  let svgScale = 1;
  let svgOffsetX = 0;
  let svgOffsetY = 0;
  if (layout) {
    svgScale = Math.min(layout.width / SVG_W, layout.height / SVG_H);
    svgOffsetX = (layout.width - SVG_W * svgScale) / 2;
    svgOffsetY = (layout.height - SVG_H * svgScale) / 2;
  }

  const handleGeometryChange = useCallback(
    (zoneId: string, geometry: Zone["geometry"]) => {
      updateZoneGeometry(zoneId, geometry);
    },
    [updateZoneGeometry]
  );

  return (
    <View style={styles.container} onLayout={onLayout}>
      <Svg viewBox={`0 0 ${SVG_W} ${SVG_H}`} style={{ flex: 1 }}>
        <VanOutline />
        <SvgText
          x={150}
          y={55}
          textAnchor="middle"
          fill="#78909C"
          fontSize={13}
          fontWeight="bold"
        >
          AVANT
        </SvgText>
        <SvgText
          x={150}
          y={595}
          textAnchor="middle"
          fill="#78909C"
          fontSize={13}
          fontWeight="bold"
        >
          ARRIÈRE
        </SvgText>
        {zones.map((zone) => (
          <ZoneOverlay
            key={zone.id}
            zone={zone}
            highlighted={highlightedZoneId === zone.id}
            onPress={() => {
              if (!editMode) onZonePress(zone.id);
            }}
          />
        ))}
      </Svg>

      {/* Edit mode overlays */}
      {editMode &&
        layout &&
        zones.map((zone) => (
          <ZoneEditOverlay
            key={zone.id}
            zone={zone}
            scale={svgScale}
            offsetX={svgOffsetX}
            offsetY={svgOffsetY}
            onGeometryChange={handleGeometryChange}
          />
        ))}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
});
