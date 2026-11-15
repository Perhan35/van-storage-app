import { getPreference, setPreference } from "../db/preferences";

// Which item groups (a Trousse with things inside) the user left open. Groups
// start closed; opening one is remembered across visits and restarts. Kept as
// one preference for every zone, since item ids are unique. The zone screen
// drops a group's id when that group is deleted.
const PREF_KEY = "expandedItemIds";

// Read from the preferences table every time (no in-memory cache), so a
// backup import that replaces the preferences is picked up straight away.
export async function loadExpandedItemIds(): Promise<Set<string>> {
  const stored = await getPreference(PREF_KEY);
  let ids: string[] = [];
  try {
    const parsed = JSON.parse(stored ?? "[]");
    if (Array.isArray(parsed)) ids = parsed.filter((v): v is string => typeof v === "string");
  } catch {
    // A corrupt value just means every group starts closed.
  }
  return new Set(ids);
}

export async function saveExpandedItemIds(ids: Set<string>): Promise<void> {
  await setPreference(PREF_KEY, JSON.stringify([...ids]));
}
