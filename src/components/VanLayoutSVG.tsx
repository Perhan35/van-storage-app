import React, { useState, useCallback, useEffect, useLayoutEffect, useMemo, useRef } from "react";
import { View, LayoutChangeEvent, StyleSheet, Pressable } from "react-native";
import Svg, { Text as SvgText, G } from "react-native-svg";
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  useAnimatedReaction,
  runOnJS,
} from "react-native-reanimated";
import { LocationOutline } from "./LocationOutline";
import { ZoneOverlay, StaticZoneOverlay } from "./ZoneOverlay";
import { ZoneEditOverlay } from "./ZoneEditOverlay";
import { OutlineEditOverlay } from "./OutlineEditOverlay";
import { InscriptionEditOverlay } from "./InscriptionEditOverlay";
import {
  useZoomScale,
  useZoomControl,
  RestCover,
  useSharpLayer,
  useSharpViewport,
} from "./ZoomableContainer";
import { useAppStore } from "../store/useAppStore";
import { useAppTheme } from "../theme/useAppTheme";
import { Zone, ZoneWithCount, LabelSide } from "../db/database";
import { Outline, OutlinePoint } from "../db/templates";
import { useTranslation } from "react-i18next";
import {
  DEFAULT_CANVAS_W,
  DEFAULT_CANVAS_H,
  ZONE_OVERFLOW_MARGIN,
  ZONES_FIT_PADDING,
  getZoneBounds,
} from "./layoutConstants";

const INSCRIPTION_SIDES: LabelSide[] = ["front", "rear", "left", "right"];
// Read-mode inscription color (unchanged from the original hard-coded labels).
const INSCRIPTION_COLOR = "#78909C";

// SVG anchor + rotation for each side's inscription. left/right read vertically.
function sideAnchor(side: LabelSide, canvasW: number, canvasH: number) {
  switch (side) {
    case "front":
      return { x: canvasW / 2, y: 15, rotate: 0 };
    case "rear":
      return { x: canvasW / 2, y: canvasH - 5, rotate: 0 };
    case "left":
      return { x: 12, y: canvasH / 2, rotate: -90 };
    case "right":
      return { x: canvasW - 12, y: canvasH / 2, rotate: 90 };
  }
}

// See RestCover in ZoomableContainer: a short-lived copy of the plan as it was
// drawn before the rest view changed, laid over everything so the frames
// before the new transform lands show the old picture instead of a jump.
// Opaque, so the new content underneath can't show through while it waits.
function TransitionCover({
  viewBox,
  background,
  children,
  onRegister,
  onDone,
}: {
  viewBox: string;
  background: string;
  children: React.ReactNode;
  onRegister: (cover: RestCover) => void;
  onDone: () => void;
}) {
  const opacity = useSharedValue(1);
  const scale = useSharedValue(1);
  const translateX = useSharedValue(0);
  const translateY = useSharedValue(0);

  // Child layout effects run before the parent's, so the parent's rest-view
  // effect in this same commit finds the cover already registered.
  useLayoutEffect(() => {
    onRegister({ opacity, scale, translateX, translateY });
  }, []);

  // Safety net: an opaque cover that somehow never got faded (the UI-thread
  // switch didn't run) would leave a frozen picture over the live canvas.
  useEffect(() => {
    const timer = setTimeout(onDone, 800);
    return () => clearTimeout(timer);
  }, []);

  useAnimatedReaction(
    () => opacity.value,
    (v, prev) => {
      if (v <= 0 && prev !== null && prev > 0) runOnJS(onDone)();
    }
  );

  const style = useAnimatedStyle(() => ({
    opacity: opacity.value,
    transform: [
      { translateX: translateX.value },
      { translateY: translateY.value },
      { scale: scale.value },
    ],
  }));

  return (
    <Animated.View
      pointerEvents="none"
      style={[StyleSheet.absoluteFill, { backgroundColor: background }, style]}
    >
      <Svg viewBox={viewBox} style={{ flex: 1 }}>
        {children}
      </Svg>
    </Animated.View>
  );
}

export type ZoneScreenRect = { left: number; top: number; width: number; height: number };

