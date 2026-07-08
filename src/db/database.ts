import * as SQLite from "expo-sqlite";
import { ITEM_COLUMNS_TO_ADD, MIGRATIONS, ZONE_COLUMNS_TO_ADD } from "./schema";
import { SEED_ZONES } from "./seed";

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

async function openAndMigrate(): Promise<SQLite.SQLiteDatabase> {
  const db = await SQLite.openDatabaseAsync("van-storage.db");
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
  // Seed default zones if empty
  const count = await db.getFirstAsync<{ c: number }>(
    "SELECT COUNT(*) as c FROM zones"
  );
  if (count && count.c === 0) {
    for (const zone of SEED_ZONES) {
      await db.runAsync(
        "INSERT INTO zones (id, name, color, geometry, sort_order) VALUES (?, ?, ?, ?, ?)",
        [zone.id, zone.name, zone.color, JSON.stringify(zone.geometry), zone.sort_order]
      );
    }
  }
  return db;
}

export type Zone = {
  id: string;
  name: string;
  color: string;
  geometry: { type: "rect"; x: number; y: number; w: number; h: number };
  sort_order: number;
  fill_opacity: number;
};

export type Item = {
  id: string;
  name: string;
  zone_id: string;
  notes: string;
  out_of_van: number;
};

export type ZoneWithCount = Zone & { item_count: number };
