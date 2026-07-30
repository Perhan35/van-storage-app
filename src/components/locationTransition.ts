// Motion for the overview -> location transition.
//
// An overview tile draws the same thing the map screen does — the same outline,
// the same zone rects — only small. So opening a location isn't a change of
// screen, it's a change of distance: the map is seeded onto the tapped tile at
// exactly the size the plan appears there, then flown up to full screen. This
// continues the map -> zone dive one level up, so the whole hierarchy reads as
// one space you move through rather than a stack of screens.
import { Easing } from "react-native-reanimated";
import { Outline } from "../db/templates";
import { ZONES_FIT_PADDING } from "./layoutConstants";

export type Rect = { x: number; y: number; width: number; height: number };

// Entering is a deliberate act and gets the full flight; leaving is a dismissal
// and gets out of the way. Mirrors the existing DIVE_IN/DIVE_OUT asymmetry.
export const LOCATION_ENTER_DURATION = 380;
export const LOCATION_EXIT_DURATION = 200;

// Decelerating: the map leaps away from the finger and settles, so the tap is
// answered on the first frame instead of easing up from rest.
export const LOCATION_ENTER_EASING = Easing.bezier(0.2, 0.9, 0.2, 1);
export const LOCATION_EXIT_EASING = Easing.in(Easing.quad);

// The grid keeps growing while it fades, so you pass through that plane rather
// than watching it dissolve in place. It clears out ahead of the map landing.
export const GRID_RECEDE_SCALE = 1.12;
export const GRID_FADE_DURATION = Math.round(LOCATION_ENTER_DURATION * 0.55);
export const GRID_FADE_EASING = Easing.out(Easing.quad);

// Coming back is the flight played backwards: the map shrinks back down onto
// the tile it came from while the grid falls back in around it. Same duration
// and mirrored easing, so the two directions retrace the same path.
export const LOCATION_RETURN_DURATION = LOCATION_ENTER_DURATION;
// Time-reverse of LOCATION_ENTER_EASING: cubic-bezier(x1,y1,x2,y2) reversed is
// cubic-bezier(1-x2, 1-y2, 1-x1, 1-y1).
export const LOCATION_RETURN_EASING = Easing.bezier(0.8, 0, 0.8, 0.1);
// The grid faded out over the first stretch of the flight, so on the way back
// it fades in over the last stretch — hence the delay.
export const GRID_RETURN_FADE_DELAY = LOCATION_RETURN_DURATION - GRID_FADE_DURATION;
export const GRID_RETURN_FADE_EASING = Easing.in(Easing.quad);

// Fallback dismissal, used only when there's no tile to aim at (the location
// was opened without a flight): the map falls away as the grid rises to meet it.
export const GRID_RETURN_SCALE = 0.96;
export const MAP_EXIT_SCALE = 0.92;

// The header title dips out and back while the layers move, and swaps its text
// at the bottom of the dip — a handoff rather than a cut. Short enough that the
// out-and-back fits inside the exit (the quicker of the two transitions).
export const HEADER_FADE_DURATION = 110;
export const HEADER_FADE_EASING = Easing.inOut(Easing.quad);

// Aspect-fit scale for a drawing of `planW` x `planH` inside a box.
function fitScale(boxW: number, boxH: number, planW: number, planH: number) {
  return Math.min(boxW / planW, boxH / planH);
}

export type FlightStart = {
  // Transform placing the full-screen map layer over the tapped tile.
  scale: number;
  x: number;
  y: number;
};

// Where the map layer has to start so its plan lands exactly on top of the
// plan already drawn in the tapped tile.
//
// Both boxes fit the same outline to their own aspect, so matching the two
// *drawings* — not the two boxes — is what makes them read as one object at two
// sizes. The map's viewBox carries ZONES_FIT_PADDING that the tile's doesn't,
// which is why the plan is drawn slightly smaller there; that's folded in here.
//
// `tile` and `container` are both in window coordinates. Returns null when
// either is unmeasured, and the caller falls back to an instant swap.
export function locationFlightStart(
  tile: Rect,
  container: Rect,
  outline: Outline
): FlightStart | null {
  if (tile.width <= 0 || tile.height <= 0) return null;
  if (container.width <= 0 || container.height <= 0) return null;

  const tilePlan = fitScale(tile.width, tile.height, outline.w, outline.h);
  const mapPlan = fitScale(
    container.width,
    container.height,
    outline.w + ZONES_FIT_PADDING * 2,
    outline.h + ZONES_FIT_PADDING * 2
  );
  if (!Number.isFinite(tilePlan) || !Number.isFinite(mapPlan) || mapPlan <= 0) {
    return null;
  }

  // The layer scales about its own center, so the translation is simply the
  // offset between the two centers, in the layer's unscaled pixel space.
  return {
    scale: tilePlan / mapPlan,
    x: tile.x + tile.width / 2 - (container.x + container.width / 2),
    y: tile.y + tile.height / 2 - (container.y + container.height / 2),
  };
}
