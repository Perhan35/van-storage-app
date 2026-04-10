import React from "react";
import { Path } from "react-native-svg";

// Silhouette du Citroën Jumpy vue du dessus
// viewBox parent = "0 0 300 600"
export function VanOutline() {
  return (
    <Path
      d={`
        M 30 0
        Q 0 0, 0 30
        L 0 570
        Q 0 600, 30 600
        L 270 600
        Q 300 600, 300 570
        L 300 30
        Q 300 0, 270 0
        Z
      `}
      fill="none"
      stroke="#546E7A"
      strokeWidth={3}
    />
  );
}
