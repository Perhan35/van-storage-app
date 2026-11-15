import {
  withDb,
  Zone,
  Item,
  ZoneWithCount,
  Season,
  KitSeason,
  Location,
  LocationLabels,
  WantedItem,
} from "./database";
import { DEFAULT_LOCATION_ICON, LayoutTemplate, Outline } from "./templates";
import i18n from "../i18n";
import { DEFAULT_ZONE_COLOR, sanitizeHex } from "../utils/color";
import { normalizeForSearch, matchesSearch } from "../utils/search";
import { toSqliteTimestamp } from "../utils/date";
import { canAddInto, canNestInto } from "../utils/itemTree";
import type { SQLiteDatabase } from "expo-sqlite";

export const DEFAULT_FILL_OPACITY = 0.4;

export function isValidOutline(o: unknown): o is Outline {
  if (typeof o !== "object" || o === null) return false;
  const { w, h, points } = o as Record<string, unknown>;
  if (typeof w !== "number" || !Number.isFinite(w)) return false;
  if (typeof h !== "number" || !Number.isFinite(h)) return false;
  if (!Array.isArray(points) || points.length < 3) return false;
  return points.every(
    (p) =>
      typeof p === "object" &&
      p !== null &&
      typeof (p as Record<string, unknown>).x === "number" &&
      typeof (p as Record<string, unknown>).y === "number"
  );
}

export function sanitizeFillOpacity(v: unknown): number {
  return typeof v === "number" && Number.isFinite(v) && v >= 0 && v <= 1
    ? v
    : DEFAULT_FILL_OPACITY;
}

export function isValidGeometry(g: unknown): g is Zone["geometry"] {
  if (typeof g !== "object" || g === null) return false;
  const { type, x, y, w, h } = g as Record<string, unknown>;
  return (
    type === "rect" &&
    typeof x === "number" &&
    Number.isFinite(x) &&
    typeof y === "number" &&
    Number.isFinite(y) &&
    typeof w === "number" &&
    Number.isFinite(w) &&
    typeof h === "number" &&
    Number.isFinite(h)
  );
}

export function listZonesWithCounts(locationId: string): Promise<ZoneWithCount[]> {
  return queryZonesWithCounts("", "WHERE z.location_id = ?", [locationId]);
}

// Zones across every location, with each zone's location icon, used by the
// game screen's question pool so quiz subjects aren't limited to whichever
// location is currently active.
export function listAllZonesWithCounts(): Promise<(ZoneWithCount & { location_icon: string })[]> {
  return queryZonesWithCounts(
    ", l.icon as location_icon",
    "JOIN locations l ON z.location_id = l.id",
    []
  );
}

function queryZonesWithCounts<T extends ZoneWithCount = ZoneWithCount>(
  extraSelect: string,
  joinAndWhere: string,
  params: string[]
): Promise<T[]> {
  return withDb(async (db) => {
    // A correlated scalar subquery instead of a LEFT JOIN against a
    // "GROUP BY zone_id over every item in the database" derived table: the
    // old form aggregated the whole items table even when joinAndWhere
    // restricts z to one location. This scopes the count to each selected
    // zone and rides idx_items_zone.
    const rows = await db.getAllAsync<T & { geometry: string }>(
      `SELECT z.*, (SELECT COUNT(*) FROM items i WHERE i.zone_id = z.id) as item_count${extraSelect}
       FROM zones z
       ${joinAndWhere}
       ORDER BY z.sort_order`,
      params
    );
    return rows.flatMap((r) => {
      let geometry: unknown;
      try {
        geometry = JSON.parse(r.geometry as string);
      } catch {
        console.warn(`Skipping zone ${r.id}: invalid geometry JSON`);
        return [];
      }
      if (!isValidGeometry(geometry)) {
        console.warn(`Skipping zone ${r.id}: invalid geometry shape`);
        return [];
      }
      // An empty or malformed color (seen in real backups: "") would leave
      // edit handles, borders and chips invisible wherever the raw value is
      // used, so it is normalised once here for every consumer.
      const color = sanitizeHex((r as { color?: string }).color, DEFAULT_ZONE_COLOR);
      return [{ ...r, geometry, color }];
    });
  });
}

export function listItemsForZone(zoneId: string): Promise<Item[]> {
  return withDb((db) =>
    db.getAllAsync<Item>(
      "SELECT * FROM items WHERE zone_id = ? ORDER BY checked ASC, name COLLATE NOCASE",
      [zoneId]
    )
  );
}

