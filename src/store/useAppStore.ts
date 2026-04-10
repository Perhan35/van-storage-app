import { create } from "zustand";
import { getDb, Zone, Item, ZoneWithCount } from "../db/database";

type AppState = {
  zones: ZoneWithCount[];
  highlightedZoneId: string | null;
  initialized: boolean;
  editMode: boolean;

  init: () => Promise<void>;
  loadZones: () => Promise<void>;
  getItemsForZone: (zoneId: string) => Promise<Item[]>;
  addItem: (name: string, zoneId: string, notes?: string) => Promise<void>;
  deleteItem: (itemId: string) => Promise<void>;
  updateItem: (itemId: string, name: string, notes: string) => Promise<void>;
  moveItem: (itemId: string, newZoneId: string) => Promise<void>;
  searchItems: (query: string) => Promise<(Item & { zone_name: string })[]>;
  setHighlightedZoneId: (zoneId: string | null) => void;
  updateZone: (zoneId: string, name: string, color: string) => Promise<void>;
  deleteZone: (zoneId: string) => Promise<void>;
  addZone: (name: string, color: string, geometry: Zone["geometry"]) => Promise<void>;
  splitZone: (zoneId: string) => Promise<string | undefined>;
  toggleEditMode: () => void;
  updateZoneGeometry: (zoneId: string, geometry: Zone["geometry"]) => Promise<void>;
};

function generateId(): string {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

export const useAppStore = create<AppState>((set, get) => ({
  zones: [],
  highlightedZoneId: null,
  initialized: false,
  editMode: false,

  init: async () => {
    if (get().initialized) return;
    await getDb();
    await get().loadZones();
    set({ initialized: true });
  },

  loadZones: async () => {
    const db = await getDb();
    const rows = await db.getAllAsync<ZoneWithCount & { geometry: string }>(
      `SELECT z.*, COALESCE(c.cnt, 0) as item_count
       FROM zones z
       LEFT JOIN (SELECT zone_id, COUNT(*) as cnt FROM items GROUP BY zone_id) c
       ON z.id = c.zone_id
       ORDER BY z.sort_order`
    );
    const zones = rows.map((r) => ({
      ...r,
      geometry: JSON.parse(r.geometry as string),
    }));
    set({ zones });
  },

  getItemsForZone: async (zoneId) => {
    const db = await getDb();
    return db.getAllAsync<Item>(
      "SELECT * FROM items WHERE zone_id = ? ORDER BY name COLLATE NOCASE",
      [zoneId]
    );
  },

  addItem: async (name, zoneId, notes = "") => {
    const db = await getDb();
    const id = generateId();
    await db.runAsync(
      "INSERT INTO items (id, name, zone_id, notes) VALUES (?, ?, ?, ?)",
      [id, name, zoneId, notes]
    );
    await get().loadZones();
  },

  deleteItem: async (itemId) => {
    const db = await getDb();
    await db.runAsync("DELETE FROM items WHERE id = ?", [itemId]);
    await get().loadZones();
  },

  updateItem: async (itemId, name, notes) => {
    const db = await getDb();
    await db.runAsync(
      "UPDATE items SET name = ?, notes = ?, updated_at = datetime('now') WHERE id = ?",
      [name, notes, itemId]
    );
    await get().loadZones();
  },

  moveItem: async (itemId, newZoneId) => {
    const db = await getDb();
    await db.runAsync(
      "UPDATE items SET zone_id = ?, updated_at = datetime('now') WHERE id = ?",
      [newZoneId, itemId]
    );
    await get().loadZones();
  },

  searchItems: async (query) => {
    const db = await getDb();
    return db.getAllAsync<Item & { zone_name: string }>(
      `SELECT i.*, z.name as zone_name
       FROM items i JOIN zones z ON i.zone_id = z.id
       WHERE i.name LIKE ?1 COLLATE NOCASE OR i.notes LIKE ?1 COLLATE NOCASE
       ORDER BY i.name COLLATE NOCASE`,
      [`%${query}%`]
    );
  },

  setHighlightedZoneId: (zoneId) => set({ highlightedZoneId: zoneId }),

  updateZone: async (zoneId, name, color) => {
    const db = await getDb();
    await db.runAsync(
      "UPDATE zones SET name = ?, color = ?, updated_at = datetime('now') WHERE id = ?",
      [name, color, zoneId]
    );
    await get().loadZones();
  },

  deleteZone: async (zoneId) => {
    const db = await getDb();
    await db.runAsync("DELETE FROM zones WHERE id = ?", [zoneId]);
    await get().loadZones();
  },

  addZone: async (name, color, geometry) => {
    const db = await getDb();
    const id = generateId();
    const maxOrder = await db.getFirstAsync<{ m: number }>(
      "SELECT COALESCE(MAX(sort_order), 0) as m FROM zones"
    );
    await db.runAsync(
      "INSERT INTO zones (id, name, color, geometry, sort_order) VALUES (?, ?, ?, ?, ?)",
      [id, name, color, JSON.stringify(geometry), (maxOrder?.m ?? 0) + 1]
    );
    await get().loadZones();
  },

  splitZone: async (zoneId) => {
    const db = await getDb();
    const zone = get().zones.find((z) => z.id === zoneId);
    if (!zone) return undefined;

    const { x, y, w, h } = zone.geometry;
    const gap = 4;
    let geom1: Zone["geometry"], geom2: Zone["geometry"];
    let suffix1: string, suffix2: string;

    if (w >= h) {
      const halfW = (w - gap) / 2;
      geom1 = { type: "rect", x, y, w: halfW, h };
      geom2 = { type: "rect", x: x + halfW + gap, y, w: halfW, h };
      suffix1 = " (gauche)";
      suffix2 = " (droite)";
    } else {
      const halfH = (h - gap) / 2;
      geom1 = { type: "rect", x, y, w, h: halfH };
      geom2 = { type: "rect", x, y: y + halfH + gap, w, h: halfH };
      suffix1 = " (haut)";
      suffix2 = " (bas)";
    }

    const id1 = generateId();
    const id2 = generateId();
    const maxOrder = await db.getFirstAsync<{ m: number }>(
      "SELECT COALESCE(MAX(sort_order), 0) as m FROM zones"
    );
    const order = (maxOrder?.m ?? 0) + 1;

    await db.runAsync(
      "INSERT INTO zones (id, name, color, geometry, sort_order) VALUES (?, ?, ?, ?, ?)",
      [id1, zone.name + suffix1, zone.color, JSON.stringify(geom1), order]
    );
    await db.runAsync(
      "INSERT INTO zones (id, name, color, geometry, sort_order) VALUES (?, ?, ?, ?, ?)",
      [id2, zone.name + suffix2, zone.color, JSON.stringify(geom2), order + 1]
    );

    // Move all items to the first new zone
    await db.runAsync("UPDATE items SET zone_id = ? WHERE zone_id = ?", [
      id1,
      zoneId,
    ]);

    // Delete original zone
    await db.runAsync("DELETE FROM zones WHERE id = ?", [zoneId]);

    await get().loadZones();
    return id1;
  },

  toggleEditMode: () => set((s) => ({ editMode: !s.editMode })),

  updateZoneGeometry: async (zoneId, geometry) => {
    const db = await getDb();
    await db.runAsync(
      "UPDATE zones SET geometry = ?, updated_at = datetime('now') WHERE id = ?",
      [JSON.stringify(geometry), zoneId]
    );
    await get().loadZones();
  },
}));
