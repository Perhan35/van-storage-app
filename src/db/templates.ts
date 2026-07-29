// Predefined layout templates, offered when the user creates a new location.
// Each template supplies a starting outline (polygon, in its own SVG space)
// and a set of starter zones positioned within it.

// A vertex of the outline polygon. `control`, when present, makes the segment
// *ending* at this point a quadratic Bézier curve bowing through that control
// point (instead of a straight line). The segment ending at points[0] is the
// closing segment (from the last point back to the first).
export type OutlinePoint = { x: number; y: number; control?: { x: number; y: number } };
export type Outline = { w: number; h: number; points: OutlinePoint[] };

export type SeedZone = {
  id: string;
  // Translation key, resolved once at the moment the zone is inserted. What
  // lands in the database is plain text in the language active right then —
  // from that point on it's the user's name to rename or keep, and no later
  // language switch touches it.
  nameKey: string;
  color: string;
  geometry: { type: "rect"; x: number; y: number; w: number; h: number };
  sort_order: number;
};

export type LayoutTemplate = {
  id: string;
  nameKey: string;
  // Default icon suggested for a location created from this template. The user
  // can override it in the create/edit dialog.
  icon: string;
  outline: Outline;
  zones: SeedZone[];
};

// Fallback icon for a location with no icon of its own (e.g. legacy rows).
export const DEFAULT_LOCATION_ICON = "map-marker";

// Icons the user can pick from when creating or editing a location.
export const LOCATION_ICON_OPTIONS: string[] = [
  "van-utility",
  "caravan",
  "home-city-outline",
  "home-outline",
  "office-building-outline",
  "silverware-fork-knife",
  "fridge-outline",
  "garage-variant",
  "warehouse",
  "toolbox-outline",
  "tent",
  "package-variant-closed",
  "shape-outline",
  "map-marker",
];

function rectOutline(w: number, h: number): Outline {
  return {
    w,
    h,
    points: [
      { x: 0, y: 0 },
      { x: w, y: 0 },
      { x: w, y: h },
      { x: 0, y: h },
    ],
  };
}

// Zones par défaut du Citroën Jumpy TNT Vans - Origin X2 (2 places)
// viewBox = "0 0 300 600" ; le van est vu du dessus, avant en haut.
const VAN_ZONES: SeedZone[] = [
  {
    id: "cabine",
    nameKey: "template.zone_van_cab",
    color: "#78909C",
    geometry: { type: "rect", x: 10, y: 10, w: 280, h: 80 },
    sort_order: 0,
  },
  {
    id: "cuisine",
    nameKey: "template.zone_van_kitchen",
    color: "#FF8A65",
    geometry: { type: "rect", x: 10, y: 110, w: 130, h: 120 },
    sort_order: 1,
  },
  {
    id: "rangement-haut",
    nameKey: "template.zone_van_upper_storage",
    color: "#4DB6AC",
    geometry: { type: "rect", x: 160, y: 110, w: 130, h: 120 },
    sort_order: 2,
  },
  {
    id: "sous-lit",
    nameKey: "template.zone_van_under_bed",
    color: "#7986CB",
    geometry: { type: "rect", x: 10, y: 250, w: 130, h: 120 },
    sort_order: 3,
  },
  {
    id: "placard-lateral",
    nameKey: "template.zone_van_side_cupboard",
    color: "#AED581",
    geometry: { type: "rect", x: 160, y: 250, w: 130, h: 120 },
    sort_order: 4,
  },
  {
    id: "coffre",
    nameKey: "template.zone_van_rear_trunk",
    color: "#FFD54F",
    geometry: { type: "rect", x: 10, y: 390, w: 280, h: 100 },
    sort_order: 5,
  },
  {
    id: "portes-arriere",
    nameKey: "template.zone_van_rear_doors",
    color: "#F48FB1",
    geometry: { type: "rect", x: 10, y: 510, w: 280, h: 70 },
    sort_order: 6,
  },
];