// The given items plus everything stored inside them, at any depth. UNION
// (not UNION ALL) drops repeats, so even a corrupt parent_id cycle ends. The
// seeds go through one IN (...) rather than one SELECT per id, which would hit
// SQLite's 500-term limit on compound selects for a big "Tout charger".
function subtreeCte(seedCount: number): string {
  const placeholders = Array.from({ length: seedCount }, () => "?").join(", ");
  return `WITH RECURSIVE subtree(id) AS (
    SELECT id FROM items WHERE id IN (${placeholders})
    UNION SELECT i.id FROM items i JOIN subtree s ON i.parent_id = s.id
  )`;
}

// Checklist rule, walking up from `parentId`: an item whose contents are all
// checked is checked, one with anything unchecked inside is not. An item left
// with nothing inside keeps its own state. Takes the `db` it is handed — never
// call withDb from here (see the INVARIANT on withDb).
async function syncAncestorsChecked(db: SQLiteDatabase, parentId: string | null): Promise<void> {
  const seen = new Set<string>();
  let currentId = parentId;
  while (currentId && !seen.has(currentId)) {
    seen.add(currentId);
    const stats = await db.getFirstAsync<{ total: number; done: number }>(
      "SELECT COUNT(*) as total, COALESCE(SUM(checked), 0) as done FROM items WHERE parent_id = ?",
      [currentId]
    );
    const parent = await db.getFirstAsync<{ checked: number; parent_id: string | null }>(
      "SELECT checked, parent_id FROM items WHERE id = ?",
      [currentId]
    );
    if (!parent) return;
    if (stats && stats.total > 0) {
      const checked = stats.done === stats.total ? 1 : 0;
      if (checked !== parent.checked) {
        await db.runAsync(
          "UPDATE items SET checked = ?, updated_at = datetime('now') WHERE id = ?",
          [checked, currentId]
        );
      }
    }
    currentId = parent.parent_id;
  }
}

export function insertItem(
  id: string,
  name: string,
  zoneId: string,
  notes: string,
  season: Season = "none",
  expirationDate: string | null = null,
  reminderDays: number = 7,
  parentId: string | null = null
): Promise<void> {
  return withDb(async (db) => {
    await db.withTransactionAsync(async () => {
      // An item always lives in the same zone as the one it's stored in.
      let targetZoneId = zoneId;
      let targetParentId: string | null = null;
      // Added inside a Trousse that is out of the van: it is out too.
      let outOfVan = 0;
      if (parentId) {
        const zoneItems = await db.getAllAsync<Item>(
          "SELECT * FROM items WHERE zone_id = (SELECT zone_id FROM items WHERE id = ?)",
          [parentId]
        );
        const parent = zoneItems.find((i) => i.id === parentId);
        if (parent && canAddInto(parentId, zoneItems)) {
          targetZoneId = parent.zone_id;
          targetParentId = parentId;
          outOfVan = parent.out_of_van ? 1 : 0;
        }
      }
      await db.runAsync(
        "INSERT INTO items (id, name, zone_id, notes, season, expiration_date, reminder_days, parent_id, out_of_van) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
        [id, name, targetZoneId, notes, season, expirationDate, reminderDays, targetParentId, outOfVan]
      );
      // A new, unchecked thing inside a checked Trousse unchecks it.
      await syncAncestorsChecked(db, targetParentId);
    });
  });
}

// "all" deletes the item and everything inside it; "keep" deletes only the
// item and moves its contents up one level (into the item's own parent, or
// straight into the zone).
export type DeleteItemMode = "all" | "keep";

export function deleteItem(itemId: string, mode: DeleteItemMode = "all"): Promise<void> {
  return withDb(async (db) => {
    await db.withTransactionAsync(async () => {
      const item = await db.getFirstAsync<{ parent_id: string | null }>(
        "SELECT parent_id FROM items WHERE id = ?",
        [itemId]
      );
      if (!item) return;
      if (mode === "keep") {
        await db.runAsync(
          "UPDATE items SET parent_id = ?, updated_at = datetime('now') WHERE parent_id = ?",
          [item.parent_id, itemId]
        );
        await db.runAsync("DELETE FROM items WHERE id = ?", [itemId]);
      } else {
        await db.runAsync(
          `${subtreeCte(1)} DELETE FROM items WHERE id IN (SELECT id FROM subtree)`,
          [itemId]
        );
      }
      await syncAncestorsChecked(db, item.parent_id);
    });
  });
}

export function updateItem(
  itemId: string,
  name: string,
  notes: string,
  season: Season,
  expirationDate: string | null,
  reminderDays: number
): Promise<void> {
  return withDb(async (db) => {
    await db.runAsync(
      "UPDATE items SET name = ?, notes = ?, season = ?, expiration_date = ?, reminder_days = ?, updated_at = datetime('now') WHERE id = ?",
      [name, notes, season, expirationDate, reminderDays, itemId]
    );
  });
}

