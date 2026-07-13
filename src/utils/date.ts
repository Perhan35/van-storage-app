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
