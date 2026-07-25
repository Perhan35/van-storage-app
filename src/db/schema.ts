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
    out_of_van INTEGER NOT NULL DEFAULT 0,
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now'))
  );`,
  `CREATE INDEX IF NOT EXISTS idx_items_name ON items(name COLLATE NOCASE);`,
  `CREATE INDEX IF NOT EXISTS idx_items_zone ON items(zone_id);`,
  `CREATE INDEX IF NOT EXISTS idx_items_out_of_van ON items(out_of_van);`,
  `CREATE TABLE IF NOT EXISTS preferences (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
  );`,
  `CREATE TABLE IF NOT EXISTS locations (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    outline TEXT NOT NULL,
    sort_order INTEGER NOT NULL DEFAULT 0,
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now'))
  );`,
];

// Column additions handled separately via PRAGMA table_info checks, since
// the web SQLite worker doesn't propagate "duplicate column" errors as
// catchable exceptions and crashes the worker on re-runs.
export const ITEM_COLUMNS_TO_ADD: { name: string; ddl: string }[] = [
  {
    name: "out_of_van",
    ddl: "ALTER TABLE items ADD COLUMN out_of_van INTEGER NOT NULL DEFAULT 0",
  },
  {
    name: "season",
    ddl: "ALTER TABLE items ADD COLUMN season TEXT NOT NULL DEFAULT 'none'",
  },
  {
    name: "checked",
    ddl: "ALTER TABLE items ADD COLUMN checked INTEGER NOT NULL DEFAULT 0",
  },
  {
    name: "expiration_date",
    ddl: "ALTER TABLE items ADD COLUMN expiration_date TEXT",
  },
  {
    name: "reminder_days",
    ddl: "ALTER TABLE items ADD COLUMN reminder_days INTEGER NOT NULL DEFAULT 7",
  },
];

export const LOCATION_COLUMNS_TO_ADD: { name: string; ddl: string }[] = [
  {
    // Pre-existing installs only ever hold the migrated default "Van" location,
    // so defaulting to the van icon keeps their look unchanged; new locations
    // always pass an explicit icon.
    name: "icon",
    ddl: "ALTER TABLE locations ADD COLUMN icon TEXT NOT NULL DEFAULT 'van-utility'",
  },
  {
    // Nullable JSON of per-side orientation inscriptions (front/rear/left/right).
    // Null on existing installs means "use the built-in defaults" (see
    // resolveLabelText in VanLayoutSVG), so the historical look is unchanged.
    name: "labels",
    ddl: "ALTER TABLE locations ADD COLUMN labels TEXT",
  },
];

export const ZONE_COLUMNS_TO_ADD: { name: string; ddl: string }[] = [
  {
    name: "fill_opacity",
    ddl: "ALTER TABLE zones ADD COLUMN fill_opacity REAL NOT NULL DEFAULT 0.4",
  },
  {
    name: "checklist",
    ddl: "ALTER TABLE zones ADD COLUMN checklist INTEGER NOT NULL DEFAULT 0",
  },
  {
    // Nullable: SQLite can't ADD COLUMN with a NOT NULL FK, and the value is
    // backfilled separately (see openAndMigrate) for zones that predate locations.
    name: "location_id",
    ddl: "ALTER TABLE zones ADD COLUMN location_id TEXT REFERENCES locations(id) ON DELETE CASCADE",
  },
];

// Indexes on columns that only exist once the *_COLUMNS_TO_ADD above have run
// (a fresh install's CREATE TABLE doesn't have them yet), so these run after
// that, not inside MIGRATIONS. IF NOT EXISTS makes them safe to re-run every
// launch.
export const POST_COLUMN_INDEXES: string[] = [
  // The hottest predicate in the app — every zone list, the locations join,
  // and the MAX(sort_order) lookup on insert — had no index at all.
  `CREATE INDEX IF NOT EXISTS idx_zones_location ON zones(location_id);`,
  `CREATE INDEX IF NOT EXISTS idx_items_expiration ON items(expiration_date);`,
  `CREATE INDEX IF NOT EXISTS idx_items_season ON items(season);`,
];
