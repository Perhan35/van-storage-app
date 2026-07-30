# Roadmap — My Inventory

Candidate features beyond v0.9.3, with the design decisions and constraints behind each.
Steps 1–3 build on each other; steps 4–6 are independent.

_Written 2026-07-30, codebase at `292a710` (v0.9.3)._

## Why these

The app is mature — multi-location plans, editable SVG outlines, zones, items with
season / expiration / out-of-van state, checklists, search, JSON backup, local
notifications, five languages. What's missing is visible in the data model:

| Gap | Consequence |
|---|---|
| No sorting or filtering in a zone | `listItemsForZone` always returns `ORDER BY checked ASC, name COLLATE NOCASE`. Past a few dozen items the list is unusable. |
| No quantity | Four gas canisters are four identical rows, and nothing flags that you're running out. |
| One classification axis only | A zone says *where*. Nothing says *what*. Tools scattered across four zones are unfindable except by text search. |
| Import replaces, never merges | Two phones in one household can't share an inventory — the last import destroys the other's work. |
| Deep links unused | Routing already works; nothing produces or consumes links. |
| No barcode input | Every item is typed by hand. |

Deliberately out of scope for now, not rejected: photos, weight & payload budget,
packing lists, statistics, PDF export, loan tracking, activity log.

---

## Step 1 — Sorting & filtering in the zone detail

