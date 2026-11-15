import React from "react";
import { StyleSheet } from "react-native";
import { Icon } from "react-native-paper";
import { Gesture, GestureDetector } from "react-native-gesture-handler";
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  runOnJS,
  withTiming,
  SharedValue,
} from "react-native-reanimated";
import { LabelSide } from "../db/database";
import { usePanLock } from "./ZoomableContainer";
import { triggerHaptic } from "../utils/haptics";

// Fixed-size hit/visual box centered on the inscription's anchor. Horizontal
// for front/rear, taller for the vertical left/right labels.
const BOX_LONG = 132;
const BOX_SHORT = 40;

// Pill metrics at rest, and how much bigger it gets while held (in layout).
const PILL_PAD_V = 3;
const PILL_PAD_H = 8;
const PILL_RADIUS = 8;
const LABEL_FONT_SIZE = 13;
const GRAB_LIFT = 0.08;

type Props = {
  side: LabelSide;
  // Resolved text ignoring the hidden flag — "" only for a truly empty side
  // (a left/right that has never been given text), shown as a "+" chip.
  text: string;
  // Whether this side is currently hidden from the read-mode plan. A hidden
  // side with text still shows its name here, just faded, so it stays
  // findable/draggable while editing without needing to unhide it first.
  hidden: boolean;
  // Anchor in canvas (outline) coordinates.
  posX: number;
  posY: number;
  rotate: number;
  accentColor: string;
  // SVG->screen mapping (fit only; pinch zoom is applied by the ancestor).
  fitScale: number;
  zoomScale: SharedValue<number>;
  offsetX: number;
  offsetY: number;
  // Clamp range for the anchor while dragging (canvas + overflow margin).
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
  onOpen: (side: LabelSide) => void;
  onMove: (side: LabelSide, x: number, y: number) => void;
};

export function InscriptionEditOverlay({
  side,
  text,
  hidden,
  posX,
  posY,
  rotate,
  accentColor,
  fitScale,
  zoomScale,
  offsetX,
  offsetY,
  minX,
  maxX,
  minY,
  maxY,
  onOpen,
  onMove,
}: Props) {
  // Truly nothing to show yet (an untouched left/right) — rendered as a "+"
  // chip. A hidden side with text is not empty: its name still shows, faded.
  const empty = text.length === 0;
  const faded = empty || hidden;

  const panLock = usePanLock();
  const sx = useSharedValue(posX);
  const sy = useSharedValue(posY);
  const startX = useSharedValue(posX);
  const startY = useSharedValue(posY);
  const dragActive = useSharedValue(0);

  React.useEffect(() => {
    sx.value = posX;
    sy.value = posY;
  }, [posX, posY]);

  // Tap anywhere on the label opens the rename/hide dialog.
  const tapGesture = Gesture.Tap().onEnd(() => {
    runOnJS(onOpen)(side);
  });

  // Press and hold, then drag to reposition. Only offered when the label
  // actually shows something — there's nothing to place for an empty "+" chip.
  const dragGesture = Gesture.Pan()
    .enabled(!empty)
    .activateAfterLongPress(250)
    .onStart(() => {
      runOnJS(triggerHaptic)();
      startX.value = sx.value;
      startY.value = sy.value;
      dragActive.value = withTiming(1, { duration: 120 });
      if (panLock) panLock.value = true;
    })
    .onUpdate((e) => {
      const scale = fitScale * zoomScale.value;
      const nx = startX.value + e.translationX / scale;
      const ny = startY.value + e.translationY / scale;
      sx.value = Math.min(Math.max(minX, nx), maxX);
      sy.value = Math.min(Math.max(minY, ny), maxY);
    })
    .onEnd(() => {
      runOnJS(onMove)(side, sx.value, sy.value);
    })
    .onFinalize(() => {
      dragActive.value = withTiming(0, { duration: 150 });
      if (panLock) panLock.value = false;
    });

  // Hold-to-drag takes priority; a quick tap (drag never activates) opens the
  // dialog instead.
  const gesture = Gesture.Exclusive(dragGesture, tapGesture);

  // The box always lays the text out horizontally at BOX_LONG x BOX_SHORT;
  // the rotate transform (about the center) turns left/right vertical. So the
  // centering offset uses the same pre-rotation size for every side.
  //
  // The grab "lift" is not a `scale` transform here: a view carrying its own
  // scale transform gets flattened into a low-resolution bitmap on iOS, which
  // made a held label visibly blurry (same fix as the zone lift in
  // ZoneEditOverlay). The pill and its text are grown in layout instead, see
  // pillStyle/labelStyle. The rotation stays a transform, since nothing else
  // can turn the left/right labels vertical.
  const boxStyle = useAnimatedStyle(() => ({
    position: "absolute" as const,
    left: sx.value * fitScale + offsetX - BOX_LONG / 2,
    top: sy.value * fitScale + offsetY - BOX_SHORT / 2,
    width: BOX_LONG,
    height: BOX_SHORT,
    transform: [{ rotate: `${rotate}deg` }],
  }));

  const pillStyle = useAnimatedStyle(() => {
    const k = 1 + dragActive.value * GRAB_LIFT;
    return {
      paddingVertical: PILL_PAD_V * k,
      paddingHorizontal: PILL_PAD_H * k,
      borderRadius: PILL_RADIUS * k,
    };
  });

  const labelStyle = useAnimatedStyle(() => ({
    fontSize: LABEL_FONT_SIZE * (1 + dragActive.value * GRAB_LIFT),
  }));

  return (
    <GestureDetector gesture={gesture}>
      <Animated.View style={[styles.box, boxStyle]}>
        {/* A filled amber pill with dark ink reads clearly on both light and
            dark canvases (the pill colour is fixed, so the ink contrast is
            constant). Empty sides show a dashed "add" chip; a hidden side
            with a name gets the same dashed/translucent treatment, but with
            its real name instead of "+" — a visual cue that it won't appear
            on the plan until unhidden. */}
        <Animated.View
          style={[
            styles.pill,
            faded
              ? { borderColor: LABEL_INK, borderStyle: "dashed", borderWidth: 1.5, backgroundColor: `${accentColor}66` }
              : { backgroundColor: accentColor },
            pillStyle,
          ]}
        >
          <Animated.Text numberOfLines={1} style={[styles.label, labelStyle]}>
            {empty ? "+" : text}
          </Animated.Text>
          <Icon source="pencil" size={12} color={LABEL_INK} />
        </Animated.View>
      </Animated.View>
    </GestureDetector>
  );
}

// Dark ink used on the amber pill — fixed across themes since the pill is
// always amber.
const LABEL_INK = "#263238";

const styles = StyleSheet.create({
  box: {
    alignItems: "center",
    justifyContent: "center",
  },
  pill: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    paddingVertical: PILL_PAD_V,
    paddingHorizontal: PILL_PAD_H,
    borderRadius: PILL_RADIUS,
    // `boxShadow` rather than shadow*/elevation: the empty-state pill has a
    // translucent fill, which makes iOS fall back to a per-pixel shadow and log
    // "cannot calculate shadow efficiently". Blur = 2× the old shadowRadius.
    boxShadow: "0px 2px 8px rgba(0, 0, 0, 0.25)",
  },
  label: {
    color: LABEL_INK,
    fontSize: LABEL_FONT_SIZE,
    fontWeight: "bold",
    letterSpacing: 0.5,
  },
});
