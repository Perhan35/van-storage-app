# Tags — design notes

Detailed design for item tags, expanding [ROADMAP.md, step 3](ROADMAP.md#step-3--cross-cutting-tags).
**Status: not started.** Nothing in this document is implemented yet.

_Written 2026-11-15, codebase at `318ace7` (v0.9.3) plus the uncommitted accent-insensitive
search change (`src/utils/search.ts`). Line numbers will drift; search for the symbol
names if a link is off._

All examples below are invented.

---

## 1. Why: what users do today

The app classifies an item along three axes: **where** (zone, location), **when**
(season, expiration date) and **state** (out of van, checked). Nothing says **what**
an item is. Users work around it by putting a category in the item name:

```
FOOD: Rice 1 kg
FOOD - Pasta
FOOD  : Green tea
Tools: Screwdriver set
```

This works a little, but:

| Problem | Effect |
|---|---|
| The prefix is free text | It drifts: `FOOD:`, `FOOD -`, `FOOD  :` (double space) all mean the same thing. |
| It's part of the name | Lists sorted by name put every food item under "F" instead of "Pasta", "Rice"… |
| It can't be filtered | "Show me all the food in the van" only works with a text search, and only if every item was typed the same way. |
| It can't be shown | No colour, no icon: you have to read every name to spot the category. |
| One prefix per name | An item can't be both "Food" and "Spare stock" without an even longer name. |

Other workarounds seen in the same data, **out of scope here** but worth their own notes:

- **Notes used as sub-containers** ("In the blue pouch, left pocket").
- **Expiration date used as a maintenance reminder** ("RECHARGE" with a fake date for a
  torch or a power bank).
- **A checklist zone duplicating real items** to check stock levels before a trip.
  This one overlaps with the shopping list in §9 and with ROADMAP step 2 (quantity &
  restock).

## 2. Goals and non-goals

Product decisions already taken (2026-11-15):

- **Tags, not a single category.** An item can carry several tags.
- A tag must support:
  1. **filtering search** (and, later, a zone's list — ROADMAP step 1);
  2. **a colour or an icon**, shown on each item row;
  3. **a shopping list** built from tags (see §9).

Not in the first version:

- **Automatic conversion of existing prefixes** (`FOOD: Rice` → `Rice` + tag `Food`).
  It wasn't chosen, but it's kept as an optional last phase (§13, phase 4), because
  without it existing users must tag hundreds of items by hand.
- Nested tags (`Food > Canned`).
- Tags on zones or locations.
- Tags shared between devices (depends on ROADMAP step 4, sync).

## 3. Vocabulary

| Term | Meaning |
|---|---|
| **Tag** | A named label with a colour and an optional icon. Example: `Food`, green, icon `food-apple`. |
| **Tagged item** | An item linked to one or more tags. |
| **Tag filter** | A set of tags selected above a list, which hides items that don't match. |
| **Shopping list** | A generated list of items that need buying (§9). |

UI wording to settle per language: "tag" / "étiquette" / "Etikett" / "etiqueta" /
"etichetta". Avoid "label": the code already uses `labels` for the inscriptions on a
location plan (`LocationLabels`, [database.ts](../src/db/database.ts)).

## 4. User stories (invented examples)

1. While adding *Lentils 500 g*, I tap the `Food` and `Dry goods` chips. Done in one tap
   each, no typing.
2. In search I type nothing, tap `Food`, and see every food item in the van, grouped by
   zone.
3. In a zone's list, every food item has a small green dot with an apple icon, so I see
   at a glance what's edible in the drawer.
4. Before leaving, I open **Shopping list** and see what's tagged `Food` and is expired,
   expiring soon, or (once step 2 exists) below its minimum quantity.
5. I rename `Dry goods` to `Pantry` in Settings; every item follows.
6. I delete the tag `Old stuff`; the items stay, they just lose that tag.

## 5. Data model

### 5.1 Tables

Appended to `MIGRATIONS` ([schema.ts:1](../src/db/schema.ts#L1)). The array is replayed
on every launch, so `IF NOT EXISTS` makes appending safe.

```sql
CREATE TABLE IF NOT EXISTS tags (
  id         TEXT PRIMARY KEY,
  name       TEXT NOT NULL,
  name_key   TEXT NOT NULL,          -- normalizeForSearch(name), for uniqueness + search
  color      TEXT NOT NULL,          -- "#RRGGBB", sanitised with sanitizeHex
  icon       TEXT,                   -- MaterialCommunityIcons name, nullable
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_tags_name_key ON tags(name_key);

CREATE TABLE IF NOT EXISTS item_tags (
  item_id TEXT NOT NULL REFERENCES items(id) ON DELETE CASCADE,
  tag_id  TEXT NOT NULL REFERENCES tags(id)  ON DELETE CASCADE,
  PRIMARY KEY (item_id, tag_id)
);
CREATE INDEX IF NOT EXISTS idx_item_tags_tag ON item_tags(tag_id);
```

Changes compared with the ROADMAP sketch, and why:

- **`name_key`.** SQLite can't fold accents (that's why search moved to JS, see
  [search.ts](../src/utils/search.ts)). A JS-computed key gives a real uniqueness rule:
  `Food`, `food` and `FOOD ` are the same tag. Without it, users will create duplicates
  by accident, and the filter chips will show two "Food" tags.
- **`icon`**: chosen goal (§2).
- **`sort_order`**: chips must appear in a stable, user-chosen order, not alphabetical
  (the most used tag should come first).
- **`updated_at`**: every other table has one, and `getDataFingerprint` relies on
  `MAX(updated_at)` to detect renames (see §7).

Foreign keys are enforced (`PRAGMA foreign_keys = ON`,
[database.ts:69](../src/db/database.ts#L69)), so deleting an item or a tag cleans
`item_tags` automatically. **Check this on web too**: the web SQLite worker has its own
workarounds in the migration path.

### 5.2 Types

In [database.ts](../src/db/database.ts):

```ts
export type Tag = {
  id: string;
  name: string;
  color: string;
  icon: string | null;
  sort_order: number;
};
```

The `Item` type ([database.ts:259](../src/db/database.ts#L259)) stays **unchanged**.
Tags travel next to items (`Map<itemId, Tag[]>`), not inside them, so the dozens of
places that build or spread an `Item` don't need touching.

### 5.3 Repository functions

New, in [repository.ts](../src/db/repository.ts):

| Function | Notes |
|---|---|
| `listTags(): Promise<Tag[]>` | `ORDER BY sort_order, name`. Small table: load once into the store. |
| `insertTag(name, color, icon)` | Computes `name_key`; on a unique-index conflict returns the existing tag instead of failing. |
| `updateTag(id, { name?, color?, icon? })` | Recomputes `name_key`; bumps `updated_at`. Conflict on rename = error shown to the user ("A tag with this name already exists"). |
| `deleteTag(id)` | Cascade removes links. |
| `reorderTags(ids: string[])` | One transaction. |
| `setItemTags(itemId, tagIds)` | Replace the set in one transaction (delete + insert). Simpler than add/remove pairs, and matches how the picker works. |
| `listItemTagsForZone(zoneId)` | `item_id, tag_id` rows for one zone. |
| `listItemTagsForLocation(locationId)` / `listAllItemTags()` | For search and the shopping list. |

**Never query tags per row** (N+1). One query per screen, grouped in JS.

Whether `setItemTags` should also bump the item's `updated_at`: see open questions (§14).

## 6. Store and loading

- `tags: Tag[]` in [useAppStore.ts](../src/store/useAppStore.ts), loaded at start-up
  and after every tag mutation (`loadTags`). The table is tiny.
- Per screen, an `item_id → tag_id[]` map built from one query, then resolved against
  the store's `tags` to get `Tag[]`.

> ⚠️ `ItemRow` is `React.memo` ([ItemRow.tsx:254](../src/components/ItemRow.tsx#L254))
> so one row's re-render doesn't cascade into every other row's swipeable and animated
> wrappers. Arrays passed as props must keep the same identity between renders, or
> memoisation breaks for every row at once. Memoise the map with `useMemo`, and reuse a
> module-level `EMPTY_TAGS` constant for untagged items.

## 7. Backup — the riskiest part

Five places must change **together**, or an export/import silently loses tags:

1. **`exportAllData`** ([repository.ts:579](../src/db/repository.ts#L579)): add `tags`
   and `item_tags` to the payload and to the `ExportedData` type.
2. **`importAllData`** ([repository.ts:593](../src/db/repository.ts#L593)):
   `DELETE FROM item_tags` then `DELETE FROM tags` in the purge transaction (before
   `items`, or rely on the cascade), then re-insert. Older backups don't have these keys:
   treat them as `[]`, never as an error. Sanitise `color` with `sanitizeHex`, recompute
   `name_key` (don't trust the file), normalise timestamps with `toSqliteTimestamp`.
   Drop `item_tags` rows whose item or tag isn't in the file.
3. **Import validation** in [settings.tsx](../app/settings.tsx) (around the
   `import_invalid_format` checks): accept the keys being absent; reject them only if
   present and not arrays.
4. **`getDataFingerprint`** ([repository.ts:537](../src/db/repository.ts#L537)): add
   `COUNT(*)` of `tags` and `item_tags` and `MAX(updated_at)` of `tags`. Without this,
   tagging items never triggers the backup reminder although data really changed.
   Note: adding fields changes the fingerprint format, so **every user gets one backup
   reminder after the update**. Acceptable, but expected.
5. **Import snapshots** ([importSnapshots.ts](../src/utils/importSnapshots.ts)): they
   store the output of `exportAllData`, so they include tags for free once (1) is done.
   Check that restoring a snapshot goes through the same `importAllData` path.

Compatibility:

- **New app, old backup**: no tags, works (point 2).
- **Old app, new backup**: the old app ignores unknown keys, so the import works but
  **tags are lost without warning**. See open questions (§14).

## 8. UI

### 8.1 Tag picker (add / edit item)

New `src/components/TagPicker.tsx`, used in
[AddItemDialog.tsx](../src/components/dialogs/AddItemDialog.tsx) and
[EditItemDialog.tsx](../src/components/dialogs/EditItemDialog.tsx).

- A wrapping row of Paper `Chip`s, one per tag, selectable (`selected`), with the tag's
  colour and icon.
- A last chip "+ New tag" opens an inline field: name, colour from `PRESET_COLORS`
  ([colors.ts](../src/utils/colors.ts)), optional icon.
- Typing a name that already exists (same `name_key`) selects the existing tag instead
  of creating a duplicate.
- With many tags (20+), the row becomes long: a "Show all" chip, or a small search
  field inside the picker.

### 8.2 Item rows: colour or icon

[ItemRow.tsx](../src/components/ItemRow.tsx), via the `description` slot
([ItemRow.tsx:172](../src/components/ItemRow.tsx#L172)), which is already a render
function when an expiration date is shown. Merge the two cases.

Options to choose from (§14):

- **A. Dots**: one small coloured dot (or icon) per tag, after the name. Very compact,
  needs a legend or a long-press to know which is which.
- **B. Mini chips**: tag name in a small coloured pill under the name. Readable, takes
  a line.
- **C. One left stripe**: the colour of the *first* tag as a thin bar on the left of
  the row. Very calm, shows one tag only.

Rules whatever the choice:

- **Never colour alone.** Colour-blind users and dark mode must still tell tags apart:
  icon, initial or name, plus an accessibility label (`accessibilityLabel="Tags: Food,
  Pantry"`).
- Text on a coloured background: use `getReadableTextColor`
  ([color.ts](../src/utils/color.ts)).
- Same rendering in [SearchResultRow.tsx](../src/components/SearchResultRow.tsx) and in
  the out-of-van screen ([out-of-van.tsx](../app/out-of-van.tsx)).

### 8.3 Search filter

In [search.tsx](../app/search.tsx):

- A row of tag chips above the results. Tapping one filters the results.
- **An empty query + a selected tag = list every item with that tag.** Today an empty
  query shows nothing; this is the "show me all the food" use case.
- Matching on tag names: search is now done in JS (`filterAndSortSearchResults` in
  [repository.ts](../src/db/repository.ts), `matchesSearch` in
  [search.ts](../src/utils/search.ts)), so typing `food` can also match items tagged
  `Food`: pass the item's tag names to `matchesSearch` next to name and notes. This
  replaces the SQL `OR EXISTS … LIKE` idea in ROADMAP step 3, which would not handle
  accents.
- Several tags selected: AND or OR? See §14.
- Should the selected tag filter be remembered between visits (`recentSearches` is
  already a preference)? See §14.

### 8.4 Zone list filter

Once ROADMAP step 1 exists (`ZoneListControls`), add a row of tag chips there too.
Without step 1, skip this for v1: zones are usually short enough.

### 8.5 Tag management (Settings)

A section in [settings.tsx](../app/settings.tsx): list of tags with the number of items
each, rename, recolour, change icon, reorder (drag or up/down), delete with
confirmation ("12 items will lose this tag. The items are kept."). Creation stays in the
picker, and possibly here too.

### 8.6 Icons

`react-native-paper` already renders MaterialCommunityIcons by name (used for location
icons). Offer a **short curated list** (≈20: `food-apple`, `cup`, `tools`, `medical-bag`,
`tshirt-crew`, `battery-charging`, `water`, `gas-cylinder`, `broom`, `book-open`,
`bed`, `shoe-formal`, `umbrella`, `star`…) rather than the full set of thousands, which
needs a search UI of its own.

## 9. Shopping list

The least defined part. Several definitions are possible; pick one before coding (§14).

| Definition | Source data | Exists today? |
|---|---|---|
| Items with a chosen tag (e.g. `Food`) **and** expired / expiring soon | tags + `getExpirationStatus` ([expiration.ts](../src/utils/expiration.ts)) | yes, once tags exist |
| Items with a chosen tag **and** below their minimum quantity | tags + `quantity` / `min_quantity` | no, needs ROADMAP step 2 |
| Items of a chosen tag that are **unchecked** in a checklist zone | `checked`, `zone.checklist` | yes |
| Items manually added to the list ("add to shopping list" swipe) | new flag or new table | no |

Points to decide:

- **Overlap with ROADMAP step 2.6 (restock screen).** A "restock" screen and a "shopping
  list" are nearly the same thing. Building both would confuse users. Most likely: one
  screen, with tags as a filter and step 2's threshold as one more reason to appear.
- **Which tags feed the list**: one fixed tag, a per-tag "include in shopping list"
  switch (an extra `tags.in_shopping_list` column), or a filter chosen on the screen.
- **What happens when I've bought it**: tick it off (temporary state) or edit the item
  (new expiration date, quantity back up)? Ticking off needs its own stored state, or
  the list comes back unchanged next time.
- **Sharing**: a "Share" button (plain-text list via the share sheet) is cheap and very
  useful for shopping.
- **Where it lives**: a header icon like out-of-van in
  [_layout.tsx](../app/_layout.tsx), or a section in search.

## 10. Interaction with existing features

| Feature | Question / impact |
|---|---|
| **Season** (`summer` / `winter` / `none`) | It is already a fixed, built-in "tag". Keep it separate (it drives the season changeover dialog and filters), or turn it into two system tags later? Recommendation: keep it separate in v1. |
| **Checklist zones** | Tags show on checklist items too. The 1 s linger before an item drops under "Completed" must still work. |
| **Out of van** | Show tags on that screen too (§8.2). |
| **Expiration reminders** ([reminders.ts](../src/notifications/reminders.ts)) | Could group notifications by tag ("3 food items expire this week"). Not v1. |
| **Moving an item to another zone or location** | Tags follow the item (they're linked by `item_id`). Nothing to do; test it. |
| **Splitting / deleting a zone** | Items keep their ids, so tags survive a split. Deleting a zone deletes its items and, by cascade, their links. |
| **Multi-location** | Tags are **global** (shared by all locations) in this design. See §14. |
| **Sync (ROADMAP step 4)** | Merging two devices must merge tags by id, and handle the same name created on both sides (two ids, one `name_key`): merge them into one. |
| **Undo/redo** (zone editing) | Not involved: it only covers geometry. |

## 11. i18n

About 20 keys × 5 languages (de, en, es, fr, it), strict parity:

`tag.title`, `tag.new`, `tag.name`, `tag.color`, `tag.icon`, `tag.none`,
`tag.duplicate_name`, `tag.delete_title`, `tag.delete_confirm` (with `{{count}}`),
`tag.show_all`, `tag.items_count`, `search.filter_by_tag`, `search.tag_only_results`,
`settings.title_tags`, `settings.tags_empty`, `shopping.title`, `shopping.empty`,
`shopping.share`, `shopping.reason_expired`, `shopping.reason_expiring`,
`item.tags_accessibility` (with `{{tags}}`).

If default tags are offered (§14), their names are **data, not UI text**: created once
in the user's language and never re-translated, like zone names from templates
([templates.ts](../src/db/templates.ts)).

## 12. Edge cases

- Tag name empty or only spaces → refused (trim first).
- Very long tag name → limit (e.g. 24 characters) and ellipsis in chips.
- Same name with different case or accents (`Café` / `cafe`) → same tag (`name_key`).
- Rename to an existing name → refused with a message (or offer to merge the two tags:
  §14).
- Item with many tags (10+) on a row → show the first N and "+3".
- Tag colour invalid in a backup → `sanitizeHex` fallback.
- Icon name unknown (removed in a future icon-set version) → render without icon.
- Deleting the last tag while a search filter uses it → clear the filter.
- 600+ items, 30+ tags → one query per screen, memoised map; check scrolling (§15).
- Import of a backup whose `item_tags` point to missing items → rows dropped.

## 13. Phasing

Each phase can ship on its own.

1. **Data + backup + picker.** Tables, types, repository, store, backup (all five
   points of §7), `TagPicker` in both item dialogs, tag management in Settings.
   Tags exist and survive export/import, but are only visible in the item dialog.
2. **Display + search.** Tags on item rows (search, zone, out of van), tag filter chips
   in search, tag names matched by the text query, empty query + tag = list all.
3. **Shopping list.** After the §9 decisions, and ideally together with ROADMAP step 2.
4. **(Optional) Prefix conversion.** A one-off tool in Settings: detect repeated name
   prefixes before `:` or `-` (e.g. `FOOD: …` on 40 items), show a preview
   ("40 items → tag *Food*, names without the prefix"), apply on confirmation, and take
   an import snapshot first so it can be undone. Never automatic, never silent.

## 14. Questions to answer before implementing

### Product

1. **Global or per-location tags?** Global is simpler and matches "show me all the food
   everywhere". Per-location only matters if locations are very different (van vs.
   house).
2. **Default tags at first launch?** (e.g. Food, Clothes, Toiletries, Tools, Documents,
   Electronics.) It helps new users and makes the feature visible, but some users will
   delete them all. Offer them only for empty inventories?
3. **Maximum number of tags per item?** None, or a soft limit for display (§12)?
4. **Can a tag be merged into another** (two tags → one)? Useful after imports or sync.
5. **Should the prefix conversion (phase 4) be done at all?** Without it, early users
   tag everything by hand.
6. **Season: stays separate, or becomes system tags?** (§10)

### Display

7. **Which row style: dots, mini chips, or left stripe?** (§8.2) Make a quick mock-up
   of all three with real-looking data before deciding.
8. **Colour, icon, or both** as the main signal on a row?
9. **Order of tags on a row**: tag `sort_order`, alphabetical, or the order they were
   added to the item?

### Search and filters

10. **Several tags selected: AND or OR?** AND ("food *and* pantry") narrows; OR ("food
    *or* drinks") widens. Most apps use OR between tags; pick one and show it.
11. **Should the tag filter be remembered** between visits to search?
12. **Should typing a tag name in the text field also find tagged items** (§8.3), or
    only the chips?

### Shopping list

13. **Which definition** (§9 table)? Possibly several reasons combined.
14. **One screen with the restock screen of ROADMAP step 2, or two?**
15. **Which tags feed the list** (one fixed tag, a per-tag switch, a choice on screen)?
16. **What does "bought" mean**: a temporary tick, or editing the item?
17. **Share as text**: needed in v1?

### Data and backup

18. **Does changing an item's tags bump the item's `updated_at`?** Yes keeps "recently
    modified" sorting (ROADMAP step 1) and sync (step 4) honest; but it's an extra write.
    Recommendation: yes.
19. **Old app opening a new backup loses tags silently.** Acceptable? Or add a
    `backupFormat` number to `ExportedData` so older versions can warn ("this backup was
    made with a newer version")? This would help every future feature, not just tags.
20. **Tag colours: free hex, or presets only?** Presets keep the plan readable and
    contrast safe; free hex matches what zones allow today.

## 15. Verification

The project has no test suite; type-checking is the only automated guard.

1. `npx tsc --noEmit` green.
2. **Migration on an existing database**: run on a device **without deleting the app**,
   with real data. The app opens, no item lost, no tags.
3. **Backup round-trip**: import a backup made *before* tags → works, no tags. Tag some
   items, export, wipe, import → same tags on the same items.
4. **Backup reminder**: tag an item, relaunch → the reminder fires (fingerprint, §7.4).
5. **Import snapshot**: import a file, then restore the snapshot → tags of the original
   data are back.
6. **Duplicates**: create `Food`, then `food ` and `Fóod` → no second tag.
7. **Cascade**: delete a tagged item → its links are gone; delete a tag → items remain.
8. **Web**: `npm run web`, same checks (web SQLite worker).
9. **Performance**: a zone with ~200 tagged items scrolls smoothly; search over ~650
   items with a tag filter feels instant.
10. **Checklist regression**: in a checklist zone, ticking a tagged item still lingers
    1 s before dropping under "Completed".
11. **Dark mode and colour blindness**: tags still distinguishable (icon/name, not
    colour only).
12. **Five languages**: every new key present in de, en, es, fr, it.

## 16. Files touched

| File | Change |
|---|---|
| [src/db/schema.ts](../src/db/schema.ts) | `tags`, `item_tags`, indexes |
| [src/db/database.ts](../src/db/database.ts) | `Tag` type |
| [src/db/repository.ts](../src/db/repository.ts) | tag CRUD, `setItemTags`, per-screen tag queries, export/import, fingerprint, search matching on tag names |
| [src/store/useAppStore.ts](../src/store/useAppStore.ts) | `tags`, `loadTags`, tag actions |
| [src/utils/search.ts](../src/utils/search.ts) | reuse `normalizeForSearch` for `name_key` |
| [app/settings.tsx](../app/settings.tsx) | tag management, import validation |
| [app/search.tsx](../app/search.tsx) | tag filter chips, empty query + tag |
| [app/zone/[id].tsx](../app/zone/%5Bid%5D.tsx) | load tag map, pass to rows |
| [app/out-of-van.tsx](../app/out-of-van.tsx) | show tags |
| [src/components/ItemRow.tsx](../src/components/ItemRow.tsx) · [SearchResultRow.tsx](../src/components/SearchResultRow.tsx) | tag display |
| [AddItemDialog.tsx](../src/components/dialogs/AddItemDialog.tsx) · [EditItemDialog.tsx](../src/components/dialogs/EditItemDialog.tsx) | `TagPicker` |
| [src/locales/*.json](../src/locales/) (×5) | ~20 keys |
| New | `src/components/TagPicker.tsx`, `src/components/TagDots.tsx` (or chips), shopping list screen (phase 3) |

No native rebuild needed: everything is JavaScript and SQLite.
