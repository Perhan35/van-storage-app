export type ExpirationStatus = "expired" | "soon" | "ok";

const MS_PER_DAY = 24 * 60 * 60 * 1000;

function startOfDay(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

// Whole-day difference between an "YYYY-MM-DD" expiration date and today,
// ignoring time-of-day so a date due "today" reads as 0, not a fraction.
export function daysUntilExpiration(iso: string, now: Date = new Date()): number {
  const [y, m, d] = iso.split("-").map(Number);
  const expiration = new Date(y, m - 1, d);
  const diffMs = startOfDay(expiration).getTime() - startOfDay(now).getTime();
  return Math.round(diffMs / MS_PER_DAY);
}

export function getExpirationStatus(
  iso: string,
  reminderDays: number,
  now: Date = new Date()
): ExpirationStatus {
  const days = daysUntilExpiration(iso, now);
  if (days < 0) return "expired";
  if (days <= reminderDays) return "soon";
  return "ok";
}
