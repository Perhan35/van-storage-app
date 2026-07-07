# Code Audit — My Van Inventory

Full-scale review of architecture, security, code quality, and platform best practices.
Findings are sorted by priority. Each finding includes a ready-to-use AI prompt to fix it.

_Audit date: 2026-07-07 — codebase at commit `3a35e00` (v1.2.0)._

## Summary

| ID | Priority | Finding | Area |
|----|----------|---------|------|
| [C1](#c1-malformed-backup-import-can-permanently-brick-the-app) | 🔴 Critical | Malformed backup import can permanently brick the app | Data / Security |
| [C2](#c2-userinterfacestyle-light-silently-disables-auto-dark-mode) | 🔴 Critical | `userInterfaceStyle: "light"` silently disables auto dark mode | Config / Theming |
| [H1](#h1-init-failure-leaves-a-permanent-blank-screen-no-error-boundary) | 🟠 High | `init()` failure leaves a permanent blank screen; no error boundary | Startup / UX |
| [H2](#h2-splitzone-is-not-transactional) | 🟠 High | `splitZone` is not transactional | Data integrity |
| [H3](#h3-import-drops-fill_opacity-preferences-not-included-in-backup) | 🟠 High | Import drops `fill_opacity`; preferences not included in backup | Data / Backup |
| [H4](#h4-getdb-race-can-run-migrations-twice) | 🟠 High | `getDb()` race can run migrations twice | Concurrency |
| [M1](#m1-zones-can-be-dragged-off-canvas-and-become-unrecoverable) | 🟡 Medium | Zones can be dragged off-canvas and become unrecoverable | UX / Edit mode |
| [M2](#m2-empty-names-can-be-saved-for-items-and-zones) | 🟡 Medium | Empty names can be saved for items and zones | Validation |
| [M3](#m3-stale-highlight-timer-clears-a-newer-highlight) | 🟡 Medium | Stale highlight timer clears a newer highlight | State / Race |
| [M4](#m4-sql-like-wildcards-not-escaped-in-search) | 🟡 Medium | SQL LIKE wildcards not escaped in search | Search |
| [M5](#m5-gesturehandlerrootview-not-at-the-app-root) | 🟡 Medium | `GestureHandlerRootView` not at the app root | Architecture |
| [M6](#m6-routerback-after-search-breaks-under-deep-linking) | 🟡 Medium | `router.back()` after search breaks under deep linking | Navigation |
| [L1](#l1-export-success-alert-uses-the-import-title) | 🟢 Low | Export-success alert uses the "Import" title | Copy |
| [L2](#l2-double-tap-on-add-item-inserts-duplicates) | 🟢 Low | Double-tap on "add item" inserts duplicates | UX |
| [L3](#l3-import-shows-raw-sqlite-error-when-an-items-zone-is-missing) | 🟢 Low | Import shows raw SQLite error when an item's zone is missing | Validation / UX |
| [L4](#l4-zoom-doesnt-pinch-around-the-focal-point-pan-has-no-bounds) | 🟢 Low | Zoom doesn't pinch around the focal point; pan has no bounds | UX / Gestures |
| [L5](#l5-zustand-store-doubles-as-a-data-access-layer) | 🟢 Low | Zustand store doubles as a data-access layer | Architecture |

---

## 🔴 Critical

### C1. Malformed backup import can permanently brick the app

**Files:** [app/settings.tsx](app/settings.tsx#L100-L104), [src/store/useAppStore.ts](src/store/useAppStore.ts#L70-L73)

The import validator only checks that `zone.geometry` is a *string* — never that it's parseable JSON with the right shape. The string is written to the DB verbatim, and `loadZones()` runs an unguarded `JSON.parse` over every row. A backup file containing `"geometry": "hello"` passes validation, imports successfully, and then **every subsequent launch throws inside `loadZones()`** — zones never load and the app boots to a blank screen until reinstalled. This is a persistent denial-of-service via a user-supplied file, and a hand-edited or truncated backup is a realistic scenario for the target audience. Even without import, a single corrupt row kills *all* zones because the throw escapes the whole `.map()`.

**AI fix prompt:**

> In the Expo/React Native app at the repo root, fix a data-corruption bug that can permanently blank the app:
>
> 1. In `app/settings.tsx`, inside `importData`, extend the zone validation (`isValidZone`) so `geometry` must be a string that parses as JSON to an object of shape `{ type: "rect", x, y, w, h }` where `x`, `y`, `w`, `h` all satisfy `Number.isFinite`. Reject the whole file with the existing `settings.import_invalid_format` alert if any zone fails.
> 2. In `src/store/useAppStore.ts`, make `loadZones` defensive: replace the `rows.map(...)` that does `JSON.parse(r.geometry)` with a `flatMap` that wraps the parse in try/catch, additionally validates the parsed shape (same rules as above), skips invalid rows with a `console.warn` including the zone id, and never throws. One corrupt row must not prevent the remaining zones from loading.
> 3. Keep the `Zone["geometry"]` type unchanged. Do not change the DB schema.
>
> Verify with `npx tsc --noEmit`, and manually reason through: importing a backup where one zone has `"geometry": "not-json"` must show the invalid-format alert; a pre-existing corrupt row in the DB must load all other zones normally.

### C2. `userInterfaceStyle: "light"` silently disables auto dark mode

**File:** [app.json](app.json#L8)

`"userInterfaceStyle": "light"` locks the OS-reported appearance to light, so `useColorScheme()` in `src/theme/useAppTheme.ts` always returns `"light"`. The **"Auto" theme mode built in commit `3a35e00` can therefore never resolve to dark**. Manual "Dark" still works because it bypasses the OS value — which is why this is easy to miss in testing.

**AI fix prompt:**

> In `app.json` of this Expo app, change `expo.userInterfaceStyle` from `"light"` to `"automatic"` so `useColorScheme()` reflects the real system theme (required for the "auto" theme mode in `src/theme/useAppTheme.ts` to work). Then audit the consequences of the OS now being allowed to report dark:
>
> 1. Check the splash screen config (`expo.splash`) — background is `#ffffff`; optionally add a dark variant if supported by the installed Expo SDK.
> 2. Check `app/_layout.tsx` where `<StatusBar style="light" />` is hardcoded — confirm it's still correct in both themes given the header is always a dark blue (`palette.headerBackground`), and leave a brief note in the PR/commit message rather than a code comment.
> 3. Confirm no other code assumes light-only OS appearance.
>
> Native config changed, so note that a new dev build / EAS build is needed for the change to take effect (Expo Go picks it up on reload).

---

## 🟠 High

### H1. `init()` failure leaves a permanent blank screen; no error boundary

**Files:** [app/_layout.tsx](app/_layout.tsx#L63-L65), [src/store/useAppStore.ts](src/store/useAppStore.ts#L45-L54), [app/index.tsx](app/index.tsx#L31-L33)

`init()` is called fire-and-forget with no `.catch`. If `getDb()` or `loadZones()` rejects (migration failure, corrupt DB — see C1), the rejection is swallowed, `initialized` stays `false`, and the index screen renders an empty `View` forever: no message, no retry. There is also no `ErrorBoundary` export in the root layout, so any render error is a white screen.

**AI fix prompt:**

> In this Expo Router app, make startup failures visible and recoverable:
>
> 1. In `src/store/useAppStore.ts`, add an `initError: string | null` field to the store. Wrap the body of `init()` in try/catch; on failure set `initError` to the error message and leave `initialized` false. Allow `init()` to be re-run after a failure (reset `initError` at the start).
> 2. In `app/index.tsx`, when `initError` is set, render a centered error message plus a "Retry" `Button` (react-native-paper) that calls `init()` again, instead of the current blank `View`. Add i18n keys for the message and button in both `en` and `fr` in `src/i18n.ts`, following the existing key naming style.
> 3. In `app/_layout.tsx`, export an `ErrorBoundary` component (expo-router supports `export function ErrorBoundary({ error, retry })`) rendering the error message and a retry button, styled minimally with the palette from `src/theme/useAppTheme.ts`.
>
> Verify with `npx tsc --noEmit` and by temporarily making `getDb()` throw to confirm the retry UI appears.

### H2. `splitZone` is not transactional

**File:** [src/store/useAppStore.ts](src/store/useAppStore.ts#L179-L230)

`splitZone` runs five sequential statements (insert zone A, insert zone B, move items, delete original) with no transaction. A crash or error midway leaves duplicated zones, unmoved items, or a half-deleted state. The import flow already uses `db.withTransactionAsync` — this should too.

**AI fix prompt:**

> In `src/store/useAppStore.ts`, refactor the `splitZone` action so all DB statements (the two zone INSERTs, the items UPDATE, and the original-zone DELETE) execute inside a single `db.withTransactionAsync(async () => { ... })` block, matching the pattern used in `app/settings.tsx` `importData`. The `SELECT MAX(sort_order)` read may stay outside or move inside — inside is safer. Keep the return value (`id1`) and the trailing `loadZones()` call unchanged. If the transaction throws, let the error propagate as it does today. Verify with `npx tsc --noEmit`.

### H3. Import drops `fill_opacity`; preferences not included in backup

**File:** [app/settings.tsx](app/settings.tsx#L124-L152)

Export uses `SELECT *`, so `fill_opacity` (and `out_of_van`) are in the backup file — but the import `INSERT` for zones omits `fill_opacity`, so every zone silently reverts to the 0.4 default on restore. Backup/restore does not round-trip. The `preferences` table (theme choice) is also excluded from export entirely.

**AI fix prompt:**

> In `app/settings.tsx` of this Expo app, make backup/restore lossless:
>
> 1. In `importData`, include `fill_opacity` in the zones INSERT, defaulting to `0.4` when absent from the backup (older backups must still import). Validate it is a finite number between 0 and 1 when present; clamp or fall back to 0.4 otherwise.
> 2. In `handleExport`, also export the `preferences` table (key/value rows) as a `preferences` array in the JSON. In `importData`, restore it with `INSERT OR REPLACE` inside the existing transaction, treating the array as optional so old backups still import. After import, re-read the `themeMode` preference and apply it via the store's `setThemeMode`/state so the UI reflects the restored theme without a restart.
> 3. To prevent this class of bug recurring, consider building the INSERT column lists from an explicit whitelist array of column names shared between validation and INSERT construction — but keep it simple and readable.
>
> Verify with `npx tsc --noEmit` and reason through an export→import round trip: zone opacity and theme mode must survive.

### H4. `getDb()` race can run migrations twice

**File:** [src/db/database.ts](src/db/database.ts#L5-L14)

The module-level `db` variable is assigned only *after* `openDatabaseAsync` and all migrations complete. Two concurrent callers during startup both see `db === null`, both open the database, and both run migrations and seeding concurrently.

**AI fix prompt:**

> In `src/db/database.ts`, fix the initialization race in `getDb()`: instead of caching the `SQLiteDatabase` instance (which is only assigned after the async open/migrate completes), cache the *promise*. Concretely: keep a module-level `let dbPromise: Promise<SQLite.SQLiteDatabase> | null = null;`, move the current open/migrate/seed body into a private `async function openAndMigrate()`, and have `getDb()` do `if (!dbPromise) dbPromise = openAndMigrate(); return dbPromise;`. On rejection, reset `dbPromise` to `null` so a later call can retry (this pairs with the init-retry UI in finding H1). Keep the exported signature `getDb(): Promise<SQLite.SQLiteDatabase>` unchanged. Verify with `npx tsc --noEmit`.

---

## 🟡 Medium

### M1. Zones can be dragged off-canvas and become unrecoverable

**File:** [src/components/ZoneEditOverlay.tsx](src/components/ZoneEditOverlay.tsx#L62-L131)

Drag and resize gestures have no clamping to the 300×600 SVG viewBox. A zone dragged far off-screen takes its edit handles with it and becomes hard or impossible to recover from the UI.

**AI fix prompt:**

> In `src/components/ZoneEditOverlay.tsx`, clamp zone editing to the SVG canvas. The canvas is 300×600 SVG units (see `SVG_W`/`SVG_H` in `src/components/VanLayoutSVG.tsx` — export them or pass them as props rather than duplicating the constants). In the `onUpdate` worklets:
>
> - Drag gesture: clamp `svgX` to `[0, SVG_W - svgW.value]` and `svgY` to `[0, SVG_H - svgH.value]`.
> - Bottom-right resize: clamp width/height so `x + w <= SVG_W` and `y + h <= SVG_H`, keeping the existing `MIN_ZONE_SIZE_SVG` minimum.
> - Top-left resize: clamp so `x >= 0` and `y >= 0` while preserving the anchored bottom-right corner and the minimum size.
>
> These run as Reanimated worklets — keep the math worklet-safe (no JS-thread calls in `onUpdate`). Also clamp once in `commitGeometry` as a safety net for any pre-existing out-of-bounds rows. Verify with `npx tsc --noEmit`.

### M2. Empty names can be saved for items and zones

**Files:** [src/components/dialogs/EditItemDialog.tsx](src/components/dialogs/EditItemDialog.tsx#L25-L27), [src/components/dialogs/EditZoneDialog.tsx](src/components/dialogs/EditZoneDialog.tsx#L37-L39)

Both edit dialogs call `onSave(name.trim(), …)` with no emptiness check, so an item or zone can end up with an invisible blank name. `CreateZoneDialog` already guards against this — the edit dialogs should mirror it.

**AI fix prompt:**

> In `src/components/dialogs/EditItemDialog.tsx` and `src/components/dialogs/EditZoneDialog.tsx`, prevent saving an empty name: in each `handleSave`, compute `const trimmed = name.trim()` and return early if it's empty (mirroring the guard in `CreateZoneDialog.tsx`). Additionally disable the Save button (`disabled={!name.trim()}`) so the constraint is visible to the user. Do not add new i18n strings or error toasts — the disabled state is sufficient. Verify with `npx tsc --noEmit`.

### M3. Stale highlight timer clears a newer highlight

**Files:** [app/search.tsx](app/search.tsx#L37-L42), [app/out-of-van.tsx](app/out-of-van.tsx#L41-L45)

Both screens clear the zone highlight with a bare `setTimeout(() => setHighlightedZoneId(null), 4000)`. Locating item A and then item B within 4 seconds means A's timer clears B's highlight early. The timers also aren't cancelled on unmount.

**AI fix prompt:**

> In this app, zone highlighting is set via `setHighlightedZoneId` in `src/store/useAppStore.ts` and auto-cleared by bare 4-second `setTimeout`s in `app/search.tsx` (`handleItemPress`) and `app/out-of-van.tsx` (`handleLocate`), which race with each other. Centralize the auto-clear in the store:
>
> 1. In `useAppStore.ts`, add a module-level `let highlightTimer: ReturnType<typeof setTimeout> | null = null;`. Change `setHighlightedZoneId(zoneId)` so it always clears any pending timer first, sets the state, and — when `zoneId` is non-null — schedules a new 4-second timer that sets it back to `null`.
> 2. Remove the `setTimeout` calls from `app/search.tsx` and `app/out-of-van.tsx`, keeping only `setHighlightedZoneId(item.zone_id)` before navigation.
>
> Verify with `npx tsc --noEmit` and reason through: highlighting zone A then zone B within 4s must leave B highlighted for a full 4s.

### M4. SQL LIKE wildcards not escaped in search

**File:** [src/store/useAppStore.ts](src/store/useAppStore.ts#L119-L128)

The query is safely parameterized (no injection), but `%` and `_` typed by the user act as wildcards — searching for `%` matches every item.

**AI fix prompt:**

> In `src/store/useAppStore.ts`, in the `searchItems` action, escape SQL LIKE wildcards in the user query: before building the `%...%` pattern, transform the query with `query.replace(/[\\%_]/g, "\\$&")`, and append `ESCAPE '\'` to both LIKE clauses in the SQL (e.g. `i.name LIKE ?1 ESCAPE '\' COLLATE NOCASE`). Confirm expo-sqlite accepts the `ESCAPE` clause with the `?1` positional parameter as written. Verify with `npx tsc --noEmit` and reason through: searching `%` must match only items whose name/notes literally contain a percent sign.

### M5. `GestureHandlerRootView` not at the app root

**File:** [src/components/ZoomableContainer.tsx](src/components/ZoomableContainer.tsx#L79)

`GestureHandlerRootView` lives inside `ZoomableContainer`, so only the map screen is covered. Convention is one root view wrapping the whole app; adding a `GestureDetector` on any other screen will throw "GestureDetector must be used inside GestureHandlerRootView".

**AI fix prompt:**

> In this Expo Router app, move `GestureHandlerRootView` from `src/components/ZoomableContainer.tsx` to the root layout: in `app/_layout.tsx`, wrap the entire returned tree (outside `PaperProvider`) in `<GestureHandlerRootView style={{ flex: 1 }}>` imported from `react-native-gesture-handler`. In `ZoomableContainer.tsx`, replace the `GestureHandlerRootView` with a plain `View` (keep the same styles). Verify with `npx tsc --noEmit` and confirm the map's pinch/pan/double-tap gestures and the zone edit-mode drag/resize still work.

### M6. `router.back()` after search breaks under deep linking

**File:** [app/search.tsx](app/search.tsx#L37-L42)

`handleItemPress` calls `router.back()` assuming the map screen is underneath. If search is opened via deep link (`van-storage://search`), back pops out of the app instead of landing on the highlighted map.

**AI fix prompt:**

> In `app/search.tsx`, in `handleItemPress`, replace `router.back()` with a navigation call that reliably lands on the map screen (route `/`) even when the search screen was opened via deep link: use `router.dismissTo("/")` if available in the installed expo-router version (SDK 55 / expo-router ~55), otherwise `router.navigate("/")`. Check how `app/out-of-van.tsx` `handleLocate` handles the same situation (`router.replace("/")`) and make both screens consistent with whichever approach preserves a sensible back stack. Verify with `npx tsc --noEmit`.

---

## 🟢 Low

### L1. Export-success alert uses the "Import" title

**File:** [app/settings.tsx](app/settings.tsx#L66)

The fallback alert when sharing is unavailable shows `t("settings.import_confirm_title")` ("Import") as the title of an *export* success message.

**AI fix prompt:**

> In `app/settings.tsx` (`handleExport`, the branch where `Sharing.isAvailableAsync()` is false), the alert title wrongly reuses `settings.import_confirm_title`. Add a proper key `settings.export_success_title` to both `en` ("Export") and `fr` ("Export") in `src/i18n.ts`, following the existing naming style, and use it as the alert title. Verify with `npx tsc --noEmit`.

### L2. Double-tap on "add item" inserts duplicates

**File:** [app/zone/[id].tsx](app/zone/[id].tsx#L65-L71)

`handleAddItem` has no in-flight guard; a fast double-tap on the plus button (or submit + tap) inserts the item twice.

**AI fix prompt:**

> In `app/zone/[id].tsx`, add an in-flight guard to `handleAddItem`: introduce a `const [adding, setAdding] = useState(false)` state, return early when `adding` is true, set it true before the `await addItem(...)` and false in a `finally` block. Also pass `disabled={adding}` to the plus `IconButton`. Keep clearing the input and reloading items as today. Verify with `npx tsc --noEmit`.

### L3. Import shows raw SQLite error when an item's zone is missing

**File:** [app/settings.tsx](app/settings.tsx#L106-L114)

An imported item whose `zone_id` doesn't match any imported zone triggers a foreign-key failure. The transaction correctly rolls back, but the user sees a raw SQLite error message instead of a friendly explanation.

**AI fix prompt:**

> In `app/settings.tsx`, in `importData`, pre-validate referential integrity before starting the DB transaction: build a `Set` of imported zone ids and check every item's `zone_id` is in it. If any item references a missing zone, show the existing `settings.import_invalid_format` alert (or add a more specific i18n key in `en`/`fr` such as `settings.import_orphan_items` explaining that some items reference unknown zones) and abort without touching the database. Verify with `npx tsc --noEmit`.

### L4. Zoom doesn't pinch around the focal point; pan has no bounds

**File:** [src/components/ZoomableContainer.tsx](src/components/ZoomableContainer.tsx#L34-L68)

Pinch zoom scales around the view center rather than the fingers' focal point, and pan can push the content fully off-screen. The double-tap reset mitigates "zoom and get lost," but the interaction feels imprecise.

**AI fix prompt:**

> Improve the map zoom/pan UX in `src/components/ZoomableContainer.tsx` (react-native-gesture-handler v2 + Reanimated v4, all logic in worklets):
>
> 1. Focal-point pinch: on pinch start, record `e.focalX`/`e.focalY` and the current transform; during `onUpdate`, adjust `translateX/translateY` so the content point under the fingers stays under the fingers while scaling (standard focal-zoom math: measure the container size via `onLayout` or `measure` to convert between view and content coordinates).
> 2. Pan bounds: after every pan/pinch update, clamp `translateX/translateY` so at least ~25% of the content remains visible in the container.
> 3. Keep the existing `MIN_SCALE`/`MAX_SCALE` clamps, the `enabled` shared-value gating, and the double-tap reset.
>
> All gesture math must stay on the UI thread (no `runOnJS` in `onUpdate`). Verify with `npx tsc --noEmit` and manually test pinch on a device/simulator.

### L5. Zustand store doubles as a data-access layer

**File:** [src/store/useAppStore.ts](src/store/useAppStore.ts), [app/settings.tsx](app/settings.tsx#L47)

Several store "actions" (`getItemsForZone`, `searchItems`, `getOutOfVanItems`) are stateless async passthroughs to the DB, while `settings.tsx` bypasses the store and calls `getDb()` directly. The state/persistence boundary is blurry. Related: every mutation triggers a full `loadZones()` re-fetch, and screens keep local copies of DB data refreshed manually — fine at this scale, but the pattern to watch as the app grows.

**AI fix prompt:**

> Refactor the data layer of this Expo app for a cleaner state/persistence boundary, without changing behavior:
>
> 1. Create `src/db/repository.ts` and move all SQL currently living in `src/store/useAppStore.ts` (queries and mutations) plus the export/import queries from `app/settings.tsx` into named functions (`listZonesWithCounts`, `listItemsForZone`, `searchItems`, `insertItem`, `splitZone`, etc.), each taking plain parameters and using `getDb()` internally.
> 2. Slim `useAppStore.ts` down to state (`zones`, `highlightedZoneId`, `initialized`, `editMode`, `themeMode`) and actions that call repository functions and update state. Pure read passthroughs (`getItemsForZone`, `searchItems`, `getOutOfVanItems`) can be re-exported from the repository and imported directly by screens instead of going through the store.
> 3. Update `app/settings.tsx` to use the repository instead of raw `getDb()` calls.
> 4. Do not change any SQL semantics, i18n, or UI. Keep TypeScript types (`Zone`, `Item`, `ZoneWithCount`) in `src/db/database.ts` or move them to the repository — one home, updated imports everywhere.
>
> Verify with `npx tsc --noEmit` and a manual smoke test of: map load, zone open, add/edit/move/delete item, search, out-of-van, split zone, export/import.

---

## Not issues / accepted

- **Security posture:** fully offline app — no network layer, no credentials, no secrets. SQLite is unencrypted but the data (van inventory) doesn't warrant SQLCipher. Obfuscation and root/jailbreak detection are not warranted for this threat model.
- **SQL injection:** all queries are parameterized. ✅
- **Gestures/threading:** Reanimated shared values with `runOnJS` only on commit — correct pattern, no main-thread blocking found. ✅
- **iOS permissions:** document picker and share sheet are system UI; no `NSxxxUsageDescription` entries needed. ✅
