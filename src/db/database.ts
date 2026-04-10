import * as SQLite from "expo-sqlite";
import { MIGRATIONS } from "./schema";
import { SEED_ZONES } from "./seed";

let db: SQLite.SQLiteDatabase | null = null;

export async function getDb(): Promise<SQLite.SQLiteDatabase> {
  if (db) return db;
  db = await SQLite.openDatabaseAsync("van-storage.db");
  await db.execAsync("PRAGMA journal_mode = WAL;");
  await db.execAsync("PRAGMA foreign_keys = ON;");
  for (const migration of MIGRATIONS) {
    await db.execAsync(migration);
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
};

export type Item = {
  id: string;
  name: string;
  zone_id: string;
  notes: string;
};

export type ZoneWithCount = Zone & { item_count: number };
