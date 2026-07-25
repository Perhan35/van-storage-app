import { withDb, Zone, Item, ZoneWithCount, Season, Location, LocationLabels } from "./database";
import { DEFAULT_LOCATION_ICON, LayoutTemplate, Outline } from "./templates";

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
      return [{ ...r, geometry }];
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

export function insertItem(
  id: string,
  name: string,
  zoneId: string,
  notes: string,
  season: Season = "none",
  expirationDate: string | null = null,
  reminderDays: number = 7
): Promise<void> {
  return withDb(async (db) => {
    await db.runAsync(
      "INSERT INTO items (id, name, zone_id, notes, season, expiration_date, reminder_days) VALUES (?, ?, ?, ?, ?, ?, ?)",
      [id, name, zoneId, notes, season, expirationDate, reminderDays]
    );
  });
}

export function deleteItem(itemId: string): Promise<void> {
  return withDb(async (db) => {
    await db.runAsync("DELETE FROM items WHERE id = ?", [itemId]);
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

export function moveItem(itemId: string, newZoneId: string): Promise<void> {
  return withDb(async (db) => {
    await db.runAsync(
      "UPDATE items SET zone_id = ?, updated_at = datetime('now') WHERE id = ?",
      [newZoneId, itemId]
    );
  });
}

export type SearchResultItem = Item & {
  zone_name: string;
  zone_checklist: number;
  location_id: string;
  location_name: string;
  location_icon: string;
};

const SEARCH_ITEM_QUERY = `
  SELECT i.*, z.name as zone_name, z.checklist as zone_checklist, l.id as location_id, l.name as location_name, l.icon as location_icon
  FROM items i
  JOIN zones z ON i.zone_id = z.id
  JOIN locations l ON z.location_id = l.id
`;

export function searchItems(
  query: string,
  locationId: string
): Promise<SearchResultItem[]> {
  return withDb((db) => {
    const escapedQuery = query.replace(/[\\%_]/g, "\\$&");
    return db.getAllAsync<SearchResultItem>(
      `${SEARCH_ITEM_QUERY}
       WHERE l.id = ?2
       AND (i.name LIKE ?1 ESCAPE '\\' COLLATE NOCASE OR i.notes LIKE ?1 ESCAPE '\\' COLLATE NOCASE)
       ORDER BY i.name COLLATE NOCASE`,
      [`%${escapedQuery}%`, locationId]
    );
  });
}

export function searchAllItems(query: string): Promise<SearchResultItem[]> {
  return withDb((db) => {
    const escapedQuery = query.replace(/[\\%_]/g, "\\$&");
    return db.getAllAsync<SearchResultItem>(
      `${SEARCH_ITEM_QUERY}
       WHERE (i.name LIKE ?1 ESCAPE '\\' COLLATE NOCASE OR i.notes LIKE ?1 ESCAPE '\\' COLLATE NOCASE)
       ORDER BY i.name COLLATE NOCASE`,
      [`%${escapedQuery}%`]
    );
  });
}

export function setItemOutOfVan(itemId: string, outOfVan: boolean): Promise<void> {
  return withDb(async (db) => {
    await db.runAsync(
      "UPDATE items SET out_of_van = ?, updated_at = datetime('now') WHERE id = ?",
      [outOfVan ? 1 : 0, itemId]
    );
  });
}

export function setItemChecked(itemId: string, checked: boolean): Promise<void> {
  return withDb(async (db) => {
    await db.runAsync(
      "UPDATE items SET checked = ?, updated_at = datetime('now') WHERE id = ?",
      [checked ? 1 : 0, itemId]
    );
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

export type OutOfVanItem = Item & {
  zone_name: string;
  zone_color: string;
  location_id: string;
  location_name: string;
  location_icon: string;
};

const OUT_OF_VAN_ITEM_QUERY = `
  SELECT i.*, z.name as zone_name, z.color as zone_color, l.id as location_id, l.name as location_name, l.icon as location_icon
  FROM items i
  JOIN zones z ON i.zone_id = z.id
  JOIN locations l ON z.location_id = l.id
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
      [name, color, fillOpacity, checklist ? 1 : 0, zoneId]
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
        [id, name, color, JSON.stringify(geometry), order, checklist ? 1 : 0, locationId]
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
        await db.runAsync(
          "INSERT INTO zones (id, name, color, geometry, sort_order, location_id) VALUES (?, ?, ?, ?, ?, ?)",
          [id, zone.name, zone.color, JSON.stringify(zone.geometry), zone.sort_order, locationId]
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
      locations_at: string;
      zones_at: string;
      items_at: string;
    }>(
      `SELECT
         (SELECT COUNT(*) FROM locations) AS location_count,
         (SELECT COUNT(*) FROM zones) AS zone_count,
         (SELECT COUNT(*) FROM items) AS item_count,
         (SELECT COALESCE(MAX(updated_at), '') FROM locations) AS locations_at,
         (SELECT COALESCE(MAX(updated_at), '') FROM zones) AS zones_at,
         (SELECT COALESCE(MAX(updated_at), '') FROM items) AS items_at`
    );
    if (!row) return { fingerprint: "", itemCount: 0 };
    return {
      fingerprint: [
        row.location_count,
        row.zone_count,
        row.item_count,
        row.locations_at,
        row.zones_at,
        row.items_at,
      ].join("|"),
      itemCount: row.item_count,
    };
  });
}

export type ExportedData = {
  appVersion: string;
  locations: unknown[];
  zones: unknown[];
  items: unknown[];
  preferences: unknown[];
};

export function exportAllData(appVersion: string): Promise<ExportedData> {
  return withDb(async (db) => {
    const locations = await db.getAllAsync("SELECT * FROM locations ORDER BY sort_order");
    const zones = await db.getAllAsync("SELECT * FROM zones ORDER BY sort_order");
    const items = await db.getAllAsync("SELECT * FROM items ORDER BY name");
    const preferences = await db.getAllAsync("SELECT * FROM preferences");
    return { appVersion, locations, zones, items, preferences };
  });
}

export function importAllData(
  rawLocations: Record<string, unknown>[],
  rawZones: Record<string, unknown>[],
  rawItems: Record<string, unknown>[],
  rawPreferences: Record<string, unknown>[]
): Promise<void> {
  return withDb(async (db) => {
    await db.withTransactionAsync(async () => {
      await db.runAsync("DELETE FROM items");
      await db.runAsync("DELETE FROM zones");
      await db.runAsync("DELETE FROM locations");

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
            (location.created_at as string) ?? new Date().toISOString(),
            (location.updated_at as string) ?? new Date().toISOString(),
          ]
        );
      }

      for (const zone of rawZones) {
        await db.runAsync(
          "INSERT INTO zones (id, name, color, geometry, fill_opacity, checklist, sort_order, location_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
          [
            zone.id as string,
            zone.name as string,
            zone.color as string,
            zone.geometry as string,
            sanitizeFillOpacity(zone.fill_opacity),
            zone.checklist ? 1 : 0,
            (zone.sort_order as number) ?? 0,
            zone.location_id as string,
            (zone.created_at as string) ?? new Date().toISOString(),
            (zone.updated_at as string) ?? new Date().toISOString(),
          ]
        );
      }

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
            (item.created_at as string) ?? new Date().toISOString(),
            (item.updated_at as string) ?? new Date().toISOString(),
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
