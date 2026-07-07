import { withDb } from "./database";

export function getPreference(key: string): Promise<string | null> {
  return withDb(async (db) => {
    const row = await db.getFirstAsync<{ value: string }>(
      "SELECT value FROM preferences WHERE key = ?",
      [key]
    );
    return row?.value ?? null;
  });
}

export function setPreference(key: string, value: string): Promise<void> {
  return withDb(async (db) => {
    await db.runAsync(
      "INSERT OR REPLACE INTO preferences (key, value) VALUES (?, ?)",
      [key, value]
    );
  });
}