// Moves the item, and everything inside it, to another zone. It leaves the
// item it was stored in (that one stays behind in the old zone).
export function moveItem(itemId: string, newZoneId: string): Promise<void> {
  return withDb(async (db) => {
    await db.withTransactionAsync(async () => {
      const item = await db.getFirstAsync<{ parent_id: string | null }>(
        "SELECT parent_id FROM items WHERE id = ?",
        [itemId]
      );
      if (!item) return;
      await db.runAsync(
        `${subtreeCte(1)} UPDATE items SET zone_id = ?, updated_at = datetime('now') WHERE id IN (SELECT id FROM subtree)`,
        [itemId, newZoneId]
      );
      await db.runAsync("UPDATE items SET parent_id = NULL WHERE id = ?", [itemId]);
      await syncAncestorsChecked(db, item.parent_id);
    });
  });
}

// Stores the item (with everything inside it) inside `parentId`, or straight
// in its zone when null. Refused silently when it would go deeper than
// MAX_ITEM_DEPTH or into itself — the pickers never offer such a target.
export function setItemParent(itemId: string, parentId: string | null): Promise<void> {
  return withDb(async (db) => {
    await db.withTransactionAsync(async () => {
      const zoneItems = await db.getAllAsync<Item>(
        "SELECT * FROM items WHERE zone_id = (SELECT zone_id FROM items WHERE id = ?)",
        [itemId]
      );
      const item = zoneItems.find((i) => i.id === itemId);
      if (!item || item.parent_id === parentId) return;
      if (parentId && !canNestInto(itemId, parentId, zoneItems)) return;
      await db.runAsync(
        "UPDATE items SET parent_id = ?, updated_at = datetime('now') WHERE id = ?",
        [parentId, itemId]
      );
      await syncAncestorsChecked(db, item.parent_id);
      await syncAncestorsChecked(db, parentId);
    });
  });
}

// What an item is stored in, for showing "Zone › Sac › Trousse". Two levels
// up is all there can be (MAX_ITEM_DEPTH is 3), so two joins cover it.
export type ItemParentNames = {
  parent_name: string | null;
  grandparent_name: string | null;
};

const PARENT_NAMES_SELECT = "p.name as parent_name, gp.name as grandparent_name";
const PARENT_NAMES_JOIN = `
  LEFT JOIN items p ON i.parent_id = p.id
  LEFT JOIN items gp ON p.parent_id = gp.id
`;

// Outermost first: ["Sac", "Trousse"] for the Brosse à dent.
export function parentPath(item: ItemParentNames): string[] {
  return [item.grandparent_name, item.parent_name].filter((n): n is string => !!n);
}

export type SearchResultItem = Item &
  ItemParentNames & {
    zone_name: string;
    zone_checklist: number;
    location_id: string;
    location_name: string;
    location_icon: string;
  };

const SEARCH_ITEM_QUERY = `
  SELECT i.*, z.name as zone_name, z.checklist as zone_checklist, l.id as location_id, l.name as location_name, l.icon as location_icon, ${PARENT_NAMES_SELECT}
  FROM items i
  JOIN zones z ON i.zone_id = z.id
  JOIN locations l ON z.location_id = l.id
  ${PARENT_NAMES_JOIN}
`;

// Matching happens in JS (see normalizeForSearch) rather than with SQL LIKE,
// whose case folding is ASCII-only: "Éponge" would miss "Eponge". An inventory
// is a few hundred rows, so loading the candidates and filtering is cheap.
function filterAndSortSearchResults(
  rows: SearchResultItem[],
  query: string
): SearchResultItem[] {
  const q = normalizeForSearch(query);
  return rows
    .filter((r) => matchesSearch(q, r.name, r.notes))
    .sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: "base" }));
}

export function searchItems(
  query: string,
  locationId: string
): Promise<SearchResultItem[]> {
  return withDb(async (db) => {
    const rows = await db.getAllAsync<SearchResultItem>(
      `${SEARCH_ITEM_QUERY}
       WHERE l.id = ?`,
      [locationId]
    );
    return filterAndSortSearchResults(rows, query);
  });
}

export function searchAllItems(query: string): Promise<SearchResultItem[]> {
  return withDb(async (db) => {
    const rows = await db.getAllAsync<SearchResultItem>(SEARCH_ITEM_QUERY);
    return filterAndSortSearchResults(rows, query);
  });
}

