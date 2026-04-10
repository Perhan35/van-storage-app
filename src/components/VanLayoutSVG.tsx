import React from "react";
import Svg, { Text as SvgText } from "react-native-svg";
import { VanOutline } from "./VanOutline";
import { ZoneOverlay } from "./ZoneOverlay";
import { useAppStore } from "../store/useAppStore";

type Props = {
  onZonePress: (zoneId: string) => void;
};

export function VanLayoutSVG({ onZonePress }: Props) {
  const zones = useAppStore((s) => s.zones);
  const highlightedZoneId = useAppStore((s) => s.highlightedZoneId);

  return (
    <Svg viewBox="0 0 300 600" style={{ flex: 1 }}>
      <VanOutline />
      {/* Label avant */}
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
      {/* Label arrière */}
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
          onPress={() => onZonePress(zone.id)}
        />
      ))}
    </Svg>
  );
}