**No migration.** The list is already fully in memory in `items`
([zone/[id].tsx:89](../app/zone/%5Bid%5D.tsx#L89)).

### 1.1 Expose `created_at` / `updated_at`

Both columns exist in the database and `SELECT *` already returns them, but the `Item`
type ([database.ts:243](../src/db/database.ts#L243)) doesn't declare them. Adding them
to the type is enough — no SQL change — and unlocks "recently added" sorting.

### 1.2 Control bar

New `src/components/ZoneListControls.tsx`, between the header and the `FlatList`, using
the existing Paper vocabulary (`Menu` + `Chip`):

- **Sort** (`sort` button → `Menu`): `default` (current order) · `name` · `recent`
  (`created_at DESC`) · `expiration` (nulls last) · `season`.
- **Filters** (selectable `Chip` row): season (summer/winter/none) · out-of-van ·
  expired/expiring soon.

### 1.3 Wiring in `zone/[id].tsx`

- Filter **before** the existing `sortedItems` memo
  ([zone/[id].tsx:143](../app/zone/%5Bid%5D.tsx#L143)).
- Sorting applies **within** the existing checklist partition — checked items stay at
  the bottom under the "Completed" divider. Don't break this: `isDone` and the 1 s
  linger (`MOVE_DELAY_MS`) must keep working.
- Compare expirations with `getExpirationStatus`
  ([src/utils/expiration.ts](../src/utils/expiration.ts)), already used by `ItemRow`.
- Distinct empty state when a filter hides everything (≠ `zone.empty`).

### 1.4 Persistence

- **Sort is persisted** (global `zoneSort` preference via
  [src/db/preferences.ts](../src/db/preferences.ts), loaded into the store like
  `themeMode` / `seasonMode`) — it's a taste, not a gesture.
- **Filters are transient**, reset on leaving the screen. A filter is a momentary act,
  and a persisted one that silently hides items is a confusion generator.

### 1.5 i18n

~12 flat keys across all **five** `src/locales/{en,fr,de,es,it}.json` files
(`zone.sort_*`, `zone.filter_*`, `zone.no_match`). Key parity is strict — 257 keys per
file today, identical sets.

---

## Step 2 — Quantity & restock threshold

### 2.1 Migration

Two entries in `ITEM_COLUMNS_TO_ADD` ([schema.ts:40](../src/db/schema.ts#L40)) — the
`PRAGMA table_info` mechanism already handles conditional adds:

```
quantity      INTEGER NOT NULL DEFAULT 1
min_quantity  INTEGER               -- NULL = no restock tracking
```

Plus one entry in `POST_COLUMN_INDEXES`: `idx_items_restock ON items(min_quantity)`.

`Item` type: `quantity: number; min_quantity: number | null`.

### 2.2 Prerequisite refactor: object payload

`insertItem` and `updateItem` ([repository.ts:103](../src/db/repository.ts#L103),
[:126](../src/db/repository.ts#L126)) already take **seven positional parameters**,
forwarded unchanged through `useAppStore.addItem` / `updateItem`
([useAppStore.ts:828](../src/store/useAppStore.ts#L828)) and the `onSave` callbacks of
both item dialogs. Adding two more makes call sites unreadable and argument-order
mistakes undetectable.

Introduce a single type in `database.ts`:

```ts
export type ItemInput = {
  name: string; notes: string; season: Season;
  expirationDate: string | null; reminderDays: number;
  quantity: number; minQuantity: number | null;
};
```

Then convert `insertItem(id, zoneId, input)` / `updateItem(id, input)`, the store chain,
and both dialogs' `onSave`. Call sites to update:
[zone/[id].tsx](../app/zone/%5Bid%5D.tsx) (`handleCreateItem`, `handleSaveEdit`),
[search.tsx](../app/search.tsx), [out-of-van.tsx](../app/out-of-van.tsx).

Doing this *first* turns `tsc` into the tool that finds every forgotten call site.

### 2.3 Backup

- `exportAllData` uses `SELECT *` → **nothing to do**.
- `importAllData` ([repository.ts:636](../src/db/repository.ts#L636)): add both columns
  to the INSERT with defaults `(item.quantity as number) ?? 1` and
  `(item.min_quantity as number) ?? null`, following the existing `reminder_days`
  pattern. Older backups stay importable.

### 2.4 UI

- New `src/components/QuantityField.tsx`: `−` / field / `+` stepper (Paper `IconButton`
  + `TextInput`), shared by both dialogs, modelled on
  [ExpirationField.tsx](../src/components/ExpirationField.tsx).
- An "alert me below" checkbox reveals the `min_quantity` field — hidden by default so
  the form doesn't grow for the common case.
- `ItemRow`: `×3` badge in the `right` slot, **hidden when `quantity === 1`** (most
  items), keeping the list clean.

### 2.5 Decision: `item_count` stays a `COUNT(*)`

`queryZonesWithCounts` ([repository.ts:71](../src/db/repository.ts#L71)) counts rows,
not quantities. **Do not switch to `SUM(quantity)`**: the map badge and header counter
mean "how many distinct things are stored here", and the hidden game's
`game.question_quantity` ([src/game/questions.ts](../src/game/questions.ts)) asks a
question whose answer would stop being verifiable by eye.

### 2.6 Restock screen

- `listRestockItems()` in `repository.ts`: `WHERE min_quantity IS NOT NULL AND
  quantity <= min_quantity`, with the same zone+location join as
  `OUT_OF_VAN_ITEM_QUERY` ([repository.ts:238](../src/db/repository.ts#L238)). Global
  and location-scoped variants, like out-of-van.
- New `app/restock.tsx`, modelled on [out-of-van.tsx](../app/out-of-van.tsx): same
  location/zone filters, reuses `OutOfVanRow` (slightly generalised) and the
  `/zone/[id]?highlightItemId=` "locate" navigation.
- **Entry point**: `HeaderRight` in [_layout.tsx](../app/_layout.tsx) already carries
  four icons. Add a `cart-outline` icon **conditionally**, shown only when the restock
  list is non-empty (derived counter in the store), so the header doesn't grow
  permanently.

### 2.7 i18n

~10 keys × 5 languages (`zone.quantity`, `zone.min_quantity`, `zone.restock_alert`,
`nav.restock`, `restock.empty`, …).

---

## Step 3 — Cross-cutting tags

### 3.1 Migration

Two tables appended to `MIGRATIONS` ([schema.ts:1](../src/db/schema.ts#L1)) — the array
is replayed on every launch, so `IF NOT EXISTS` makes appending safe:

```sql
CREATE TABLE IF NOT EXISTS tags (
  id TEXT PRIMARY KEY, name TEXT NOT NULL, color TEXT NOT NULL,
  created_at TEXT DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS item_tags (
  item_id TEXT NOT NULL REFERENCES items(id) ON DELETE CASCADE,
  tag_id  TEXT NOT NULL REFERENCES tags(id)  ON DELETE CASCADE,
  PRIMARY KEY (item_id, tag_id)
);
CREATE INDEX IF NOT EXISTS idx_item_tags_tag ON item_tags(tag_id);
```

Foreign keys are enforced (`PRAGMA foreign_keys = ON`,
[database.ts:69](../src/db/database.ts#L69)), so deleting an item or a tag cleans the
join table automatically.

### 3.2 Loading — avoid the N+1

**Never** query tags per row. One query per screen:

```ts
listTagsForZone(zoneId): Promise<{ item_id: string; id: string; name: string; color: string }[]>
```

grouped in JS into a `Map<itemId, Tag[]>`. The `Item` type stays untouched;
`zone/[id].tsx` holds a separate `tagsByItem` state and passes `tags: Tag[]` to
`ItemRow`.

> ⚠️ `ItemRow` is `React.memo` ([ItemRow.tsx:254](../src/components/ItemRow.tsx#L254))
> specifically so one row's re-render doesn't cascade into every other row's swipeable
> and animated wrappers. Arrays passed as props must keep referential identity between
> renders, or memoization breaks for every row at once. Memoize the map and reuse a
> module-level `EMPTY_TAGS` constant for untagged items.

### 3.3 Backup — the riskiest part

Four places must change **together**, or an export/import silently loses tags:

1. `exportAllData` ([repository.ts:568](../src/db/repository.ts#L568)) — add `tags` and
   `item_tags` to the payload and to the `ExportedData` type.
2. `importAllData` — `DELETE FROM item_tags` / `DELETE FROM tags` in the purge
   transaction, then re-insert. Older backups lack these keys → treat as `[]`, never as
   an error.
3. Import validation in [settings.tsx](../app/settings.tsx) must accept their absence.
4. `getDataFingerprint` ([repository.ts:526](../src/db/repository.ts#L526)) — include
   `COUNT(*)` over `tags` and `item_tags`. Without this, tagging items never triggers
   the backup reminder even though data genuinely changed.

### 3.4 UI

- `src/components/TagPicker.tsx`: selectable chips + inline creation (name + colour from
  `PRESET_COLORS` in [src/utils/colors.ts](../src/utils/colors.ts)), embedded in both
  item dialogs.
- `ItemRow`: compact `Chip` row under the title, via the `description` slot (already a
  render function when an expiration is present — merge the two cases).
- **Filter by tag**: an extra row in step 1's `ZoneListControls`.
- **Tag management**: a Settings section (rename / recolour / delete); creation stays in
  the picker.
- **Search**: extend `SEARCH_ITEM_QUERY`
  ([repository.ts:159](../src/db/repository.ts#L159)) with
  `OR EXISTS (SELECT 1 FROM item_tags it JOIN tags tg ON tg.id = it.tag_id
  WHERE it.item_id = i.id AND tg.name LIKE ?1 …)` so an item can be found by its tag.

### 3.5 i18n

~12 keys × 5 languages (`tag.title`, `tag.new`, `tag.name`, `tag.delete_confirm`,
`zone.filter_tag`, `settings.title_tags`, …).

---

## Step 4 — Device-to-device sync

### 4.1 The problem, precisely

The current import ([repository.ts:582](../src/db/repository.ts#L582)) is not a merge:
it runs `DELETE FROM items / zones / locations / preferences` and replays the file.
That is correct for a **restore** and wrong for **sharing** — if two people each add
items on their own phone, the first import destroys the other's work. It is the only
operation in the app that can lose data silently.

### 4.2 What the schema already supports, and the one blocker

Three things work in our favour:

- **`updated_at` exists on all three tables** and is maintained by every mutation
  (`updated_at = datetime('now')` throughout `repository.ts`). That's half of a
  last-writer-wins merge already done.
- **IDs are client-generated** — `Date.now().toString(36) +
  Math.random().toString(36).slice(2, 8)` ([database.ts:12](../src/db/database.ts#L12))
  — so two devices won't mint the same id. No id rewriting is needed during a merge,
  which removes the nastiest part of the problem.
- **Transport already exists**: `expo-sharing` + `expo-document-picker`.

One thing is missing, and it is blocking:

> ⚠️ **There are no tombstones.** A deleted row simply disappears. A merge therefore
> cannot distinguish "deleted on device A" from "not yet created on device A", and will
> always take the union — **resurrecting everything the other device deleted**. A
> deletion would never stick, which is worse than having no sync at all.

**Consequence for sequencing**: soft delete (`deleted_at TEXT NULL` on `locations`,
`zones` and `items`, filtered everywhere, purged after ~90 days) is not an optional
nicety — it is a **prerequisite for step 4**. It also earns its keep on its own:
deleting a zone today `CASCADE`s away all of its items with no way back.

### 4.3 Chosen approach: merge over a shared file, no backend

Split in two phases, and do **only phase A** for now.

**Phase A — "Merge" alongside "Restore"**

- Add `deleted_at` (prerequisite above) and switch deletions to soft delete.
- At import time, offer two explicit modes:
  - *Restore* — today's behaviour, unchanged (replaces everything).
  - *Merge* — row by row: `INSERT OR REPLACE` when the incoming row's `updated_at` is
    strictly newer than the local one, ignore otherwise; insert rows absent locally. A
    newer `deleted_at` beats an older edit.
- **Preferences are never merged** — theme, language and `activeLocationId` are
  device-local. Only `locations` / `zones` / `items` merge.
- The file travels through a shared iCloud Drive / Google Drive folder, using the
  existing document picker. No new dependency, no account, no server; the app stays
  fully local.
- Show a summary after merging ("12 added, 3 updated, 1 deleted") — a silent merge is
  unnerving.

**Phase B — automatic transport: not now**

Every option is expensive, and phase A should be validated in real use first:

- *Local network* (both phones on the van's wifi): no server, but no Expo module does
  mDNS discovery or server sockets — it needs native code and a dev client, ending
  standard Expo builds.
- *Backend* (Supabase / Firebase / CloudKit): the only true "it just works", but it
  breaks the local-only architecture and brings user accounts, hosting, a privacy
  policy, and offline reconciliation.

### 4.4 Accepted limitation

The merge is **row-level last-writer-wins**, arbitrated on `updated_at` — that is, on
each phone's clock. Two simultaneous edits of the *same* item lose the older one, and a
skewed clock corrupts the arbitration. For a two-person household that's a reasonable
trade-off; it just needs to be written down rather than discovered. Note also that
`datetime('now')` has **one-second granularity**: two writes within the same second are
indistinguishable — on a tie, keep the local row.

---

## Step 5 — Deep links & shortcuts

### 5.1 Correction: deep links already work

Contrary to what the initial audit suggested, there is **no** unused routing capability.
Verified:

- The scheme is registered natively on both platforms — `CFBundleURLTypes` in
  [ios/MyInventory/Info.plist](../ios/MyInventory/Info.plist) and an `intent-filter`
  with `android:scheme="my-inventory"` in
  [android/app/src/main/AndroidManifest.xml](../android/app/src/main/AndroidManifest.xml).
- **Expo Router builds its linking configuration automatically from the `app/` tree** —
  there is no handler to write.

So `my-inventory://zone/<id>`, `my-inventory://search` and `my-inventory://out-of-van`
**already open the right screen today**. The real work is elsewhere, and smaller than
advertised.

### 5.2 Latent bug: cross-location navigation lands on "zone not found"

**This bug exists independently of deep links** — it affects any navigation to a zone
outside the active location — and is worth fixing on its own merit.

**Cause.** `zone/[id].tsx` resolves the zone from the store's `zones`
([zone/[id].tsx:116](../app/zone/%5Bid%5D.tsx#L116)):

```ts
const zone = zones.find((z) => z.id === id);
```

but `zones` only ever holds the **active location's** zones — `loadZones` reads
`activeLocationId` ([useAppStore.ts:815](../src/store/useAppStore.ts#L815)). A zone
belonging to any other location is absent, so the screen renders `zone.not_found`.
[search.tsx](../app/search.tsx) works around this by switching location *before*
navigating ([search.tsx:122](../app/search.tsx#L122)); an external link has nobody to do
that for it.

**Fix.** No new query is needed. The store already holds `zonesByLocation` — every
location's zones, grouped — populated by `reloadZonesByLocation()` via
`listAllZonesWithCounts()` ([useAppStore.ts:426](../src/store/useAppStore.ts#L426)) and
kept in sync by `loadZones`. Crucially, `init()` awaits it *before* setting
`initialized: true` ([useAppStore.ts:361](../src/store/useAppStore.ts#L361) and
[:395](../src/store/useAppStore.ts#L395)), so `initialized === true` guarantees the map
is populated. In `zone/[id].tsx`:

```ts
const zone = zones.find((z) => z.id === id);

// A zone outside the active location (deep link, or any cross-location
// navigation) is absent from `zones` but present in zonesByLocation, which
// holds every location's zones — so its owner resolves without a DB round-trip.
const ownerLocationId = useMemo(() => {
  if (zone || !id) return null;
  for (const [locationId, locationZones] of Object.entries(zonesByLocation)) {
    if (locationZones.some((z) => z.id === id)) return locationId;
  }
  return null;
}, [zone, id, zonesByLocation]);

useEffect(() => {
  if (ownerLocationId) setActiveLocation(ownerLocationId);
}, [ownerLocationId, setActiveLocation]);
```

This cannot loop: once `setActiveLocation` resolves, `zones` contains the zone, `zone`
becomes truthy, `ownerLocationId` goes back to `null`, and the effect doesn't re-fire.
`setActiveLocation` also clears `overviewMode`, which is what a deep link should do —
backing out of the zone lands on that location's map rather than the overview grid.

**Rendering, three cases** — the current code collapses all three into "not found":

| Condition | Render |
|---|---|
| `!initialized` or `ownerLocationId` set | spinner (store hydrating, or switch in flight) |
| `zone` found | the screen |
| `initialized`, no `zone`, no owner | `zone.not_found` (genuinely deleted) |

The cold-start case matters: a deep link fires before `init()` completes, so without the
`initialized` guard the screen flashes "not found" before the data arrives.

### 5.3 Producing links

Nothing in the app offers "copy link" or "share". Add the action to the zone and item
context menus, using React Native's built-in `Share` (no new dependency) or
`expo-clipboard`.

### 5.4 Quick actions (long-press the app icon)

"Add item", "Search", "Expiring items". Needs `expo-quick-actions` (third-party, not
installed) plus a native rebuild. The actions navigate to routes that already exist.
**Low effort, real value** — the best return in this step.

### 5.5 Widgets: blocked on iOS by the project's signing

Worth explaining rather than attempting:

- An iOS widget is a **WidgetKit extension** — a separate Swift target that does not
  share the app's sandbox. To read the inventory it needs an **App Group**, and the App
  Group entitlement **requires a paid Apple Developer Program membership**. This project
  is signed with a free *Personal Team*: that is precisely why
  [plugins/withoutPushEntitlement.js](../plugins/withoutPushEntitlement.js) exists
  (a Personal Team can't sign the push entitlement) and why
  [ios/MyInventory/MyInventory.entitlements](../ios/MyInventory/MyInventory.entitlements)
  is empty. **The iOS widget is out of reach while the account stays free** — this is
  not a question of development effort.
- On Android it is feasible (`AppWidgetProvider` in Kotlin + a config plugin), but the
  widget runs in a separate process and would have to open the SQLite database itself.
  The saner path is for the app to write a small JSON snapshot ("3 expired items") that
  the widget only reads.

**Recommendation**: do 5.2, 5.3 and 5.4; **leave widgets aside** — asymmetric across
platforms, and blocked on iOS by an account constraint rather than by code.

---

## Step 6 — Barcode scanning

### 6.1 The shared building block

One package covers every use below: **`expo-camera`** (the old `expo-barcode-scanner`
was removed from recent SDKs). `CameraView` exposes `onBarcodeScanned` and
`barcodeScannerSettings={{ barcodeTypes: [...] }}`, reading both **EAN-13** (retail
products) and **QR codes**.

One-off entry cost:

- new native dependency → **rebuild** on iOS and Android;
- camera permission (`NSCameraUsageDescription` on iOS, declared in `app.json`);
- a reusable `src/components/BarcodeScanner.tsx` (full screen, permission-denied
  handling, `expo-haptics` on detection — already used throughout the app);
- **web won't follow**: plan the fallback, as `settings.tsx` already does for file
  import.

And one column: `items.barcode TEXT` (in `ITEM_COLUMNS_TO_ADD`) plus an
`idx_items_barcode` index.

> ⚠️ **Do not make it `UNIQUE`.** The same product can legitimately exist in two zones
> (tinned food in the rear locker *and* in the kitchen cupboard), so a barcode lookup
> must be able to return **several** results.

### 6.2 The six possible uses, most to least worthwhile

**A. Find an already-registered object** — *fully offline, the most useful*
Scan a tin, the app answers "Rear locker". It's the question the app exists to answer,
asked the other way round: instead of typing a name, you show the object to the app.
Reuses the existing `/zone/[id]?highlightItemId=` navigation.

**B. Bulk inventory** — *offline, large ergonomic win*
A "rapid scan" mode to fill a zone: scan → scan → scan without going through the form.
**Combines directly with step 2**: scanning an already-known barcode **increments the
quantity** instead of creating a duplicate. That's the natural gesture when stowing six
gas canisters.

**C. Fast take-out / put-back** — *offline*
Scanning toggles `out_of_van`, checkout-counter style. Useful when loading the van
before a trip, complementing the existing season changeover.

**D. QR labels on the physical storage** — *offline, and already half-built*
Stick a QR code on each real bin or cupboard; scanning it opens the matching zone. The
QR simply encodes `my-inventory://zone/<id>` — **the link that already works** (5.1).
This is the most elegant combination of the lot: step 5 provides the target, step 6 the
gesture. For *generating* QR codes, `react-native-qrcode-svg` builds on
`react-native-svg`, **already installed** — so no additional native dependency on the
generation side. If PDF export ever happens, a printable label sheet becomes trivial.

**E. Prefill a new item from Open Food Facts** — *see 6.3, recommended against*

**F. Expiration check on scan** — *offline, derived from A*
Scanning a product immediately shows its expiration status (`getExpirationStatus`,
already written). Marginal on its own, free once A exists.

### 6.3 Open Food Facts in detail

#### Feasibility — genuinely easy

- **Endpoint**: `GET https://world.openfoodfacts.org/api/v2/product/{barcode}.json`,
  narrowed with `?fields=product_name,brands,quantity,categories,image_url` to keep
  responses small.
- **No API key, no account, no quota registration** for reads. A plain `fetch` is
  enough — no SDK, no new dependency.
- **Identify the app in the `User-Agent`** (e.g. `MyInventory/1.0
  (contact@example.com)`); the project's usage policy asks for it and anonymous
  hammering can get blocked. Rate limits exist but sit far above what a scan-by-scan
  flow uses.
- **Licence: ODbL.** Free to use, including commercially, with attribution — an "Data
  from Open Food Facts" credit in the item form or in Settings covers it.
- Sister databases exist for non-food (Open Beauty Facts, Open Products Facts) but are
  far sparser.

Technically this is perhaps half a day of work. The cost is not technical.

#### Usefulness — weaker than it looks, for this app specifically

Four reservations, in order of weight:

1. **It would be the app's first network call.** Everything today is strictly local — no
   account, no server, no privacy policy to write, no offline mode to design because
   there is no online mode. Adding an outbound call means handling timeouts, failures,
   and a degraded path — and **in a van, offline is the nominal case, not the edge
   case**. The feature would be unavailable exactly where the app is used most.

2. **Coverage matches maybe half the contents.** Open Food Facts covers food and
   cosmetics. It does not cover tools, camping gear, spare parts, cables, or safety
   equipment — a large share of what a van actually holds. The scan would work for
   tinned food and fail for the toolbox, which is a frustrating kind of inconsistent.

3. **It cannot prefill the field that matters most.** Expiration dates are per-package,
   not per-product, so they are not in the database and never will be. For an app whose
   expiration tracking is a headline feature, the scan still leaves the most valuable
   field to be typed by hand.

4. **Crowdsourced data quality.** `product_name` is sometimes missing, sometimes in
   another language, sometimes a raw label transcription. The prefilled value often
   needs editing anyway — which is most of the typing the feature was meant to save.

The database's French roots make coverage good for European groceries, which is the one
point genuinely in its favour here.

#### Verdict

**Not now.** The architectural price — turning a local app into a connected one — is out
of proportion to the convenience gained on a fraction of the contents, with the field
that matters still typed by hand. Uses A, B and D deliver most of the value of barcode
scanning while staying entirely offline.

If it is ever added, the honest shape is: an **optional, opt-out setting**, disabled by
default, with the network call strictly limited to enriching a scan the user explicitly
requested, and a clean fallback to "unknown product, name it yourself" — never a
blocking spinner.

### 6.4 Recommendation

Do **A + B + D**: they share one building block, stay strictly offline, and build on two
steps already planned (step 2's quantity, step 5's deep links). C and F are near-free
additions once A exists. **Skip E** (see 6.3).

---

## Files touched

| File | Steps |
|---|---|
| [src/db/schema.ts](../src/db/schema.ts) | 2, 3, 4, 6 — columns (`quantity`, `deleted_at`, `barcode`), tag tables, indexes |
| [src/db/database.ts](../src/db/database.ts) | 1, 2, 3 — `Item`, `ItemInput`, `Tag` types |
| [src/db/repository.ts](../src/db/repository.ts) | 2, 3, 4, 6 — `ItemInput`, restock, tags, export/import, merge, fingerprint, `findItemsByBarcode` |
| [src/store/useAppStore.ts](../src/store/useAppStore.ts) | 1, 2, 3, 5 — `zoneSort` pref, `ItemInput`, tag actions, restock counter |
| [app/zone/[id].tsx](../app/zone/%5Bid%5D.tsx) | 1, 2, 3, 5 — filters, sorting, tags, cross-location resolution |
| [src/components/ItemRow.tsx](../src/components/ItemRow.tsx) | 2, 3 — quantity badge, tag chips |
| [AddItemDialog.tsx](../src/components/dialogs/AddItemDialog.tsx) · [EditItemDialog.tsx](../src/components/dialogs/EditItemDialog.tsx) | 2, 3, 6 |
| [app/_layout.tsx](../app/_layout.tsx) | 2, 5 — conditional restock icon, quick actions |
| [app/settings.tsx](../app/settings.tsx) | 3, 4 — tag management, import validation, Restore/Merge choice |
| [app.json](../app.json) | 5, 6 — `expo-camera` plugin, `NSCameraUsageDescription` |
| [src/locales/*.json](../src/locales/) (×5) | all — ~60 keys total, strict parity |
| New | `ZoneListControls.tsx`, `QuantityField.tsx`, `TagPicker.tsx`, `BarcodeScanner.tsx`, `app/restock.tsx`, `src/db/merge.ts` |

**Native rebuilds required**: step 5 (quick actions) and step 6 (camera). Steps 1–4 are
pure JavaScript and ship without rebuilding.

---

## Verification

The project has **no test suite** — verification is manual, and type-checking is the
only automated guard.

1. **Types**: `npx tsc --noEmit` must stay green after the `ItemInput` refactor, which
   exists precisely so the compiler catches missed call sites.
2. **Migration over an existing database** — the most important case. Run
   `npm run ios` (or `android`) **without deleting the app**, against a pre-existing
   database. Check that old items get `quantity = 1`, null `min_quantity`, no tags, and
   that the app opens normally. A failure here corrupts real user data.
3. **Backup round-trip**: export before the changes, then import that *old* backup
   afterwards → no crash, defaults applied. Then export/import again → quantities and
   tags preserved.
4. **Backup reminder**: add a tag, relaunch → the reminder must fire (validates the
   `getDataFingerprint` change in 3.3).
5. **Web**: `npm run web`. The migration path has web-specific workarounds (the SQLite
   worker crashes on duplicate `ALTER TABLE`) — new columns and tables must survive it.
6. **Checklist regression**: in a checklist zone, checking an item must still linger 1 s
   in place before dropping under "Completed", including with a sort and a filter
   active.
7. **Performance**: a zone with ~200 tagged items must scroll smoothly (confirms
   `ItemRow` memoization didn't break).
8. **Merge (step 4)** — the most delicate test, on **two devices** or two simulators:
   - add an item on A, another on B, merge both ways → both items survive on both;
   - edit *the same* item on both sides → the newer version wins and the loss is
     reported in the merge summary, never silent;
   - **delete an item on A, merge on B → it must stay deleted.** This is the test that
     validates tombstones; without them it reappears (see 4.2);
   - confirm B's theme and language are **not** overwritten by A's.
9. **Deep links (step 5)**: with the app closed, run
   `npx uri-scheme open "my-inventory://zone/<id>" --ios` (and `--android`) using an id
   belonging to a **non-active** location → it must switch location and open the zone,
   not show "zone not found". Repeat with a deleted id → "zone not found", no spinner
   left hanging.
10. **Scanning (step 6)**: deny camera permission on first launch → clear message and a
    way back, never a black screen. Then scan a code attached to two items in two zones
    → both results listed.
11. Bump the version in `package.json` **and** `app.json` (they must stay aligned).
