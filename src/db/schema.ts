export const MIGRATIONS = [
  `CREATE TABLE IF NOT EXISTS zones (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    color TEXT NOT NULL DEFAULT '#4A90D9',
    geometry TEXT NOT NULL,
    sort_order INTEGER NOT NULL DEFAULT 0,
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now'))
  );`,
  `CREATE TABLE IF NOT EXISTS items (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    zone_id TEXT NOT NULL REFERENCES zones(id) ON DELETE CASCADE,
    notes TEXT DEFAULT '',
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now'))
  );`,
  `CREATE INDEX IF NOT EXISTS idx_items_name ON items(name COLLATE NOCASE);`,
  `CREATE INDEX IF NOT EXISTS idx_items_zone ON items(zone_id);`,
];
