import type { SeasonMode } from "../store/useAppStore";

// The season the calendar says it is, by month alone: April to September is
// summer, October to March is winter. Northern hemisphere, no settings, no
// network. The season kit uses it to suggest switching the app's mode.
export function seasonForDate(date: Date): SeasonMode {
  const month = date.getMonth(); // 0 = January
  return month >= 3 && month <= 8 ? "summer" : "winter";
}