// Taking the Trousse out of the van takes everything inside it too (and
// putting it back brings it all back).
export function setItemOutOfVan(itemId: string, outOfVan: boolean): Promise<void> {
  return setItemsOutOfVan([itemId], outOfVan);
}

export function setItemsOutOfVan(itemIds: string[], outOfVan: boolean): Promise<void> {
  if (itemIds.length === 0) return Promise.resolve();
  return withDb(async (db) => {
    await db.runAsync(
      `${subtreeCte(itemIds.length)} UPDATE items SET out_of_van = ?, updated_at = datetime('now') WHERE id IN (SELECT id FROM subtree)`,
      [...itemIds, outOfVan ? 1 : 0]
    );
  });
}

// Checks (or unchecks) the item and everything inside it, then updates the
// items it is stored in (see syncAncestorsChecked).
export function setItemChecked(itemId: string, checked: boolean): Promise<void> {
  return withDb(async (db) => {
    await db.withTransactionAsync(async () => {
      const item = await db.getFirstAsync<{ parent_id: string | null }>(
        "SELECT parent_id FROM items WHERE id = ?",
        [itemId]
      );
      if (!item) return;
      await db.runAsync(
        `${subtreeCte(1)} UPDATE items SET checked = ?, updated_at = datetime('now') WHERE id IN (SELECT id FROM subtree)`,
        [itemId, checked ? 1 : 0]
      );
      await syncAncestorsChecked(db, item.parent_id);
    });
  });
}

export function clearItemExpiration(itemId: string): Promise<void> {
  return withDb(async (db) => {
    await db.runAsync(
      "UPDATE items SET expiration_date = NULL, updated_at = datetime('now') WHERE id = ?",
      [itemId]
    );
  });
}

export function resetChecklistItems(zoneId: string): Promise<void> {
  return withDb(async (db) => {
    await db.runAsync(
      "UPDATE items SET checked = 0, updated_at = datetime('now') WHERE zone_id = ? AND checked = 1",
      [zoneId]
    );
  });
}

export type OutOfVanItem = Item &
  ItemParentNames & {
    zone_name: string;
    zone_color: string;
    location_id: string;
    location_name: string;
    location_icon: string;
  };

const OUT_OF_VAN_ITEM_QUERY = `
  SELECT i.*, z.name as zone_name, z.color as zone_color, l.id as location_id, l.name as location_name, l.icon as location_icon, ${PARENT_NAMES_SELECT}
  FROM items i
  JOIN zones z ON i.zone_id = z.id
  JOIN locations l ON z.location_id = l.id
  ${PARENT_NAMES_JOIN}
`;

export function getOutOfVanItems(locationId: string): Promise<OutOfVanItem[]> {
  return withDb((db) =>
    db.getAllAsync<OutOfVanItem>(
      `${OUT_OF_VAN_ITEM_QUERY} WHERE i.out_of_van = 1 AND l.id = ? ORDER BY i.name COLLATE NOCASE`,
      [locationId]
    )
  );
}

export function getAllOutOfVanItems(): Promise<OutOfVanItem[]> {
  return withDb((db) =>
    db.getAllAsync<OutOfVanItem>(
      `${OUT_OF_VAN_ITEM_QUERY} WHERE i.out_of_van = 1 ORDER BY i.name COLLATE NOCASE`
    )
  );
}

export function sanitizeSeason(v: unknown): Season {
  return v === "summer" || v === "winter" ? v : "none";
}

export type SeasonalItem = Item & {
  zone_name: string;
  location_name: string;
  location_icon: string;
};

export function listSeasonalItems(): Promise<SeasonalItem[]> {
  return withDb((db) =>
    db.getAllAsync<SeasonalItem>(
      `SELECT i.*, z.name as zone_name, l.name as location_name, l.icon as location_icon
       FROM items i
       JOIN zones z ON i.zone_id = z.id
       JOIN locations l ON z.location_id = l.id
       WHERE i.season != 'none'
       ORDER BY i.name COLLATE NOCASE`
    )
  );
}

export function sanitizeKitSeason(v: unknown): KitSeason {
  return v === "summer" ? "summer" : "winter";
}

// Every item (any season) with where it lives, plus every wanted item — the
// whole picture the kit screen derives its groups from, in one queue slot.
export type KitItem = SeasonalItem & { location_id: string };
export type KitData = { items: KitItem[]; wanted: WantedItem[] };

