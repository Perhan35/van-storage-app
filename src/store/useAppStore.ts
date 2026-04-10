import { create } from "zustand";
import { getDb, Zone, Item, ZoneWithCount } from "../db/database";

type AppState = {
  zones: ZoneWithCount[];
  highlightedZoneId: string | null;
  initialized: boolean;

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
};

function generateId(): string {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

export const useAppStore = create<AppState>((set, get) => ({
  zones: [],
  highlightedZoneId: null,
  initialized: false,

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
       WHERE i.name LIKE ? COLLATE NOCASE
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
}));
