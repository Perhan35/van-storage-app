// Shared SVG canvas dimensions for the van layout.
// Kept in a standalone module so VanLayoutSVG and ZoneEditOverlay can both
// import them without creating a require cycle between the two components.
export const SVG_W = 300;
export const SVG_H = 600;

// How far (in SVG units) a zone may extend beyond the van outline, so zones
// can spill over the edges or sit entirely outside (e.g. roof rack, hitch box).
export const ZONE_OVERFLOW_MARGIN = 80;

export const ZONE_MIN_X = -ZONE_OVERFLOW_MARGIN;
export const ZONE_MAX_X = SVG_W + ZONE_OVERFLOW_MARGIN;
export const ZONE_MIN_Y = -ZONE_OVERFLOW_MARGIN;
export const ZONE_MAX_Y = SVG_H + ZONE_OVERFLOW_MARGIN;

// Snapping while dragging/resizing a zone in edit mode. Edges snap once
// they come within this many *screen* pixels of lining up with another
// zone's edge, and two zones that snap next to each other keep a small
// gap (in SVG units) instead of touching, so aligned layouts stay tidy.
export const ZONE_SNAP_THRESHOLD_PX = 10;
export const ZONE_SNAP_GAP_SVG = 6;