export function getKitData(): Promise<KitData> {
  return withDb(async (db) => {
    const items = await db.getAllAsync<KitItem>(
      `SELECT i.*, z.name as zone_name, l.id as location_id, l.name as location_name, l.icon as location_icon
       FROM items i
       JOIN zones z ON i.zone_id = z.id
       JOIN locations l ON z.location_id = l.id
       ORDER BY i.name COLLATE NOCASE`
    );
    const wanted = await db.getAllAsync<WantedItem>(
      "SELECT id, name, season, notes, created_at FROM wanted_items ORDER BY name COLLATE NOCASE"
    );
    return { items, wanted };
  });
}

export function insertWantedItem(
  id: string,
  name: string,
  season: KitSeason,
  notes: string
): Promise<void> {
  return withDb(async (db) => {
    await db.runAsync(
      "INSERT INTO wanted_items (id, name, season, notes) VALUES (?, ?, ?, ?)",
      [id, name, season, notes]
    );
  });
}

export function updateWantedItem(
  id: string,
  name: string,
  season: KitSeason,
  notes: string
): Promise<void> {
  return withDb(async (db) => {
    await db.runAsync(
      "UPDATE wanted_items SET name = ?, season = ?, notes = ?, updated_at = datetime('now') WHERE id = ?",
      [name, season, notes, id]
    );
  });
}

export function deleteWantedItem(id: string): Promise<void> {
  return withDb(async (db) => {
    await db.runAsync("DELETE FROM wanted_items WHERE id = ?", [id]);
  });
}

// "Je l'ai": the wanted row becomes a real item in the chosen zone, keeping
// its name, season and notes. One transaction, so a failure never leaves the
// thing both wanted and owned (or neither).
export function fulfillWantedItem(
  wantedId: string,
  newItemId: string,
  zoneId: string,
  outOfVan: boolean
): Promise<void> {
  return withDb(async (db) => {
    await db.withTransactionAsync(async () => {
      const wanted = await db.getFirstAsync<WantedItem>(
        "SELECT id, name, season, notes, created_at FROM wanted_items WHERE id = ?",
        [wantedId]
      );
      if (!wanted) throw new Error("Wanted item not found");
      await db.runAsync(
        "INSERT INTO items (id, name, zone_id, notes, season, out_of_van) VALUES (?, ?, ?, ?, ?, ?)",
        [newItemId, wanted.name, zoneId, wanted.notes, wanted.season, outOfVan ? 1 : 0]
      );
      await db.runAsync("DELETE FROM wanted_items WHERE id = ?", [wantedId]);
    });
  });
}

// Wanted items aren't tied to a location, so search shows them from any
// screen. Same accent-insensitive JS matching as searchItems.
export function searchWantedItems(query: string): Promise<WantedItem[]> {
  return withDb(async (db) => {
    const rows = await db.getAllAsync<WantedItem>(
      "SELECT id, name, season, notes, created_at FROM wanted_items"
    );
    const q = normalizeForSearch(query);
    return rows
      .filter((r) => matchesSearch(q, r.name, r.notes))
      .sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: "base" }));
  });
}

export type ItemWithExpiration = Item & { zone_name: string; location_name: string };

export function listItemsWithExpiration(): Promise<ItemWithExpiration[]> {
  return withDb((db) =>
    db.getAllAsync<ItemWithExpiration>(
      `SELECT i.*, z.name as zone_name, l.name as location_name
       FROM items i
       JOIN zones z ON i.zone_id = z.id
       JOIN locations l ON z.location_id = l.id
       WHERE i.expiration_date IS NOT NULL
       ORDER BY i.expiration_date ASC`
    )
  );
}

export function listAllItems(): Promise<
  (Item & { zone_name: string; location_id: string; location_icon: string })[]
> {
  return withDb((db) =>
    db.getAllAsync<Item & { zone_name: string; location_id: string; location_icon: string }>(
      `SELECT i.*, z.name as zone_name, z.location_id as location_id, l.icon as location_icon
       FROM items i
       JOIN zones z ON i.zone_id = z.id
       JOIN locations l ON z.location_id = l.id
       ORDER BY i.name COLLATE NOCASE`
    )
  );
}

export function updateZone(
  zoneId: string,
  name: string,
  color: string,
  fillOpacity: number,
  checklist: boolean
): Promise<void> {
  return withDb(async (db) => {
    await db.runAsync(
      "UPDATE zones SET name = ?, color = ?, fill_opacity = ?, checklist = ?, updated_at = datetime('now') WHERE id = ?",
      [name, sanitizeHex(color, DEFAULT_ZONE_COLOR), fillOpacity, checklist ? 1 : 0, zoneId]
    );
  });
}

