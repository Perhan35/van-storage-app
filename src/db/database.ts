import * as SQLite from "expo-sqlite";
import {
  ITEM_COLUMNS_TO_ADD,
  LOCATION_COLUMNS_TO_ADD,
  MIGRATIONS,
  POST_COLUMN_INDEXES,
  ZONE_COLUMNS_TO_ADD,
} from "./schema";
import { getTemplate, Outline } from "./templates";
import i18n from "../i18n";

function generateId(): string {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

let dbPromise: Promise<SQLite.SQLiteDatabase> | null = null;

export async function getDb(): Promise<SQLite.SQLiteDatabase> {
  if (!dbPromise) {
    dbPromise = openAndMigrate().catch((err) => {
      dbPromise = null;
      throw err;
    });
  }
  return dbPromise;
}

// Serializes every query onto a single queue so calls from different
// screens never overlap on the one shared connection/worker.
//
// INVARIANT: a `withDb` callback must NEVER call `withDb` again (directly or
// through a repository/preferences helper that wraps `withDb`). The inner call
// would enqueue behind the outer one, which cannot resolve until the inner one
// does — a permanent deadlock. Keep every repository function single-level:
// perform its own reads/writes on the `db` it is handed, and never invoke
// another `withDb`-wrapped function from inside. Use `db.withTransactionAsync`
// for atomicity within a single callback.
let dbQueue: Promise<unknown> = Promise.resolve();

export function withDb<T>(fn: (db: SQLite.SQLiteDatabase) => Promise<T>): Promise<T> {
  const run = dbQueue.then(() => getDb().then(fn));
  dbQueue = run.then(
    () => undefined,
    () => undefined
  );
  return run;
}

// Throws away the memoized connection *and* the queue, so the next call opens a
// fresh one and starts a fresh chain.
//
// The queue is what makes a single dropped promise fatal: every later call is
// chained behind the previous one, so one native call that never settles (a
// query interrupted by the app being suspended mid-flight, say) leaves every
// subsequent read hanging for the life of the process — the startup sequence
// included, which is the "blank screen, only a restart fixes it" failure. This
// is the recovery for that, and it is deliberately blunt: nothing is closed
// (the old connection may itself be wedged), the references are simply dropped
// for the garbage collector. Only call it from a recovery path — a caller still
// waiting on the old chain keeps waiting.
export function resetDbConnection(): void {
  dbPromise = null;
  dbQueue = Promise.resolve();
}

async function openAndMigrate(): Promise<SQLite.SQLiteDatabase> {
  const db = await SQLite.openDatabaseAsync("my-inventory.db");
  await db.execAsync("PRAGMA journal_mode = WAL;");
  await db.execAsync("PRAGMA foreign_keys = ON;");
  for (const migration of MIGRATIONS) {
    await db.execAsync(migration);
  }
  // Add new columns conditionally (checked via PRAGMA table_info, since the
  // web SQLite worker crashes on duplicate-column ALTER TABLE errors).
  const itemColumns = await db.getAllAsync<{ name: string }>(
    "PRAGMA table_info(items)"
  );
  const existing = new Set(itemColumns.map((c) => c.name));
  for (const col of ITEM_COLUMNS_TO_ADD) {
    if (!existing.has(col.name)) {
      await db.execAsync(col.ddl);
    }
  }
  const zoneColumns = await db.getAllAsync<{ name: string }>(
    "PRAGMA table_info(zones)"
  );
  const existingZoneCols = new Set(zoneColumns.map((c) => c.name));
  for (const col of ZONE_COLUMNS_TO_ADD) {
    if (!existingZoneCols.has(col.name)) {
      await db.execAsync(col.ddl);
    }
  }
  const locationColumns = await db.getAllAsync<{ name: string }>(
    "PRAGMA table_info(locations)"
  );
  const existingLocationCols = new Set(locationColumns.map((c) => c.name));
  for (const col of LOCATION_COLUMNS_TO_ADD) {
    if (!existingLocationCols.has(col.name)) {
      await db.execAsync(col.ddl);
    }
  }

  // Now that every column the app expects exists (fresh install or migrated),
  // it's safe to index the ones added above.
  for (const ddl of POST_COLUMN_INDEXES) {
    await db.execAsync(ddl);
  }

  // One-time setup, guarded by "locations is empty" so it runs exactly once
  // and is a no-op on every later launch. Two cases share this path:
  //  - Fresh install (zones also empty): create the default Van location and
  //    seed it from the Van template.
  //  - Pre-feature DB (zones already has rows, no location_id set): create
  //    the same default Van location and adopt every existing zone into it,
  //    so no pre-existing data is lost.
  const locationCount = await db.getFirstAsync<{ c: number }>(
    "SELECT COUNT(*) as c FROM locations"
  );
  if (locationCount && locationCount.c === 0) {
    const template = getTemplate("van");
    const locationId = generateId();
    await db.runAsync(
      "INSERT INTO locations (id, name, outline, icon, sort_order) VALUES (?, ?, ?, ?, ?)",
      [locationId, i18n.t(template.nameKey), JSON.stringify(template.outline), template.icon, 0]
    );

    const zoneCount = await db.getFirstAsync<{ c: number }>(
      "SELECT COUNT(*) as c FROM zones"
    );
    if (zoneCount && zoneCount.c === 0) {
      for (const zone of template.zones) {
        await db.runAsync(
          "INSERT INTO zones (id, name, color, geometry, sort_order, location_id) VALUES (?, ?, ?, ?, ?, ?)",
          [zone.id, zone.name, zone.color, JSON.stringify(zone.geometry), zone.sort_order, locationId]
        );
      }
    } else {
      await db.runAsync(
        "UPDATE zones SET location_id = ? WHERE location_id IS NULL",
        [locationId]
      );
    }
  }

  await upgradeLegacyVanOutline(db);

  return db;
}

// The first multi-location build stored the van as a chamfered octagon (an
// approximation of its rounded silhouette). The outline now supports curves,
// so any location still holding that exact octagon is upgraded in place to the
// corrected, original rounded van outline. Matching the exact octagon means we
// only touch untouched auto-generated outlines and never a user-edited one.
const LEGACY_VAN_OCTAGON: { x: number; y: number }[] = [
  { x: 30, y: 0 },
  { x: 270, y: 0 },
  { x: 300, y: 30 },
  { x: 300, y: 570 },
  { x: 270, y: 600 },
  { x: 30, y: 600 },
  { x: 0, y: 570 },
  { x: 0, y: 30 },
];

function isLegacyVanOctagon(outline: unknown): boolean {
  if (typeof outline !== "object" || outline === null) return false;
  const o = outline as { w?: number; h?: number; points?: unknown };
  if (o.w !== 300 || o.h !== 600) return false;
  if (!Array.isArray(o.points) || o.points.length !== LEGACY_VAN_OCTAGON.length) return false;
  return o.points.every((p, i) => {
    const pt = p as { x?: number; y?: number; control?: unknown };
    return (
      pt.control === undefined &&
      pt.x === LEGACY_VAN_OCTAGON[i].x &&
      pt.y === LEGACY_VAN_OCTAGON[i].y
    );
  });
}

async function upgradeLegacyVanOutline(db: SQLite.SQLiteDatabase): Promise<void> {
  const rows = await db.getAllAsync<{ id: string; outline: string }>(
    "SELECT id, outline FROM locations"
  );
  const vanOutline = JSON.stringify(getTemplate("van").outline);
  for (const row of rows) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(row.outline);
    } catch {
      continue;
    }
    if (isLegacyVanOctagon(parsed)) {
      // Idempotent: once replaced, the outline no longer matches the octagon.
      await db.runAsync("UPDATE locations SET outline = ? WHERE id = ?", [vanOutline, row.id]);
    }
  }
}

