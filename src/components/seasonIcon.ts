import { Season } from "../db/database";

export function seasonIconName(season: Season): string | null {
  switch (season) {
    case "summer":
      return "weather-sunny";
    case "winter":
      return "snowflake";
    default:
      return null;
  }
}

export function seasonIconColor(season: Season): string | undefined {
  switch (season) {
    case "summer":
      return "#F5A623";
    case "winter":
      return "#4A90D9";
    default:
      return undefined;
  }
}