export function deleteZone(zoneId: string): Promise<void> {
  return withDb(async (db) => {
    await db.runAsync("DELETE FROM zones WHERE id = ?", [zoneId]);
  });
}

export function insertZone(
  id: string,
  name: string,
  color: string,
  geometry: Zone["geometry"],
  locationId: string,
  checklist: boolean = false
): Promise<void> {
  return withDb(async (db) => {
    await db.withTransactionAsync(async () => {
      const maxOrder = await db.getFirstAsync<{ m: number }>(
        "SELECT COALESCE(MAX(sort_order), 0) as m FROM zones WHERE location_id = ?",
        [locationId]
      );
      const order = (maxOrder?.m ?? 0) + 1;
      await db.runAsync(
        "INSERT INTO zones (id, name, color, geometry, sort_order, checklist, location_id) VALUES (?, ?, ?, ?, ?, ?, ?)",
        [id, name, sanitizeHex(color, DEFAULT_ZONE_COLOR), JSON.stringify(geometry), order, checklist ? 1 : 0, locationId]
      );
    });
  });
}

export function splitZoneInDb(
  zone: ZoneWithCount,
  id1: string,
  id2: string,
  geom1: Zone["geometry"],
  geom2: Zone["geometry"],
  suffix1: string,
  suffix2: string
): Promise<void> {
  return withDb(async (db) => {
    await db.withTransactionAsync(async () => {
      const maxOrder = await db.getFirstAsync<{ m: number }>(
        "SELECT COALESCE(MAX(sort_order), 0) as m FROM zones WHERE location_id = ?",
        [zone.location_id]
      );
      const order = (maxOrder?.m ?? 0) + 1;

      await db.runAsync(
        "INSERT INTO zones (id, name, color, geometry, sort_order, fill_opacity, checklist, location_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
        [id1, zone.name + suffix1, zone.color, JSON.stringify(geom1), order, zone.fill_opacity, zone.checklist, zone.location_id]
      );
      await db.runAsync(
        "INSERT INTO zones (id, name, color, geometry, sort_order, fill_opacity, checklist, location_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
        [id2, zone.name + suffix2, zone.color, JSON.stringify(geom2), order + 1, zone.fill_opacity, zone.checklist, zone.location_id]
      );

      // Move all items to the first new zone
      await db.runAsync("UPDATE items SET zone_id = ? WHERE zone_id = ?", [
        id1,
        zone.id,
      ]);

      // Delete original zone
      await db.runAsync("DELETE FROM zones WHERE id = ?", [zone.id]);
    });
  });
}

export function updateZoneGeometry(
  zoneId: string,
  geometry: Zone["geometry"]
): Promise<void> {
  return withDb(async (db) => {
    await db.runAsync(
      "UPDATE zones SET geometry = ?, updated_at = datetime('now') WHERE id = ?",
      [JSON.stringify(geometry), zoneId]
    );
  });
}

export function listLocations(): Promise<Location[]> {
  return withDb(async (db) => {
    const rows = await db.getAllAsync<Location & { outline: string }>(
      "SELECT * FROM locations ORDER BY sort_order"
    );
    return rows.flatMap((r) => {
      let outline: unknown;
      try {
        outline = JSON.parse(r.outline as unknown as string);
      } catch {
        console.warn(`Skipping location ${r.id}: invalid outline JSON`);
        return [];
      }
      if (!isValidOutline(outline)) {
        console.warn(`Skipping location ${r.id}: invalid outline shape`);
        return [];
      }
      let labels: LocationLabels | undefined;
      const rawLabels = (r as { labels?: string | null }).labels;
      if (rawLabels) {
        try {
          const parsed = JSON.parse(rawLabels);
          if (parsed && typeof parsed === "object") labels = parsed;
        } catch {
          // A corrupt labels blob just falls back to defaults, never a skip.
          console.warn(`Location ${r.id}: invalid labels JSON, using defaults`);
        }
      }
      return [{ ...r, outline, labels }];
    });
  });
}

export function insertLocation(
  id: string,
  name: string,
  outline: Outline,
  icon: string
): Promise<void> {
  return withDb(async (db) => {
    const maxOrder = await db.getFirstAsync<{ m: number }>(
      "SELECT COALESCE(MAX(sort_order), 0) as m FROM locations"
    );
    const order = (maxOrder?.m ?? 0) + 1;
    await db.runAsync(
      "INSERT INTO locations (id, name, outline, icon, sort_order) VALUES (?, ?, ?, ?, ?)",
      [id, name, JSON.stringify(outline), icon, order]
    );
  });
}