export type Zone = {
  id: string;
  name: string;
  color: string;
  geometry: { type: "rect"; x: number; y: number; w: number; h: number };
  sort_order: number;
  fill_opacity: number;
  checklist: number;
  location_id: string;
};

// The four sides on which a location's plan can carry an orientation
// inscription. front/rear have built-in defaults (map.front / map.rear);
// left/right have none and appear only once given text.
export type LabelSide = "front" | "rear" | "left" | "right";

// A single side's inscription. Absent text means "fall back to the default"
// (front/rear) or "not drawn" (left/right); hidden suppresses it entirely.
// x/y are an optional custom position in canvas (outline) coordinates; when
// absent the inscription sits at its side's default anchor.
export type LabelDef = { text?: string; hidden?: boolean; x?: number; y?: number };

export type LocationLabels = Partial<Record<LabelSide, LabelDef>>;

export type Location = {
  id: string;
  name: string;
  outline: Outline;
  icon: string;
  sort_order: number;
  // Null/undefined on older rows -> the plan uses the built-in defaults.
  labels?: LocationLabels;
};

export type Season = "summer" | "winter" | "none";

export type Item = {
  id: string;
  name: string;
  zone_id: string;
  notes: string;
  out_of_van: number;
  season: Season;
  checked: number;
  expiration_date: string | null;
  reminder_days: number;
};

export type ZoneWithCount = Zone & { item_count: number };
