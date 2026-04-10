import React from "react";
import { StyleSheet, View } from "react-native";
import { Gesture, GestureDetector } from "react-native-gesture-handler";
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  runOnJS,
} from "react-native-reanimated";
import { ZoneWithCount, Zone } from "../db/database";

const HANDLE_SIZE = 24;
const MIN_ZONE_SIZE_SVG = 30;

type Props = {
  zone: ZoneWithCount;
  scale: number;
  offsetX: number;
  offsetY: number;
  onGeometryChange: (zoneId: string, geometry: Zone["geometry"]) => void;
};

export function ZoneEditOverlay({
  zone,
  scale,
  offsetX,
  offsetY,
  onGeometryChange,
}: Props) {
  const { x, y, w, h } = zone.geometry;

  // Shared values track the current SVG-coordinate geometry during gestures
  const svgX = useSharedValue(x);
  const svgY = useSharedValue(y);
  const svgW = useSharedValue(w);
  const svgH = useSharedValue(h);

  // Saved values at gesture start
  const startX = useSharedValue(x);
  const startY = useSharedValue(y);
  const startW = useSharedValue(w);
  const startH = useSharedValue(h);

  // Sync when zone prop changes (e.g. after DB update)
  React.useEffect(() => {
    svgX.value = zone.geometry.x;
    svgY.value = zone.geometry.y;
    svgW.value = zone.geometry.w;
    svgH.value = zone.geometry.h;
  }, [zone.geometry.x, zone.geometry.y, zone.geometry.w, zone.geometry.h]);

  const commitGeometry = (nx: number, ny: number, nw: number, nh: number) => {
    onGeometryChange(zone.id, {
      type: "rect",
      x: Math.round(nx),
      y: Math.round(ny),
      w: Math.round(nw),
      h: Math.round(nh),
    });
  };

  // --- Drag gesture (move entire zone) ---
  const dragGesture = Gesture.Pan()
    .minDistance(4)
    .onStart(() => {
      startX.value = svgX.value;
      startY.value = svgY.value;
    })
    .onUpdate((e) => {
      const dx = e.translationX / scale;
      const dy = e.translationY / scale;
      svgX.value = startX.value + dx;
      svgY.value = startY.value + dy;
    })
    .onEnd(() => {
      runOnJS(commitGeometry)(
        svgX.value,
        svgY.value,
        svgW.value,
        svgH.value
      );
    });

  // --- Resize gesture (bottom-right handle) ---
  const resizeGesture = Gesture.Pan()
    .minDistance(2)
    .onStart(() => {
      startW.value = svgW.value;
      startH.value = svgH.value;
    })
    .onUpdate((e) => {
      const dw = e.translationX / scale;
      const dh = e.translationY / scale;
      svgW.value = Math.max(MIN_ZONE_SIZE_SVG, startW.value + dw);
      svgH.value = Math.max(MIN_ZONE_SIZE_SVG, startH.value + dh);
    })
    .onEnd(() => {
      runOnJS(commitGeometry)(
        svgX.value,
        svgY.value,
        svgW.value,
        svgH.value
      );
    });

  // --- Resize gesture (top-left handle) ---
  const resizeTLGesture = Gesture.Pan()
    .minDistance(2)
    .onStart(() => {
      startX.value = svgX.value;
      startY.value = svgY.value;
      startW.value = svgW.value;
      startH.value = svgH.value;
    })
    .onUpdate((e) => {
      const dx = e.translationX / scale;
      const dy = e.translationY / scale;
      const newW = Math.max(MIN_ZONE_SIZE_SVG, startW.value - dx);
      const newH = Math.max(MIN_ZONE_SIZE_SVG, startH.value - dy);
      svgX.value = startX.value + (startW.value - newW);
      svgY.value = startY.value + (startH.value - newH);
      svgW.value = newW;
      svgH.value = newH;
    })
    .onEnd(() => {
      runOnJS(commitGeometry)(
        svgX.value,
        svgY.value,
        svgW.value,
        svgH.value
      );
    });

  // Animated style for the zone body (moves + resizes in real time)
  const bodyStyle = useAnimatedStyle(() => ({
    position: "absolute" as const,
    left: svgX.value * scale + offsetX,
    top: svgY.value * scale + offsetY,
    width: svgW.value * scale,
    height: svgH.value * scale,
  }));

  // Bottom-right handle
  const brHandleStyle = useAnimatedStyle(() => ({
    position: "absolute" as const,
    left:
      (svgX.value + svgW.value) * scale + offsetX - HANDLE_SIZE / 2,
    top:
      (svgY.value + svgH.value) * scale + offsetY - HANDLE_SIZE / 2,
    width: HANDLE_SIZE,
    height: HANDLE_SIZE,
  }));

  // Top-left handle
  const tlHandleStyle = useAnimatedStyle(() => ({
    position: "absolute" as const,
    left: svgX.value * scale + offsetX - HANDLE_SIZE / 2,
    top: svgY.value * scale + offsetY - HANDLE_SIZE / 2,
    width: HANDLE_SIZE,
    height: HANDLE_SIZE,
  }));

  return (
    <>
      {/* Draggable zone body */}
      <GestureDetector gesture={dragGesture}>
        <Animated.View style={bodyStyle}>
          <View style={[styles.dragBody, { borderColor: zone.color }]} />
        </Animated.View>
      </GestureDetector>

      {/* Top-left resize handle */}
      <GestureDetector gesture={resizeTLGesture}>
        <Animated.View style={tlHandleStyle}>
          <View style={[styles.handle, { backgroundColor: zone.color }]} />
        </Animated.View>
      </GestureDetector>

      {/* Bottom-right resize handle */}
      <GestureDetector gesture={resizeGesture}>
        <Animated.View style={brHandleStyle}>
          <View style={[styles.handle, { backgroundColor: zone.color }]} />
        </Animated.View>
      </GestureDetector>
    </>
  );
}

const styles = StyleSheet.create({
  dragBody: {
    flex: 1,
    borderWidth: 2,
    borderStyle: "dashed",
    borderRadius: 8,
    backgroundColor: "rgba(255,255,255,0.1)",
  },
  handle: {
    width: HANDLE_SIZE,
    height: HANDLE_SIZE,
    borderRadius: HANDLE_SIZE / 2,
    borderWidth: 2,
    borderColor: "#FFFFFF",
    opacity: 0.9,
  },
});
