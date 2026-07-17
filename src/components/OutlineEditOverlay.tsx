import React, { useEffect } from "react";
import { View, StyleSheet } from "react-native";
import { Gesture, GestureDetector } from "react-native-gesture-handler";
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  runOnJS,
  withTiming,
  SharedValue,
} from "react-native-reanimated";
import { usePanLock } from "./ZoomableContainer";
import { OutlinePoint, Outline } from "../db/templates";

const VERTEX_SIZE = 22;
const MIDPOINT_SIZE = 20;
const MIN_POINTS = 3;

type Point = { x: number; y: number };

// Visual position of an edge's mid handle. A curved edge (end point has a
// control) shows its handle at the curve's t=0.5 point so re-dragging it feels
// like grabbing the bump; a straight edge shows it at the geometric midpoint.
function edgeHandlePos(a: OutlinePoint, b: OutlinePoint): Point {
  if (b.control) {
    return {
      x: 0.25 * a.x + 0.5 * b.control.x + 0.25 * b.x,
      y: 0.25 * a.y + 0.5 * b.control.y + 0.25 * b.y,
    };
  }
  return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
}

type Props = {
  outline: Outline;
  fitScale: number;
  zoomScale: SharedValue<number>;
  offsetX: number;
  offsetY: number;
  color: string;
  onChange: (points: OutlinePoint[]) => void;
};

export function OutlineEditOverlay({
  outline,
  fitScale,
  zoomScale,
  offsetX,
  offsetY,
  color,
  onChange,
}: Props) {
  const { points } = outline;

  const handleVertexMove = (index: number, nx: number, ny: number) => {
    const next = points.map((p, i) =>
      i === index ? { ...p, x: Math.round(nx), y: Math.round(ny) } : p
    );
    onChange(next);
  };

  const handleVertexDelete = (index: number) => {
    if (points.length <= MIN_POINTS) return;
    onChange(points.filter((_, i) => i !== index));
  };

  // Tapping an edge inserts a straight vertex at its midpoint. The edge's end
  // point loses any curve, since the edge is being split into two.
  const handleInsertOnEdge = (edgeIndex: number) => {
    const a = points[edgeIndex];
    const endIndex = (edgeIndex + 1) % points.length;
    const b = points[endIndex];
    const mid = { x: Math.round((a.x + b.x) / 2), y: Math.round((a.y + b.y) / 2) };
    const next = points.map((p, i) => (i === endIndex ? { x: p.x, y: p.y } : p));
    next.splice(edgeIndex + 1, 0, mid);
    onChange(next);
  };

  // Dragging an edge's mid handle bends it: set the end point's control so the
  // curve's t=0.5 point lands under the finger.
  const handleCurve = (edgeIndex: number, dragX: number, dragY: number) => {
    const a = points[edgeIndex];
    const endIndex = (edgeIndex + 1) % points.length;
    const b = points[endIndex];
    const control = {
      x: Math.round(2 * dragX - (a.x + b.x) / 2),
      y: Math.round(2 * dragY - (a.y + b.y) / 2),
    };
    onChange(points.map((p, i) => (i === endIndex ? { ...p, control } : p)));
  };

  const handleStraighten = (edgeIndex: number) => {
    const endIndex = (edgeIndex + 1) % points.length;
    onChange(
      points.map((p, i) => (i === endIndex ? { x: p.x, y: p.y } : p))
    );
  };

  return (
    <>
      {points.map((a, i) => {
        const b = points[(i + 1) % points.length];
        const pos = edgeHandlePos(a, b);
        return (
          <EdgeHandle
            key={`edge-${i}`}
            index={i}
            pos={pos}
            fitScale={fitScale}
            zoomScale={zoomScale}
            offsetX={offsetX}
            offsetY={offsetY}
            color={color}
            curved={!!b.control}
            onCurve={handleCurve}
            onInsert={handleInsertOnEdge}
            onStraighten={handleStraighten}
          />
        );
      })}
      {points.map((p, i) => (
        <VertexHandle
          key={`vertex-${i}`}
          point={p}
          index={i}
          fitScale={fitScale}
          zoomScale={zoomScale}
          offsetX={offsetX}
          offsetY={offsetY}
          color={color}
          canDelete={points.length > MIN_POINTS}
          onMove={handleVertexMove}
          onDelete={handleVertexDelete}
        />
      ))}
    </>
  );
}

type VertexProps = {
  point: OutlinePoint;
  index: number;
  fitScale: number;
  zoomScale: SharedValue<number>;
  offsetX: number;
  offsetY: number;
  color: string;
  canDelete: boolean;
  onMove: (index: number, x: number, y: number) => void;
  onDelete: (index: number) => void;
};

