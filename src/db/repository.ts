import { withDb, Zone, Item, ZoneWithCount, Season } from "./database";

export const DEFAULT_FILL_OPACITY = 0.4;

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

export function listZonesWithCounts(): Promise<ZoneWithCount[]> {
  return withDb(async (db) => {
    const rows = await db.getAllAsync<ZoneWithCount & { geometry: string }>(
      `SELECT z.*, COALESCE(c.cnt, 0) as item_count
       FROM zones z
       LEFT JOIN (SELECT zone_id, COUNT(*) as cnt FROM items GROUP BY zone_id) c
       ON z.id = c.zone_id
       ORDER BY z.sort_order`
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
      "SELECT * FROM items WHERE zone_id = ? ORDER BY name COLLATE NOCASE",
      [zoneId]
    )
  );
}

export function insertItem(
  id: string,
  name: string,
  zoneId: string,
  notes: string
): Promise<void> {
  return withDb(async (db) => {
    await db.runAsync(
      "INSERT INTO items (id, name, zone_id, notes) VALUES (?, ?, ?, ?)",
      [id, name, zoneId, notes]
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
  season: Season
): Promise<void> {
  return withDb(async (db) => {
    await db.runAsync(
      "UPDATE items SET name = ?, notes = ?, season = ?, updated_at = datetime('now') WHERE id = ?",
      [name, notes, season, itemId]
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

export function searchItems(
  query: string
): Promise<(Item & { zone_name: string })[]> {
  return withDb((db) => {
    const escapedQuery = query.replace(/[\\%_]/g, "\\$&");
    return db.getAllAsync<Item & { zone_name: string }>(
      `SELECT i.*, z.name as zone_name
       FROM items i JOIN zones z ON i.zone_id = z.id
       WHERE i.name LIKE ?1 ESCAPE '\\' COLLATE NOCASE OR i.notes LIKE ?1 ESCAPE '\\' COLLATE NOCASE
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

export function getOutOfVanItems(): Promise<(Item & { zone_name: string })[]> {
  return withDb((db) =>
    db.getAllAsync<Item & { zone_name: string }>(
      `SELECT i.*, z.name as zone_name
       FROM items i JOIN zones z ON i.zone_id = z.id
       WHERE i.out_of_van = 1
       ORDER BY i.name COLLATE NOCASE`
    )
  );
}

export function sanitizeSeason(v: unknown): Season {
  return v === "summer" || v === "winter" ? v : "none";
}

export function listSeasonalItems(): Promise<(Item & { zone_name: string })[]> {
  return withDb((db) =>
    db.getAllAsync<Item & { zone_name: string }>(
      `SELECT i.*, z.name as zone_name
       FROM items i JOIN zones z ON i.zone_id = z.id
       WHERE i.season != 'none'
       ORDER BY i.name COLLATE NOCASE`
    )
  );
}

export function updateZone(
  zoneId: string,
  name: string,
  color: string,
  fillOpacity: number
): Promise<void> {
  return withDb(async (db) => {
    await db.runAsync(
      "UPDATE zones SET name = ?, color = ?, fill_opacity = ?, updated_at = datetime('now') WHERE id = ?",
      [name, color, fillOpacity, zoneId]
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
  geometry: Zone["geometry"]
): Promise<void> {
  return withDb(async (db) => {
    await db.withTransactionAsync(async () => {
      const maxOrder = await db.getFirstAsync<{ m: number }>(
        "SELECT COALESCE(MAX(sort_order), 0) as m FROM zones"
      );
      const order = (maxOrder?.m ?? 0) + 1;
      await db.runAsync(
        "INSERT INTO zones (id, name, color, geometry, sort_order) VALUES (?, ?, ?, ?, ?)",
        [id, name, color, JSON.stringify(geometry), order]
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

export type ExportedData = {
  zones: unknown[];
  items: unknown[];
  preferences: unknown[];
};

export function exportAllData(): Promise<ExportedData> {
  return withDb(async (db) => {
    const zones = await db.getAllAsync("SELECT * FROM zones ORDER BY sort_order");
    const items = await db.getAllAsync("SELECT * FROM items ORDER BY name");
    const preferences = await db.getAllAsync("SELECT * FROM preferences");
    return { zones, items, preferences };
  });
}

export function importAllData(
  rawZones: Record<string, unknown>[],
  rawItems: Record<string, unknown>[],
  rawPreferences: Record<string, unknown>[]
): Promise<void> {
  return withDb(async (db) => {
    await db.withTransactionAsync(async () => {
      await db.runAsync("DELETE FROM items");
      await db.runAsync("DELETE FROM zones");

      for (const zone of rawZones) {
        await db.runAsync(
          "INSERT INTO zones (id, name, color, geometry, fill_opacity, sort_order, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
          [
            zone.id as string,
            zone.name as string,
            zone.color as string,
            zone.geometry as string,
            sanitizeFillOpacity(zone.fill_opacity),
            (zone.sort_order as number) ?? 0,
            (zone.created_at as string) ?? new Date().toISOString(),
            (zone.updated_at as string) ?? new Date().toISOString(),
          ]
        );
      }

      for (const item of rawItems) {
        await db.runAsync(
          "INSERT INTO items (id, name, zone_id, notes, out_of_van, season, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
          [
            item.id as string,
            item.name as string,
            item.zone_id as string,
            (item.notes as string) ?? "",
            (item.out_of_van as number) ?? 0,
            sanitizeSeason(item.season),
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
