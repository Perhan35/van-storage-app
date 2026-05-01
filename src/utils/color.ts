function parseHex(hex: string): { r: number; g: number; b: number } | null {
  const cleaned = hex.trim().replace(/^#/, "");
  const value =
    cleaned.length === 3
      ? cleaned
          .split("")
          .map((c) => c + c)
          .join("")
      : cleaned;
  if (!/^[0-9a-fA-F]{6}$/.test(value)) return null;
  return {
    r: parseInt(value.slice(0, 2), 16),
    g: parseInt(value.slice(2, 4), 16),
    b: parseInt(value.slice(4, 6), 16),
  };
}

export function sanitizeHex(input: string | undefined | null, fallback = "#4A90D9"): string {
  if (typeof input !== "string") return fallback;
  const trimmed = input.trim();
  return /^#[0-9A-Fa-f]{3,8}$/.test(trimmed) ? trimmed : fallback;
}

export function getReadableTextColor(hex: string): "#000000" | "#FFFFFF" {
  const rgb = parseHex(hex);
  if (!rgb) return "#FFFFFF";
  const alpha = 0.65;
  const r = rgb.r * alpha + 255 * (1 - alpha);
  const g = rgb.g * alpha + 255 * (1 - alpha);
  const b = rgb.b * alpha + 255 * (1 - alpha);
  const luminance = 0.299 * r + 0.587 * g + 0.114 * b;
  return luminance >= 150 ? "#000000" : "#FFFFFF";
}
