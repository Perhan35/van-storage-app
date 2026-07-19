import React, { useState, useCallback, useEffect } from "react";
import { View, LayoutChangeEvent, StyleSheet, Pressable } from "react-native";
import { Gesture, GestureDetector } from "react-native-gesture-handler";
import Svg, { Text as SvgText, G } from "react-native-svg";
import { useSharedValue, runOnJS } from "react-native-reanimated";
import { LocationOutline } from "./LocationOutline";
import { ZoneOverlay } from "./ZoneOverlay";
import { ZoneEditOverlay } from "./ZoneEditOverlay";
import { OutlineEditOverlay } from "./OutlineEditOverlay";
import { InscriptionEditOverlay } from "./InscriptionEditOverlay";
import { useZoomScale } from "./ZoomableContainer";
import { useAppStore } from "../store/useAppStore";
import { useAppTheme } from "../theme/useAppTheme";
import { Zone, ZoneWithCount, LabelSide } from "../db/database";
import { Outline, OutlinePoint } from "../db/templates";
import { useTranslation } from "react-i18next";
import { DEFAULT_CANVAS_W, DEFAULT_CANVAS_H, ZONE_OVERFLOW_MARGIN, getZoneBounds } from "./layoutConstants";

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

// Padding (in SVG units) kept around the zones' bounding box when fitting
// the default (non-edit) view to them.
const ZONES_FIT_PADDING = 24;

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
  const toggleEditMode = useAppStore((s) => s.toggleEditMode);
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

  // Content = the zones plus the outline (with its curve control points). Both
  // views frame this so nothing the user drew — including a curve pushed past
  // the frame — is ever clipped out of view.
  const contentBBox = unionBBox(getZonesBoundingBox(zones), getOutlineBoundingBox(outline))!;

  let viewBoxMinX: number;
  let viewBoxMinY: number;
  let viewBoxW: number;
  let viewBoxH: number;
  if (editMode) {
    // Show the standard editable area (canvas + overflow margin, where zones
    // and vertices may be dragged) unioned with any content already beyond it,
    // so curves bowed past the frame stay visible and grabbable while editing.
    const minX = Math.min(-ZONE_OVERFLOW_MARGIN, contentBBox.minX);
    const minY = Math.min(-ZONE_OVERFLOW_MARGIN, contentBBox.minY);
    const maxX = Math.max(canvasW + ZONE_OVERFLOW_MARGIN, contentBBox.maxX);
    const maxY = Math.max(canvasH + ZONE_OVERFLOW_MARGIN, contentBBox.maxY);
    viewBoxMinX = minX;
    viewBoxMinY = minY;
    viewBoxW = maxX - minX;
    viewBoxH = maxY - minY;
  } else {
    viewBoxMinX = contentBBox.minX - ZONES_FIT_PADDING;
    viewBoxMinY = contentBBox.minY - ZONES_FIT_PADDING;
    viewBoxW = contentBBox.maxX - contentBBox.minX + ZONES_FIT_PADDING * 2;
    viewBoxH = contentBBox.maxY - contentBBox.minY + ZONES_FIT_PADDING * 2;
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

  // Long-press anywhere on a location's map drops into edit mode to move/resize
  // its zones (editing the outline itself is reached from the locations
  // overview menu). Only armed in the normal view — once editing, the canvas'
  // own drag handles own the touch.
  //
  // Constrained so it can't be mistaken for the canvas' own navigation:
  //   - numberOfPointers(1): a two-finger pinch-to-zoom never counts as a hold.
  //   - maxDistance(10): matches the pan's minDistance, so the moment a drag
  //     travels far enough to pan, the hold fails instead of firing.
  // What's left is a deliberate one-finger, stationary press.
  const longPressEdit = Gesture.LongPress()
    .minDuration(450)
    .numberOfPointers(1)
    .maxDistance(10)
    .enabled(!editMode)
    .onStart(() => {
      runOnJS(toggleEditMode)();
    });

  return (
    <GestureDetector gesture={longPressEdit}>
    <View style={styles.container} onLayout={onLayout}>
      <Svg
        viewBox={`${viewBoxMinX} ${viewBoxMinY} ${viewBoxW} ${viewBoxH}`}
        style={{ flex: 1 }}
      >
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
            otherZones={zones
              .filter((z) => z.id !== zone.id)
              .map((z) => z.geometry)}
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
    </View>
    </GestureDetector>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
});