export function updateLocation(id: string, name: string, icon: string): Promise<void> {
  return withDb(async (db) => {
    await db.runAsync(
      "UPDATE locations SET name = ?, icon = ?, updated_at = datetime('now') WHERE id = ?",
      [name, icon, id]
    );
  });
}

export function updateLocationOutline(id: string, outline: Outline): Promise<void> {
  return withDb(async (db) => {
    await db.runAsync(
      "UPDATE locations SET outline = ?, updated_at = datetime('now') WHERE id = ?",
      [JSON.stringify(outline), id]
    );
  });
}

export function updateLocationLabels(id: string, labels: LocationLabels): Promise<void> {
  return withDb(async (db) => {
    await db.runAsync(
      "UPDATE locations SET labels = ?, updated_at = datetime('now') WHERE id = ?",
      [JSON.stringify(labels), id]
    );
  });
}

export function deleteLocation(id: string): Promise<void> {
  return withDb(async (db) => {
    await db.runAsync("DELETE FROM locations WHERE id = ?", [id]);
  });
}

export function instantiateTemplate(
  locationId: string,
  template: LayoutTemplate
): Promise<void> {
  return withDb(async (db) => {
    await db.withTransactionAsync(async () => {
      for (const zone of template.zones) {
        const id = Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
        // Resolved here, once: the name is stored as plain text, so renaming a
        // zone later — or switching the app's language — leaves it alone.
        await db.runAsync(
          "INSERT INTO zones (id, name, color, geometry, sort_order, location_id) VALUES (?, ?, ?, ?, ?, ?)",
          [
            id,
            i18n.t(zone.nameKey),
            zone.color,
            JSON.stringify(zone.geometry),
            zone.sort_order,
            locationId,
          ]
        );
      }
    });
  });
}

export type DataFingerprint = { fingerprint: string; itemCount: number };

// A cheap stand-in for "has anything worth backing up changed?": the row count
// of each table plus the most recent updated_at in it. Edits bump updated_at,
// additions and deletions move the counts — so any change to locations, zones
// or items produces a different string, without instrumenting every mutation.
// Preferences are deliberately left out: switching theme or season isn't data
// worth re-exporting for.
export function getDataFingerprint(): Promise<DataFingerprint> {
  return withDb(async (db) => {
    const row = await db.getFirstAsync<{
      location_count: number;
      zone_count: number;
      item_count: number;
      wanted_count: number;
      locations_at: string;
      zones_at: string;
      items_at: string;
      wanted_at: string;
    }>(
      `SELECT
         (SELECT COUNT(*) FROM locations) AS location_count,
         (SELECT COUNT(*) FROM zones) AS zone_count,
         (SELECT COUNT(*) FROM items) AS item_count,
         (SELECT COUNT(*) FROM wanted_items) AS wanted_count,
         (SELECT COALESCE(MAX(updated_at), '') FROM locations) AS locations_at,
         (SELECT COALESCE(MAX(updated_at), '') FROM zones) AS zones_at,
         (SELECT COALESCE(MAX(updated_at), '') FROM items) AS items_at,
         (SELECT COALESCE(MAX(updated_at), '') FROM wanted_items) AS wanted_at`
    );
    if (!row) return { fingerprint: "", itemCount: 0 };
    const parts: (string | number)[] = [
      row.location_count,
      row.zone_count,
      row.item_count,
      row.locations_at,
      row.zones_at,
      row.items_at,
    ];
    // Only added once the wanted list has ever held something, so a device
    // that never used it keeps the exact fingerprint it had before the table
    // existed — otherwise updating the app alone would look like a data change
    // and wake the backup reminder.
    if (row.wanted_count > 0) parts.push(row.wanted_count, row.wanted_at);
    return {
      fingerprint: parts.join("|"),
      itemCount: row.item_count,
    };
  });
}

export type ExportedData = {
  appVersion: string;
  exportedAt: string;
  locations: unknown[];
  zones: unknown[];
  items: unknown[];
  // Optional: backups made before the season kit existed don't have it.
  wantedItems?: unknown[];
  preferences: unknown[];
};

export function exportAllData(appVersion: string): Promise<ExportedData> {
  return withDb(async (db) => {
    const locations = await db.getAllAsync("SELECT * FROM locations ORDER BY sort_order");
    const zones = await db.getAllAsync("SELECT * FROM zones ORDER BY sort_order");
    const items = await db.getAllAsync("SELECT * FROM items ORDER BY name");
    const wantedItems = await db.getAllAsync("SELECT * FROM wanted_items ORDER BY name");
    // activeLocationId is which location this device happens to have open —
    // session state, not a setting worth carrying into another device/backup.
    const preferences = (
      await db.getAllAsync<{ key: string; value: string }>("SELECT * FROM preferences")
    ).filter((p) => p.key !== "activeLocationId");
    return {
      appVersion,
      exportedAt: new Date().toISOString(),
      locations,
      zones,
      items,
      wantedItems,
      preferences,
    };
  });
}

