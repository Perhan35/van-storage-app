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

// Turns a hex color into an `rgba(...)` string at the given alpha. Used for the
// tinted icon chips in the context menu, where a translucent fill of the theme
// color has to sit on either the light or dark surface.
export function hexToRgba(hex: string, alpha: number): string {
  const rgb = parseHex(hex);
  if (!rgb) return `rgba(0, 0, 0, ${alpha})`;
  return `rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, ${alpha})`;
}

export function sanitizeHex(input: string | undefined | null, fallback = "#4A90D9"): string {
  if (typeof input !== "string") return fallback;
  const trimmed = input.trim();
  return /^#[0-9A-Fa-f]{3,8}$/.test(trimmed) ? trimmed : fallback;
}

function relativeLuminance(r: number, g: number, b: number): number {
  const toLinear = (c: number) => {
    const s = c / 255;
    return s <= 0.04045 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
  };
  return 0.2126 * toLinear(r) + 0.7152 * toLinear(g) + 0.0722 * toLinear(b);
}

export function getReadableTextColor(
  hex: string,
  fillOpacity = 1,
  bgHex = "#FFFFFF"
): "#000000" | "#FFFFFF" {
  const fg = parseHex(hex);
  const bg = parseHex(bgHex) ?? { r: 255, g: 255, b: 255 };
  if (!fg) return "#000000";
  const r = Math.round(fg.r * fillOpacity + bg.r * (1 - fillOpacity));
  const g = Math.round(fg.g * fillOpacity + bg.g * (1 - fillOpacity));
  const b = Math.round(fg.b * fillOpacity + bg.b * (1 - fillOpacity));
  const L = relativeLuminance(r, g, b);
  const contrastBlack = (L + 0.05) / 0.05;
  const contrastWhite = 1.05 / (L + 0.05);
  return contrastWhite > contrastBlack ? "#FFFFFF" : "#000000";
}
