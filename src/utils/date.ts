function pad(n: number): string {
  return n.toString().padStart(2, "0");
}

// Parses "YYYY-MM-DD" by components (not `new Date(iso)`) to avoid UTC/local
// timezone shifts when the date has no time component.
export function formatExpiration(iso: string, locale: string): string {
  const [y, m, d] = iso.split("-").map(Number);
  if (locale.startsWith("fr")) return `${pad(d)}.${pad(m)}.${y}`;
  return new Date(y, m - 1, d).toLocaleDateString(locale);
}

// The DB stores timestamps the way SQLite's datetime('now') writes them:
// "YYYY-MM-DD HH:MM:SS", UTC. Older backups also carry ISO strings
// ("2026-09-08T17:06:17.334Z"), and the two don't sort or compare as text
// ("T" > " "), so anything coming in from outside is folded to the SQLite
// form. Unparseable or missing values become "now".
const SQLITE_TIMESTAMP = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/;

export function toSqliteTimestamp(value: unknown, now: Date = new Date()): string {
  if (typeof value === "string" && SQLITE_TIMESTAMP.test(value)) return value;
  const parsed = typeof value === "string" ? new Date(value) : null;
  const d = parsed && !Number.isNaN(parsed.getTime()) ? parsed : now;
  return (
    `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())} ` +
    `${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}:${pad(d.getUTCSeconds())}`
  );
}
