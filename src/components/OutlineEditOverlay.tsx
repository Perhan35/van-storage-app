import React, { useEffect } from "react";
import { StyleSheet } from "react-native";
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
import { triggerHaptic } from "../utils/haptics";

const VERTEX_SIZE = 22;
const MIDPOINT_SIZE = 20;
const HANDLE_BORDER = 2;
const MIN_POINTS = 3;
// Extra size while a handle is held, as visible "I've got it" feedback.
const GRAB_LIFT = 0.35;

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
  // Committed change (drag released / discrete edit): writes to the store and
  // records an undo step.
  onChange: (points: OutlinePoint[]) => void;
  // Live, uncommitted change during a drag: lets the drawn outline follow the
  // finger so the result is visible before release. Never touches history.
  onPreview: (points: OutlinePoint[]) => void;
};

function OutlineEditOverlayInner({
  outline,
  fitScale,
  zoomScale,
  offsetX,
  offsetY,
  color,
  onChange,
  onPreview,
}: Props) {
  const { points } = outline;

  // Build the point list for a vertex dragged to (nx, ny); shared by the live
  // preview (every frame) and the commit (on release).
  const buildVertexMove = (index: number, nx: number, ny: number) =>
    points.map((p, i) =>
      i === index ? { ...p, x: Math.round(nx), y: Math.round(ny) } : p
    );

  const handleVertexPreview = (index: number, nx: number, ny: number) => {
    onPreview(buildVertexMove(index, nx, ny));
  };

  const handleVertexMove = (index: number, nx: number, ny: number) => {
    onChange(buildVertexMove(index, nx, ny));
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
  // curve's t=0.5 point lands under the finger. Shared by preview and commit.
  const buildCurve = (edgeIndex: number, dragX: number, dragY: number) => {
    const a = points[edgeIndex];
    const endIndex = (edgeIndex + 1) % points.length;
    const b = points[endIndex];
    const control = {
      x: Math.round(2 * dragX - (a.x + b.x) / 2),
      y: Math.round(2 * dragY - (a.y + b.y) / 2),
    };
    return points.map((p, i) => (i === endIndex ? { ...p, control } : p));
  };

  const handleCurvePreview = (edgeIndex: number, dragX: number, dragY: number) => {
    onPreview(buildCurve(edgeIndex, dragX, dragY));
  };

  const handleCurve = (edgeIndex: number, dragX: number, dragY: number) => {
    onChange(buildCurve(edgeIndex, dragX, dragY));
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
            onCurvePreview={handleCurvePreview}
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
          onPreview={handleVertexPreview}
          onMove={handleVertexMove}
          onDelete={handleVertexDelete}
        />
      ))}
    </>
  );
}

// Memoised so a live preview (which re-renders the *parent* every frame while a
// handle is dragged) doesn't recreate this component's gestures mid-drag and
// interrupt the drag. It only re-renders when the committed outline or the
// layout actually change — never during a drag, since those props hold steady.
export const OutlineEditOverlay = React.memo(OutlineEditOverlayInner);

type VertexProps = {
  point: OutlinePoint;
  index: number;
  fitScale: number;
  zoomScale: SharedValue<number>;
  offsetX: number;
  offsetY: number;
  color: string;
  canDelete: boolean;
  onPreview: (index: number, x: number, y: number) => void;
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
  onPreview,
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
      runOnJS(triggerHaptic)();
      startX.value = svgX.value;
      startY.value = svgY.value;
      active.value = withTiming(1, { duration: 120 });
      if (panLock) panLock.value = true;
    })
    .onUpdate((e) => {
      const scale = fitScale * zoomScale.value;
      svgX.value = startX.value + e.translationX / scale;
      svgY.value = startY.value + e.translationY / scale;
      // Drive the live outline preview so the line follows the finger.
      runOnJS(onPreview)(index, svgX.value, svgY.value);
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

  // Dividing every dimension by the live zoom keeps the handle a constant size
  // on screen at any zoom level, and the grab lift rides along in the same
  // factor. Sized in layout rather than via `transform: scale` on purpose -
  // see the note in ZoneEditOverlay: a shrinking scale gets rasterised at the
  // shrunken size and blown back up by the canvas, which looks pixelated.
  const style = useAnimatedStyle(() => {
    const size = (VERTEX_SIZE * (1 + active.value * GRAB_LIFT)) / zoomScale.value;
    return {
      position: "absolute" as const,
      left: svgX.value * fitScale + offsetX - size / 2,
      top: svgY.value * fitScale + offsetY - size / 2,
      width: size,
      height: size,
      borderRadius: size / 2,
      borderWidth: HANDLE_BORDER / zoomScale.value,
    };
  });

  return (
    <GestureDetector gesture={composed}>
      <Animated.View style={[styles.vertex, { backgroundColor: color }, style]} />
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
  onCurvePreview: (edgeIndex: number, x: number, y: number) => void;
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
  onCurvePreview,
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

  // Drag = bend the edge into a curve. The curve follows the finger live via
  // the preview, but is only committed to history on release, so one bend is a
  // single undo step rather than dozens of per-frame ones.
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
      runOnJS(onCurvePreview)(index, svgX.value, svgY.value);
    })
    .onEnd(() => {
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
      runOnJS(triggerHaptic)();
      if (curved) runOnJS(onStraighten)(index);
    });

  const composed = Gesture.Race(dragGesture, longPressGesture, tapGesture);

  // Same zoom compensation as the vertex handles above: the touch box and the
  // diamond drawn inside it are both sized in layout, so they hold a constant
  // on-screen size without a scale transform to rasterise them small.
  const style = useAnimatedStyle(() => {
    const size = (MIDPOINT_SIZE * (1 + active.value * GRAB_LIFT)) / zoomScale.value;
    return {
      position: "absolute" as const,
      left: svgX.value * fitScale + offsetX - size / 2,
      top: svgY.value * fitScale + offsetY - size / 2,
      width: size,
      height: size,
      alignItems: "center" as const,
      justifyContent: "center" as const,
    };
  });

  // The diamond is a fraction of the touch box, tilted 45deg. Rotation alone
  // doesn't change how the shape is rasterised, so it stays a transform.
  const diamondStyle = useAnimatedStyle(() => {
    const inner = curved ? 0.5 : 0.55;
    const size =
      (MIDPOINT_SIZE * inner * (1 + active.value * GRAB_LIFT)) / zoomScale.value;
    return {
      width: size,
      height: size,
      borderWidth: HANDLE_BORDER / zoomScale.value,
      borderRadius: 4 / zoomScale.value,
      transform: [{ rotate: "45deg" }],
    };
  });

  return (
    <GestureDetector gesture={composed}>
      <Animated.View style={style}>
        <Animated.View
          style={[
            curved ? styles.midpointCurved : styles.midpoint,
            { borderColor: color, backgroundColor: curved ? color : "transparent" },
            diamondStyle,
          ]}
        />
      </Animated.View>
    </GestureDetector>
  );
}

// Sizes, radii and border widths are zoom-compensated in the animated styles
// above; only the non-scaling traits live here.
const styles = StyleSheet.create({
  vertex: {
    borderColor: "#FFFFFF",
  },
  midpoint: {
    borderStyle: "dashed",
    opacity: 0.6,
  },
  // A curved edge's handle is a filled diamond, so it reads as "active curve".
  midpointCurved: {
    borderColor: "#FFFFFF",
    opacity: 0.95,
  },
});
