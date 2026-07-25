import { Item, Season, ZoneWithCount } from "../db/database";

export type ItemWithZoneName = Item & { zone_name: string; location_id: string; location_icon: string };

export type ZoneWithLocationIcon = ZoneWithCount & { location_icon: string };

export type ZoneQuestion = {
  kind: "zone";
  item: ItemWithZoneName;
  correctZoneId: string;
};

export type SeasonQuestion = {
  kind: "season";
  item: ItemWithZoneName;
  correct: Season;
};

export type QuantityQuestion = {
  kind: "quantity";
  zone: ZoneWithLocationIcon;
  correct: number;
  choices: number[];
};

export type GameQuestion = ZoneQuestion | SeasonQuestion | QuantityQuestion;

function pickRandom<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}

function shuffle<T>(arr: T[]): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function generateQuantityChoices(correct: number): number[] {
  const deltas = shuffle([-3, -2, -1, 1, 2, 3]);
  const choices = new Set<number>([correct]);
  for (const d of deltas) {
    if (choices.size >= 4) break;
    const candidate = correct + d;
    if (candidate >= 0) choices.add(candidate);
  }
  let extra = correct + 4;
  while (choices.size < 4) {
    choices.add(extra);
    extra++;
  }
  return shuffle([...choices]);
}

export function questionKey(q: GameQuestion): string {
  switch (q.kind) {
    case "zone":
      return `zone:${q.item.id}`;
    case "season":
      return `season:${q.item.id}`;
    case "quantity":
      return `quantity:${q.zone.id}`;
  }
}

// The location icon for a question's subject — omitted for "zone" ("where
// is") questions, since those are about finding the location, not shown it.
export function questionLocationIcon(q: GameQuestion): string | null {
  switch (q.kind) {
    case "zone":
      return null;
    case "season":
      return q.item.location_icon;
    case "quantity":
      return q.zone.location_icon;
  }
}

function buildQuestion(
  kind: GameQuestion["kind"],
  items: ItemWithZoneName[],
  zones: ZoneWithLocationIcon[]
): GameQuestion {
  switch (kind) {
    case "zone": {
      const item = pickRandom(items);
      return { kind: "zone", item, correctZoneId: item.zone_id };
    }
    case "season": {
      const item = pickRandom(items);
      return { kind: "season", item, correct: item.season };
    }
    case "quantity": {
      const zone = pickRandom(zones);
      return {
        kind: "quantity",
        zone,
        correct: zone.item_count,
        choices: generateQuantityChoices(zone.item_count),
      };
    }
  }
}

// Picks a random question type/subject, avoiding an immediate repeat of the
// previous question (identified by questionKey) when another option exists.
export function generateQuestion(
  items: ItemWithZoneName[],
  zones: ZoneWithLocationIcon[],
  avoidKey?: string
): GameQuestion | null {
  const kinds: GameQuestion["kind"][] = [];
  // Weighted 2x: "where is" questions should come up more often than season ones.
  if (items.length >= 1 && zones.length >= 2) kinds.push("zone", "zone");
  if (items.length >= 1) kinds.push("season");
  if (zones.length >= 1) kinds.push("quantity");

  if (kinds.length === 0) return null;

  let fallback: GameQuestion | null = null;
  for (const kind of shuffle(kinds)) {
    const question = buildQuestion(kind, items, zones);
    if (!fallback) fallback = question;
    if (questionKey(question) !== avoidKey) return question;
  }
  return fallback;
}
