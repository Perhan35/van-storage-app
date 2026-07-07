import { create } from "zustand";
import { getDb, Zone, ZoneWithCount } from "../db/database";
import { getPreference, setPreference } from "../db/preferences";
import * as repo from "../db/repository";

export type ThemeMode = "auto" | "light" | "dark";

let highlightTimer: ReturnType<typeof setTimeout> | null = null;

type AppState = {
  zones: ZoneWithCount[];
  highlightedZoneId: string | null;
  initialized: boolean;
  initError: string | null;
  editMode: boolean;
  themeMode: ThemeMode;

  init: () => Promise<void>;
  setThemeMode: (mode: ThemeMode) => Promise<void>;
  loadZones: () => Promise<void>;
  addItem: (name: string, zoneId: string, notes?: string) => Promise<void>;
  deleteItem: (itemId: string) => Promise<void>;
  updateItem: (itemId: string, name: string, notes: string) => Promise<void>;
  moveItem: (itemId: string, newZoneId: string) => Promise<void>;
  setItemOutOfVan: (itemId: string, outOfVan: boolean) => Promise<void>;
  setHighlightedZoneId: (zoneId: string | null) => void;
  updateZone: (zoneId: string, name: string, color: string, fillOpacity: number) => Promise<void>;
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
  initError: null,
  editMode: false,
  themeMode: "auto",

  init: async () => {
    if (get().initialized) return;
    set({ initError: null });
    try {
      await getDb();
      const storedMode = await getPreference("themeMode");
      if (storedMode === "auto" || storedMode === "light" || storedMode === "dark") {
        set({ themeMode: storedMode });
      }
      await get().loadZones();
      set({ initialized: true });
    } catch (err) {
      set({ initError: err instanceof Error ? err.message : String(err) });
    }
  },

  setThemeMode: async (mode) => {
    set({ themeMode: mode });
    await setPreference("themeMode", mode);
  },

  loadZones: async () => {
    const zones = await repo.listZonesWithCounts();
    set({ zones });
  },

  addItem: async (name, zoneId, notes = "") => {
    const id = generateId();
    await repo.insertItem(id, name, zoneId, notes);
    await get().loadZones();
  },

  deleteItem: async (itemId) => {
    await repo.deleteItem(itemId);
    await get().loadZones();
  },

  updateItem: async (itemId, name, notes) => {
    await repo.updateItem(itemId, name, notes);
    await get().loadZones();
  },

  moveItem: async (itemId, newZoneId) => {
    await repo.moveItem(itemId, newZoneId);
    await get().loadZones();
  },

  setItemOutOfVan: async (itemId, outOfVan) => {
    await repo.setItemOutOfVan(itemId, outOfVan);
    await get().loadZones();
  },

  setHighlightedZoneId: (zoneId) => {
    if (highlightTimer) {
      clearTimeout(highlightTimer);
      highlightTimer = null;
    }
    set({ highlightedZoneId: zoneId });
    if (zoneId !== null) {
      highlightTimer = setTimeout(() => {
        highlightTimer = null;
        set({ highlightedZoneId: null });
      }, 4000);
    }
  },

  updateZone: async (zoneId, name, color, fillOpacity) => {
    await repo.updateZone(zoneId, name, color, fillOpacity);
    await get().loadZones();
  },

  deleteZone: async (zoneId) => {
    await repo.deleteZone(zoneId);
    await get().loadZones();
  },

  addZone: async (name, color, geometry) => {
    const id = generateId();
    await repo.insertZone(id, name, color, geometry);
    await get().loadZones();
  },

  splitZone: async (zoneId) => {
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

    await repo.splitZoneInDb(zone, id1, id2, geom1, geom2, suffix1, suffix2);

    await get().loadZones();
    return id1;
  },

  toggleEditMode: () => set((s) => ({ editMode: !s.editMode })),

  updateZoneGeometry: async (zoneId, geometry) => {
    await repo.updateZoneGeometry(zoneId, geometry);
    await get().loadZones();
  },
}));