type Props = {
  onZonePress: (zoneId: string, rect: ZoneScreenRect) => void;
  // Tapping an inscription (or its "+" placeholder) asks the parent to open the
  // rename/hide dialog for that side — the dialog lives in the screen so the
  // "+" FAB can open it too. Optional: screens that never enter layout-edit
  // (e.g. the game) don't need it.
  onEditInscription?: (side: LabelSide) => void;
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

export function VanLayoutSVG({ onZonePress, onEditInscription }: Props) {
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
  const updateLocationLabel = useAppStore((s) => s.updateLocationLabel);
  const { palette } = useAppTheme();

  // Inscriptions are edited while reshaping the layout (outline-edit), not while
  // moving zones — so the labels stay out of the way during zone work.
  const labelsEditable = editMode && outlineEditMode;

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

  // Per-side inscription resolution. front/rear fall back to a built-in default;
  // left/right have none, so they show only once given text. Hidden -> "".
  const labels = activeLocation?.labels ?? {};
  const defaultFor = (side: LabelSide): string | null =>
    side === "front" ? t("map.front") : side === "rear" ? t("map.rear") : null;
  const resolveDisplay = (side: LabelSide): string => {
    const def = labels[side];
    if (def?.hidden) return "";
    return (def?.text?.trim() || defaultFor(side)) ?? "";
  };
  // Same text, but ignoring the hidden flag — used while editing, where a
  // hidden-but-named side still shows its name (faded) rather than vanishing.
  const resolveEditText = (side: LabelSide): string =>
    (labels[side]?.text?.trim() || defaultFor(side)) ?? "";
  // Anchor with any custom drag position applied (canvas coordinates).
  const resolvePos = (side: LabelSide) => {
    const base = sideAnchor(side, canvasW, canvasH);
    const def = labels[side];
    return { x: def?.x ?? base.x, y: def?.y ?? base.y, rotate: base.rotate };
  };


  const [layout, setLayout] = useState<{
    width: number;
    height: number;
  } | null>(null);

  // In-progress outline points while a vertex/edge handle is being dragged.
  // Only the drawn line reads this, so it follows the finger live; the viewBox,
  // zones and the edit handles keep using the committed outline (which stays
  // put during the drag), so the memoised overlay isn't recreated mid-gesture.
  const [outlineDraft, setOutlineDraft] = useState<OutlinePoint[] | null>(null);

  // Live pinch-zoom level from the ancestor ZoomableContainer, used to
  // convert screen-pixel drag deltas to SVG units as the user zooms in.
  const fallbackZoomScale = useSharedValue(1);
  const zoomScale = useZoomScale() ?? fallbackZoomScale;

  const onLayout = useCallback((e: LayoutChangeEvent) => {
    const { width, height } = e.nativeEvent.layout;
    setLayout({ width, height });
  }, []);

  // Bbox/viewBox/scale math, memoized: it re-derives from the full zones
  // array and outline points on every call, and previously ran on every
  // render — including renders driven by unrelated state (highlight timers,
  // gesture-only updates) while a flight/dive animation is in progress.
  const { viewBoxMinX, viewBoxMinY, viewBoxW, viewBoxH, svgScale, svgOffsetX, svgOffsetY, readFrame } =
    useMemo(() => {
      // Content = the zones plus the outline (with its curve control points).
      // Both views frame this so nothing the user drew — including a curve
      // pushed past the frame — is ever clipped out of view.
      const contentBBox = unionBBox(getZonesBoundingBox(zones), getOutlineBoundingBox(outline))!;
      // What the read-mode view frames (SVG units). Zone editing rests zoomed
      // in on this so entering edit mode doesn't shrink the plan.
      const readFrame = {
        minX: contentBBox.minX - ZONES_FIT_PADDING,
        minY: contentBBox.minY - ZONES_FIT_PADDING,
        w: contentBBox.maxX - contentBBox.minX + ZONES_FIT_PADDING * 2,
        h: contentBBox.maxY - contentBBox.minY + ZONES_FIT_PADDING * 2,
      };

      let minX: number;
      let minY: number;
      let w: number;
      let h: number;
      if (editMode) {
        // Show the standard editable area (canvas + overflow margin, where
        // zones and vertices may be dragged) unioned with any content already
        // beyond it, so curves bowed past the frame stay visible and
        // grabbable while editing.
        const bx = Math.min(-ZONE_OVERFLOW_MARGIN, contentBBox.minX);
        const by = Math.min(-ZONE_OVERFLOW_MARGIN, contentBBox.minY);
        const bmaxX = Math.max(canvasW + ZONE_OVERFLOW_MARGIN, contentBBox.maxX);
        const bmaxY = Math.max(canvasH + ZONE_OVERFLOW_MARGIN, contentBBox.maxY);
        minX = bx;
        minY = by;
        w = bmaxX - bx;
        h = bmaxY - by;
      } else {
        minX = readFrame.minX;
        minY = readFrame.minY;
        w = readFrame.w;
        h = readFrame.h;
      }

      let scale = 1;
      let offsetX = 0;
      let offsetY = 0;
      if (layout) {
        scale = Math.min(layout.width / w, layout.height / h);
        offsetX = (layout.width - w * scale) / 2 - minX * scale;
        offsetY = (layout.height - h * scale) / 2 - minY * scale;
      }

      return {
        viewBoxMinX: minX,
        viewBoxMinY: minY,
        viewBoxW: w,
        viewBoxH: h,
        svgScale: scale,
        svgOffsetX: offsetX,
        svgOffsetY: offsetY,
        readFrame,
      };
    }, [zones, outline, editMode, canvasW, canvasH, layout]);

  // Zone editing widens the viewBox to the overflow margin, which on its own
  // shrinks the plan on screen — and zooming back in by hand meant pinching
  // over zones that a lingering finger would pick up. Instead the canvas rests
  // zoomed in on the read-mode frame, so the plan keeps its size; the margin
  // is still a pan or a pinch-out away. Outline editing keeps the full view
  // (identity), since its handles are meant to reach the whole margin.
  //
  // The read frame is captured on the way in and held for the whole session:
  // it follows the zones, so tracking it live would re-frame the view after
  // every committed move.
  const zoomControl = useZoomControl();
  const zoneEditActive = editMode && !outlineEditMode;
  const frozenReadFrame = useRef(readFrame);
  if (!zoneEditActive) frozenReadFrame.current = readFrame;

  // Entering or leaving zone editing switches the viewBox (a React commit,
  // on screen at once) and the rest view (a transform, on screen a frame or
  // two later). A cover showing the previous viewBox is mounted in that same
  // commit to hide the gap — see TransitionCover.
  const viewBox = `${viewBoxMinX} ${viewBoxMinY} ${viewBoxW} ${viewBoxH}`;
  const committedViewBox = useRef(viewBox);
  useLayoutEffect(() => {
    committedViewBox.current = viewBox;
  });
  const [cover, setCover] = useState<{
    id: number;
    viewBox: string;
    // Whether the frozen picture is of zone editing (so it keeps the dashes).
    wasEditing: boolean;
  } | null>(null);
  const [coverMode, setCoverMode] = useState(zoneEditActive);
  if (coverMode !== zoneEditActive) {
    // Adjusting state during render (React's "derive from props" pattern), so
    // the cover is part of the very commit that changes the viewBox.
    setCoverMode(zoneEditActive);
    if (zoomControl && layout) {
      setCover({
        id: (cover?.id ?? 0) + 1,
        viewBox: committedViewBox.current,
        wasEditing: coverMode,
      });
    }
  }
  const pendingCover = useRef<RestCover | null>(null);
  const registerCover = useCallback((c: RestCover) => {
    pendingCover.current = c;
  }, []);
  const coverId = cover?.id;
  const dropCover = useCallback(() => {
    setCover((c) => (c && c.id === coverId ? null : c));
  }, [coverId]);

  // null = rest view not set by us yet, so mounting mid-edit still applies it.
  const restApplied = useRef<boolean | null>(null);
  useLayoutEffect(() => {
    if (!zoomControl || !layout) return;
    // Consumed once: only the switch that mounted the cover drives it.
    const c = pendingCover.current;
    pendingCover.current = null;
    if (zoneEditActive) {
      const f = frozenReadFrame.current;
      zoomControl.setRestRect(
        {
          left: f.minX * svgScale + svgOffsetX,
          top: f.minY * svgScale + svgOffsetY,
          width: f.w * svgScale,
          height: f.h * svgScale,
        },
        c
      );
      restApplied.current = true;
    } else if (restApplied.current !== false) {
      // Only on the way out (or first mount): read mode must not keep
      // snapping the transform back, or it would fight the zone dive.
      zoomControl.setRestRect(null, c);
      restApplied.current = false;
    } else if (c) {
      // Nothing to change, so nothing will fade the cover: drop it now.
      c.opacity.value = 0;
    }
  }, [zoomControl, zoneEditActive, layout, svgScale, svgOffsetX, svgOffsetY]);

  const handleGeometryChange = useCallback(
    (zoneId: string, geometry: Zone["geometry"]) => {
      updateZoneGeometry(zoneId, geometry);
    },
    [updateZoneGeometry]
  );

  // Each ZoneEditOverlay needs every *other* zone's geometry (for snapping).
  // Filtering+mapping `zones` once per zone inline in the render below was
  // O(n²) allocations per render; this builds the same per-zone arrays in one
  // pass instead.
  const otherZonesByZoneId = useMemo(() => {
    const map = new Map<string, Zone["geometry"][]>();
    if (zones.length === 0) return map;
    const allGeometry = zones.map((z) => z.geometry);
    zones.forEach((zone, i) => {
      const others = allGeometry.slice();
      others.splice(i, 1);
      map.set(zone.id, others);
    });
    return map;
  }, [zones]);

  // Live outline points show through the drawn line while a handle is dragged;
  // the committed outline drives everything else.
  const renderOutline: Outline = outlineDraft
    ? { ...outline, points: outlineDraft }
    : outline;

  const handleOutlinePreview = useCallback((points: OutlinePoint[]) => {
    setOutlineDraft(points);
  }, []);

  // On release, commit to the store (records an undo step), then drop the draft
  // — the awaited store update has already refreshed the committed outline, so
  // clearing it here doesn't flash the pre-drag shape.
  const handleOutlineChange = useCallback(
    async (points: OutlinePoint[]) => {
      if (!activeLocation) return;
      await updateLocationOutline(activeLocation.id, { ...outline, points });
      setOutlineDraft(null);
    },
    [activeLocation?.id, outline, updateLocationOutline]
  );

  // Drop any stale in-progress draft when outline editing ends (e.g. ok/cancel
  // or a gesture interrupted before it committed).
  useEffect(() => {
    if (!outlineEditMode) setOutlineDraft(null);
  }, [outlineEditMode]);

  // Long-press-anywhere-to-edit is *not* handled here. It used to be, in a
  // GestureDetector nested inside ZoomableContainer's own — with no relation
  // declared between the two, which left the canvas' pinch/pan wedged after
  // returning from a zone. It now lives in ZoomableContainer's single gesture
  // composition (see the comment on `composed` there); the screen wires it up
  // via that component's `onLongPress` prop.

  const svgBackdrop = (
    <>
      <LocationOutline outline={renderOutline} />
      {/* Read mode draws the inscriptions in SVG (at their default or custom
          position). While editing, the draggable overlays below draw them
          instead, so the SVG copy is suppressed to avoid a doubled label. */}
      {!labelsEditable &&
        INSCRIPTION_SIDES.map((side) => {
          const text = resolveDisplay(side);
          if (!text) return null;
          const { x, y, rotate } = resolvePos(side);
          return (
            <G key={side} transform={`rotate(${rotate}, ${x}, ${y})`}>
              <SvgText
                x={x}
                y={y}
                textAnchor="middle"
                fill={INSCRIPTION_COLOR}
                fontSize={13}
                fontWeight="bold"
              >
                {text}
              </SvgText>
            </G>
          );
        })}
    </>
  );

  // Only built while a transition cover is up, with still zones: the cover is
  // a picture held for a few frames, and the animated zones cost far more to
  // mount than it is on screen.
  const coverContent = cover ? (
    <>
      {svgBackdrop}
      {zones.map((zone) => (
        <StaticZoneOverlay key={zone.id} zone={zone} editing={cover.wasEditing} />
      ))}
    </>
  ) : null;

  const svgContent = (
    <>
      {svgBackdrop}
      {zones.map((zone) => (
        <ZoneOverlay
          key={zone.id}
          zone={zone}
          highlighted={highlightedZoneId === zone.id}
          dimmed={
            highlightedZoneId !== null && highlightedZoneId !== zone.id
          }
          editing={zoneEditActive}
        />
      ))}
    </>
  );

  // Sharp copy (see SharpViewport in ZoomableContainer). The canvas transform
  // only magnifies the bitmap this Svg was drawn into, so deep zoom turns the
  // plan blocky. Once the zoom/pan has settled, the same drawing is handed to
  // the container with a viewBox covering just what's visible, drawn
  // untransformed at screen resolution; our own Svg hides while it's shown.
  const sharpLayer = useSharpLayer();
  const sharpViewport = useSharpViewport();
  let sharpViewBox: string | null = null;
  if (sharpViewport && layout) {
    const { scale: s, tx, ty, width: W, height: H } = sharpViewport;
    // Visible region in container coords (the inverse of the canvas
    // transform, which scales about the container center), then in SVG units.
    const left = W / 2 - (W / 2 + tx) / s;
    const top = H / 2 - (H / 2 + ty) / s;
    sharpViewBox = [
      (left - svgOffsetX) / svgScale,
      (top - svgOffsetY) / svgScale,
      W / s / svgScale,
      H / s / svgScale,
    ].join(" ");
  }

  // Re-pushed on every render so the copy follows content changes (a committed
  // zone move, a live outline drag) as well as new viewports.
  //
  // Drawn with the still zones: a second set of animated ZoneOverlays (shared
  // values, animated props, mount-time transitions — per zone) is costly with
  // a couple dozen zones. The one thing the still zones can't show is the
  // highlight pulse, so while a zone is highlighted the sharp copy stands down
  // and the animated canvas shows through.
  useLayoutEffect(() => {
    if (!sharpLayer) return;
    if (!sharpViewport || !sharpViewBox || highlightedZoneId !== null) {
      sharpLayer.setContent(null, null);
      return;
    }
    sharpLayer.setContent(
      <Svg viewBox={sharpViewBox} style={StyleSheet.absoluteFill}>
        {svgBackdrop}
        {zones.map((zone) => (
          <StaticZoneOverlay key={zone.id} zone={zone} editing={zoneEditActive} />
        ))}
      </Svg>,
      sharpViewport
    );
  });

  useEffect(() => () => sharpLayer?.setContent(null, null), [sharpLayer]);

  const fallbackSharpShown = useSharedValue(0);
  const sharpShown = sharpLayer?.shown ?? fallbackSharpShown;
  const baseSvgStyle = useAnimatedStyle(() => ({ opacity: 1 - sharpShown.value }));

  return (
    <View style={styles.container} onLayout={onLayout}>
      <Animated.View style={[styles.container, baseSvgStyle]}>
        <Svg viewBox={viewBox} style={{ flex: 1 }}>
          {svgContent}
        </Svg>
      </Animated.View>

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
            otherZones={otherZonesByZoneId.get(zone.id) ?? []}
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
          onPreview={handleOutlinePreview}
          onChange={handleOutlineChange}
        />
      )}

      {/* Editable inscriptions: tap to rename/hide, press-and-hold to drag.
          Only while editing zones — outline-edit keeps the canvas to itself. */}
      {labelsEditable &&
        layout &&
        INSCRIPTION_SIDES.map((side) => {
          const { x, y, rotate } = resolvePos(side);
          return (
            <InscriptionEditOverlay
              key={side}
              side={side}
              text={resolveEditText(side)}
              hidden={!!labels[side]?.hidden}
              posX={x}
              posY={y}
              rotate={rotate}
              accentColor={palette.editModeAccent}
              fitScale={svgScale}
              zoomScale={zoomScale}
              offsetX={svgOffsetX}
              offsetY={svgOffsetY}
              minX={zoneBounds.minX}
              maxX={zoneBounds.maxX}
              minY={zoneBounds.minY}
              maxY={zoneBounds.maxY}
              onOpen={(s) => onEditInscription?.(s)}
              onMove={(s, nx, ny) => {
                if (activeLocation) updateLocationLabel(activeLocation.id, s, { x: nx, y: ny });
              }}
            />
          );
        })}

      {cover && (
        <TransitionCover
          key={cover.id}
          viewBox={cover.viewBox}
          background={palette.background}
          onRegister={registerCover}
          onDone={dropCover}
        >
          {coverContent}
        </TransitionCover>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
});