function VertexHandle({
  point,
  index,
  fitScale,
  zoomScale,
  offsetX,
  offsetY,
  color,
  canDelete,
  onMove,
  onDelete,
}: VertexProps) {
  // While this vertex is picked up, the ancestor canvas pan stands down so a
  // one-finger drag moves the vertex, not the whole map (same pattern as
  // ZoneEditOverlay).
  const panLock = usePanLock();

  const svgX = useSharedValue(point.x);
  const svgY = useSharedValue(point.y);
  const startX = useSharedValue(point.x);
  const startY = useSharedValue(point.y);
  const active = useSharedValue(0);

  useEffect(() => {
    svgX.value = point.x;
    svgY.value = point.y;
  }, [point.x, point.y]);

  const commitMove = (nx: number, ny: number) => {
    onMove(index, nx, ny);
  };

  const dragGesture = Gesture.Pan()
    .activateAfterLongPress(250)
    .onStart(() => {
      startX.value = svgX.value;
      startY.value = svgY.value;
      active.value = withTiming(1, { duration: 120 });
      if (panLock) panLock.value = true;
    })
    .onUpdate((e) => {
      const scale = fitScale * zoomScale.value;
      svgX.value = startX.value + e.translationX / scale;
      svgY.value = startY.value + e.translationY / scale;
    })
    .onEnd(() => {
      runOnJS(commitMove)(svgX.value, svgY.value);
    })
    .onFinalize(() => {
      active.value = withTiming(0, { duration: 150 });
      if (panLock) panLock.value = false;
    });

  const tapGesture = Gesture.Tap()
    .maxDuration(200)
    .onEnd(() => {
      if (canDelete) runOnJS(onDelete)(index);
    });

  const composed = Gesture.Race(dragGesture, tapGesture);

  const style = useAnimatedStyle(() => ({
    position: "absolute" as const,
    left: svgX.value * fitScale + offsetX - VERTEX_SIZE / 2,
    top: svgY.value * fitScale + offsetY - VERTEX_SIZE / 2,
    width: VERTEX_SIZE,
    height: VERTEX_SIZE,
    transform: [{ scale: 1 + active.value * 0.35 }],
  }));

  return (
    <GestureDetector gesture={composed}>
      <Animated.View style={style}>
        <View style={[styles.vertex, { backgroundColor: color }]} />
      </Animated.View>
    </GestureDetector>
  );
}

type EdgeProps = {
  index: number;
  pos: Point;
  fitScale: number;
  zoomScale: SharedValue<number>;
  offsetX: number;
  offsetY: number;
  color: string;
  curved: boolean;
  onCurve: (edgeIndex: number, x: number, y: number) => void;
  onInsert: (edgeIndex: number) => void;
  onStraighten: (edgeIndex: number) => void;
};

function EdgeHandle({
  index,
  pos,
  fitScale,
  zoomScale,
  offsetX,
  offsetY,
  color,
  curved,
  onCurve,
  onInsert,
  onStraighten,
}: EdgeProps) {
  const panLock = usePanLock();
  const svgX = useSharedValue(pos.x);
  const svgY = useSharedValue(pos.y);
  const startX = useSharedValue(pos.x);
  const startY = useSharedValue(pos.y);
  const active = useSharedValue(0);

  useEffect(() => {
    svgX.value = pos.x;
    svgY.value = pos.y;
  }, [pos.x, pos.y]);

  // Drag = bend the edge into a curve.
  const dragGesture = Gesture.Pan()
    .minDistance(6)
    .onStart(() => {
      startX.value = svgX.value;
      startY.value = svgY.value;
      active.value = withTiming(1, { duration: 120 });
      if (panLock) panLock.value = true;
    })
    .onUpdate((e) => {
      const scale = fitScale * zoomScale.value;
      svgX.value = startX.value + e.translationX / scale;
      svgY.value = startY.value + e.translationY / scale;
      runOnJS(onCurve)(index, svgX.value, svgY.value);
    })
    .onFinalize(() => {
      active.value = withTiming(0, { duration: 150 });
      if (panLock) panLock.value = false;
    });

  // Quick tap = insert a straight vertex; long-press = straighten a curve.
  const tapGesture = Gesture.Tap()
    .maxDuration(200)
    .onEnd(() => runOnJS(onInsert)(index));

  const longPressGesture = Gesture.LongPress()
    .minDuration(450)
    .onStart(() => {
      if (curved) runOnJS(onStraighten)(index);
    });

  const composed = Gesture.Race(dragGesture, longPressGesture, tapGesture);

  const style = useAnimatedStyle(() => ({
    position: "absolute" as const,
    left: svgX.value * fitScale + offsetX - MIDPOINT_SIZE / 2,
    top: svgY.value * fitScale + offsetY - MIDPOINT_SIZE / 2,
    width: MIDPOINT_SIZE,
    height: MIDPOINT_SIZE,
    alignItems: "center" as const,
    justifyContent: "center" as const,
    transform: [{ scale: 1 + active.value * 0.35 }],
  }));

  return (
    <GestureDetector gesture={composed}>
      <Animated.View style={style}>
        <View
          style={[
            curved ? styles.midpointCurved : styles.midpoint,
            { borderColor: color, backgroundColor: curved ? color : "transparent" },
          ]}
        />
      </Animated.View>
    </GestureDetector>
  );
}

const styles = StyleSheet.create({
  vertex: {
    flex: 1,
    borderRadius: VERTEX_SIZE / 2,
    borderWidth: 2,
    borderColor: "#FFFFFF",
    opacity: 0.95,
  },
  midpoint: {
    width: MIDPOINT_SIZE * 0.55,
    height: MIDPOINT_SIZE * 0.55,
    borderWidth: 2,
    borderStyle: "dashed",
    borderRadius: 4,
    transform: [{ rotate: "45deg" }],
    opacity: 0.6,
  },
  // A curved edge's handle is a filled diamond, so it reads as "active curve".
  midpointCurved: {
    width: MIDPOINT_SIZE * 0.5,
    height: MIDPOINT_SIZE * 0.5,
    borderWidth: 2,
    borderColor: "#FFFFFF",
    borderRadius: 4,
    transform: [{ rotate: "45deg" }],
    opacity: 0.95,
  },
});