export function importAllData(
  rawLocations: Record<string, unknown>[],
  rawZones: Record<string, unknown>[],
  rawItems: Record<string, unknown>[],
  rawPreferences: Record<string, unknown>[],
  rawWantedItems: Record<string, unknown>[] = []
): Promise<void> {
  return withDb(async (db) => {
    await db.withTransactionAsync(async () => {
      // An older backup has no wanted list: importing it leaves an empty one,
      // the same "replace everything" rule as every other table.
      await db.runAsync("DELETE FROM wanted_items");
      await db.runAsync("DELETE FROM items");
      await db.runAsync("DELETE FROM zones");
      await db.runAsync("DELETE FROM locations");
      // Preferences whose value equals the app's default are never written to
      // the DB (see reloadShowMenuHeader etc.), so a backup made without ever
      // touching a setting simply omits that key. Without clearing first,
      // INSERT OR REPLACE below would leave the device's own stale value in
      // place instead of falling back to the default the backup implies.
      await db.runAsync("DELETE FROM preferences");

      for (const location of rawLocations) {
        await db.runAsync(
          "INSERT INTO locations (id, name, outline, icon, labels, sort_order, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
          [
            location.id as string,
            location.name as string,
            location.outline as string,
            (location.icon as string) ?? DEFAULT_LOCATION_ICON,
            // Orientation inscriptions: exported as a JSON string via SELECT *;
            // null on older backups leaves the plan on its built-in defaults.
            (location.labels as string) ?? null,
            (location.sort_order as number) ?? 0,
            toSqliteTimestamp(location.created_at),
            toSqliteTimestamp(location.updated_at),
          ]
        );
      }

      for (const zone of rawZones) {
        await db.runAsync(
          "INSERT INTO zones (id, name, color, geometry, fill_opacity, checklist, sort_order, location_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
          [
            zone.id as string,
            zone.name as string,
            sanitizeHex(zone.color as string, DEFAULT_ZONE_COLOR),
            zone.geometry as string,
            sanitizeFillOpacity(zone.fill_opacity),
            zone.checklist ? 1 : 0,
            (zone.sort_order as number) ?? 0,
            zone.location_id as string,
            toSqliteTimestamp(zone.created_at),
            toSqliteTimestamp(zone.updated_at),
          ]
        );
      }

      // parent_id is set in a second pass below: a child can come before
      // its parent in the file, and the foreign key would refuse it.
      for (const item of rawItems) {
        await db.runAsync(
          "INSERT INTO items (id, name, zone_id, notes, out_of_van, season, checked, expiration_date, reminder_days, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
          [
            item.id as string,
            item.name as string,
            item.zone_id as string,
            (item.notes as string) ?? "",
            (item.out_of_van as number) ?? 0,
            sanitizeSeason(item.season),
            item.checked ? 1 : 0,
            (item.expiration_date as string) ?? null,
            (item.reminder_days as number) ?? 7,
            toSqliteTimestamp(item.created_at),
            toSqliteTimestamp(item.updated_at),
          ]
        );
      }

      // Backups made before nested items have no parent_id at all. A parent
      // missing from the file, or sitting in another zone, leaves the item
      // directly in its zone rather than failing the whole import.
      const zoneOfItem = new Map(rawItems.map((i) => [i.id as string, i.zone_id as string]));
      for (const item of rawItems) {
        const parentId = item.parent_id;
        if (typeof parentId !== "string" || parentId === item.id) continue;
        if (zoneOfItem.get(parentId) !== item.zone_id) continue;
        await db.runAsync("UPDATE items SET parent_id = ? WHERE id = ?", [parentId, item.id as string]);
      }

      for (const wanted of rawWantedItems) {
        await db.runAsync(
          "INSERT INTO wanted_items (id, name, season, notes, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)",
          [
            wanted.id as string,
            wanted.name as string,
            sanitizeKitSeason(wanted.season),
            typeof wanted.notes === "string" ? wanted.notes : "",
            toSqliteTimestamp(wanted.created_at),
            toSqliteTimestamp(wanted.updated_at),
          ]
        );
      }

      for (const pref of rawPreferences) {
        await db.runAsync(
          "INSERT OR REPLACE INTO preferences (key, value) VALUES (?, ?)",
          [pref.key as string, pref.value as string]
        );
      }
    });
  });
}