// The original rounded van silhouette, reproduced with quadratic corners so it
// matches the pre-multi-location `VanOutline` path exactly. Each corner point
// carries a `control` at the sharp corner it rounds, e.g. the segment ending at
// (0,30) bows through (0,0) — same as the old `M 30 0 Q 0 0, 0 30 …` path.
const VAN_OUTLINE: Outline = {
  w: 300,
  h: 600,
  points: [
    { x: 30, y: 0 },
    { x: 0, y: 30, control: { x: 0, y: 0 } },
    { x: 0, y: 570 },
    { x: 30, y: 600, control: { x: 0, y: 600 } },
    { x: 270, y: 600 },
    { x: 300, y: 570, control: { x: 300, y: 600 } },
    { x: 300, y: 30 },
    { x: 270, y: 0, control: { x: 300, y: 0 } },
  ],
};

const APARTMENT_ZONES: SeedZone[] = [
  {
    id: "salon",
    nameKey: "template.zone_apartment_living_room",
    color: "#4DB6AC",
    geometry: { type: "rect", x: 10, y: 10, w: 300, h: 140 },
    sort_order: 0,
  },
  {
    id: "cuisine-appt",
    nameKey: "template.zone_apartment_kitchen",
    color: "#FF8A65",
    geometry: { type: "rect", x: 10, y: 160, w: 145, h: 130 },
    sort_order: 1,
  },
  {
    id: "chambre",
    nameKey: "template.zone_apartment_bedroom",
    color: "#7986CB",
    geometry: { type: "rect", x: 165, y: 160, w: 145, h: 130 },
    sort_order: 2,
  },
  {
    id: "salle-de-bain",
    nameKey: "template.zone_apartment_bathroom",
    color: "#4A90D9",
    geometry: { type: "rect", x: 10, y: 300, w: 145, h: 100 },
    sort_order: 3,
  },
  {
    id: "rangement-appt",
    nameKey: "template.zone_apartment_storage",
    color: "#AED581",
    geometry: { type: "rect", x: 165, y: 300, w: 145, h: 100 },
    sort_order: 4,
  },
];

const KITCHEN_ZONES: SeedZone[] = [
  {
    id: "frigo",
    nameKey: "template.zone_kitchen_fridge",
    color: "#4A90D9",
    geometry: { type: "rect", x: 10, y: 10, w: 130, h: 130 },
    sort_order: 0,
  },
  {
    id: "garde-manger",
    nameKey: "template.zone_kitchen_pantry",
    color: "#FFD54F",
    geometry: { type: "rect", x: 160, y: 10, w: 130, h: 130 },
    sort_order: 1,
  },
  {
    id: "placards",
    nameKey: "template.zone_kitchen_cupboards",
    color: "#AED581",
    geometry: { type: "rect", x: 10, y: 160, w: 130, h: 130 },
    sort_order: 2,
  },
  {
    id: "tiroirs",
    nameKey: "template.zone_kitchen_drawers",
    color: "#F48FB1",
    geometry: { type: "rect", x: 160, y: 160, w: 130, h: 130 },
    sort_order: 3,
  },
];

export const LAYOUT_TEMPLATES: LayoutTemplate[] = [
  {
    id: "van",
    nameKey: "location.template_van",
    icon: "van-utility",
    outline: VAN_OUTLINE,
    zones: VAN_ZONES,
  },
  {
    id: "apartment",
    nameKey: "location.template_apartment",
    icon: "home-city-outline",
    outline: rectOutline(320, 420),
    zones: APARTMENT_ZONES,
  },
  {
    id: "kitchen",
    nameKey: "location.template_kitchen",
    icon: "silverware-fork-knife",
    outline: rectOutline(300, 300),
    zones: KITCHEN_ZONES,
  },
  {
    id: "empty",
    nameKey: "location.template_empty",
    icon: "shape-outline",
    outline: rectOutline(300, 300),
    zones: [],
  },
];

export function getTemplate(id: string): LayoutTemplate {
  return LAYOUT_TEMPLATES.find((t) => t.id === id) ?? LAYOUT_TEMPLATES[3];
}
