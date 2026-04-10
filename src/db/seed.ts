// Zones par défaut du Citroën Jumpy TNT Vans - Origin X2 (2 places)
// viewBox = "0 0 300 600"
// Le van est vu du dessus, avant en haut

export const SEED_ZONES = [
  {
    id: "cabine",
    name: "Cabine",
    color: "#78909C",
    geometry: { type: "rect" as const, x: 10, y: 10, w: 280, h: 80 },
    sort_order: 0,
  },
  {
    id: "cuisine",
    name: "Cuisine / Plan de travail",
    color: "#FF8A65",
    geometry: { type: "rect" as const, x: 10, y: 110, w: 130, h: 120 },
    sort_order: 1,
  },
  {
    id: "rangement-haut",
    name: "Rangement Haut (droite)",
    color: "#4DB6AC",
    geometry: { type: "rect" as const, x: 160, y: 110, w: 130, h: 120 },
    sort_order: 2,
  },
  {
    id: "sous-lit",
    name: "Rangement Sous-lit (gauche)",
    color: "#7986CB",
    geometry: { type: "rect" as const, x: 10, y: 250, w: 130, h: 120 },
    sort_order: 3,
  },
  {
    id: "placard-lateral",
    name: "Placard Latéral (droit)",
    color: "#AED581",
    geometry: { type: "rect" as const, x: 160, y: 250, w: 130, h: 120 },
    sort_order: 4,
  },
  {
    id: "coffre",
    name: "Lit / Coffre arrière",
    color: "#FFD54F",
    geometry: { type: "rect" as const, x: 10, y: 390, w: 280, h: 100 },
    sort_order: 5,
  },
  {
    id: "portes-arriere",
    name: "Portes arrière",
    color: "#F48FB1",
    geometry: { type: "rect" as const, x: 10, y: 510, w: 280, h: 70 },
    sort_order: 6,
  },
];
