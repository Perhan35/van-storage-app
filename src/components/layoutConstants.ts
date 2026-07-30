// Shared SVG canvas layout constants for the location map.
// Kept in a standalone module so VanLayoutSVG and ZoneEditOverlay can both
// import them without creating a require cycle between the two components.

// Fallback canvas size used only before a location's outline has loaded.
export const DEFAULT_CANVAS_W = 300;
export const DEFAULT_CANVAS_H = 300;

// How far (in SVG units) a zone may extend beyond the location outline, so
// zones can spill over the edges or sit entirely outside (e.g. roof rack).
export const ZONE_OVERFLOW_MARGIN = 80;

// Padding (in SVG units) kept around the content's bounding box when fitting
// the default (non-edit) map view to it. Shared so the overview -> location
// transition can predict how large the plan will be drawn once it lands.
export const ZONES_FIT_PADDING = 24;

// A zone's allowed x/y/w/h range for a canvas of the given size, including
// the overflow margin on every side.
export function getZoneBounds(canvasW: number, canvasH: number) {
  return {
    minX: -ZONE_OVERFLOW_MARGIN,
    maxX: canvasW + ZONE_OVERFLOW_MARGIN,
    minY: -ZONE_OVERFLOW_MARGIN,
    maxY: canvasH + ZONE_OVERFLOW_MARGIN,
  };
}

// Snapping while dragging/resizing a zone in edit mode. Edges snap once
// they come within this many *screen* pixels of lining up with another
// zone's edge, and two zones that snap next to each other keep a small
// gap (in SVG units) instead of touching, so aligned layouts stay tidy.
export const ZONE_SNAP_THRESHOLD_PX = 10;
export const ZONE_SNAP_GAP_SVG = 6;
