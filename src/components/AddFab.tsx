import React from "react";
import { View, ViewStyle } from "react-native";

// Shared "cargo tag" shape language for every add ("+") button in the app:
// a rounded square rather than Material's default circle, echoing the
// rectangular zones drawn on the van map, outlined in coral like a stitched
// tag edge.
export const FAB_RADIUS = 18;
export const FAB_RADIUS_SMALL = 14;

export function tagFabStyle(accentColor: string): ViewStyle {
  return {
    borderRadius: FAB_RADIUS,
    borderWidth: 1,
    borderColor: accentColor,
  };
}

// A bolder, stencil-style plus mark in place of the default hairline MDI
// glyph — two crossing rounded bars instead of a thin cross.
export function PlusGlyph({ size, color }: { size: number; color: string }) {
  const barLength = size * 0.64;
  const barThickness = Math.max(3, size * 0.16);

  return (
    <View style={{ width: size, height: size, alignItems: "center", justifyContent: "center" }}>
      <View
        style={{
          position: "absolute",
          width: barLength,
          height: barThickness,
          borderRadius: barThickness / 2,
          backgroundColor: color,
        }}
      />
      <View
        style={{
          position: "absolute",
          width: barThickness,
          height: barLength,
          borderRadius: barThickness / 2,
          backgroundColor: color,
        }}
      />
    </View>
  );
}

export const plusIcon = ({ size, color }: { size: number; color: string }) => (
  <PlusGlyph size={size} color={color} />
);
