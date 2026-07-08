# Code Audit — My Van Inventory

Full-scale review of architecture, security, code quality, and platform best practices.
Findings are sorted by priority. Each finding includes a ready-to-use AI prompt to fix it.

_Audit date: 2026-07-07 — codebase at commit `3a35e00` (v1.2.0)._
_Re-review: 2026-07-08 — commits `3a35e00..9ad6a88` plus working tree. Fix status added to every finding; new findings N1–N8 below._

## Summary — original findings (2026-07-07)

| ID | Priority | Finding | Status |
|----|----------|---------|--------|
| [C1](#c1-malformed-backup-import-can-permanently-brick-the-app) | 🔴 Critical | Malformed backup import can permanently brick the app | ✅ Fixed (`548fe10`) |
| [C2](#c2-userinterfacestyle-light-silently-disables-auto-dark-mode) | 🔴 Critical | `userInterfaceStyle: "light"` silently disables auto dark mode | ✅ Fixed (`86c1fd4`) |
| [H1](#h1-init-failure-leaves-a-permanent-blank-screen-no-error-boundary) | 🟠 High | `init()` failure leaves a permanent blank screen; no error boundary | ✅ Fixed (`7f141dc`) — see [N5](#n5-errorboundary-ignores-theme-and-language-and-renders-paper-components-without-a-provider) |
| [H2](#h2-splitzone-is-not-transactional) | 🟠 High | `splitZone` is not transactional | ✅ Fixed via [N2](#n2-splitzoneindb-is-still-not-transactional-h2-not-actually-fixed) — now wrapped in `withTransactionAsync` |
| [H3](#h3-import-drops-fill_opacity-preferences-not-included-in-backup) | 🟠 High | Import drops `fill_opacity`; preferences not included in backup | ✅ Fixed (`361cbfc`) |
| [H4](#h4-getdb-race-can-run-migrations-twice) | 🟠 High | `getDb()` race can run migrations twice | ✅ Fixed (`786db7b`) |
| [M1](#m1-zones-can-be-dragged-off-canvas-and-become-unrecoverable) | 🟡 Medium | Zones can be dragged off-canvas and become unrecoverable | ✅ Fixed (`ba27412`) |
| [M2](#m2-empty-names-can-be-saved-for-items-and-zones) | 🟡 Medium | Empty names can be saved for items and zones | ✅ Fixed (`cf10ad4`) |
| [M3](#m3-stale-highlight-timer-clears-a-newer-highlight) | 🟡 Medium | Stale highlight timer clears a newer highlight | ✅ Fixed (`ba297bb`) |
| [M4](#m4-sql-like-wildcards-not-escaped-in-search) | 🟡 Medium | SQL LIKE wildcards not escaped in search | ✅ Fixed via [N1](#n1-search-is-completely-broken-escape-clause-collapses-to-an-empty-string) — ESCAPE clause corrected, search works again |
| [M5](#m5-gesturehandlerrootview-not-at-the-app-root) | 🟡 Medium | `GestureHandlerRootView` not at the app root | ✅ Fixed (`f46cb0a`) |
| [M6](#m6-routerback-after-search-breaks-under-deep-linking) | 🟡 Medium | `router.back()` after search breaks under deep linking | ✅ Fixed (`ad66059`) — `dismissTo` verified: falls back to push when the target isn't in the stack |
| [L1](#l1-export-success-alert-uses-the-import-title) | 🟢 Low | Export-success alert uses the "Import" title | ✅ Fixed (`e82ba68`) |
| [L2](#l2-double-tap-on-add-item-inserts-duplicates) | 🟢 Low | Double-tap on "add item" inserts duplicates | ✅ Fixed (`390dc2a`) |
| [L3](#l3-import-shows-raw-sqlite-error-when-an-items-zone-is-missing) | 🟢 Low | Import shows raw SQLite error when an item's zone is missing | ✅ Fixed (`136805b`) |
| [L4](#l4-zoom-doesnt-pinch-around-the-focal-point-pan-has-no-bounds) | 🟢 Low | Zoom doesn't pinch around the focal point; pan has no bounds | ✅ Fixed via [N4](#n4-pinch-and-pan-gestures-fight-over-translation-during-two-finger-gestures) — pinch/pan conflict resolved (device check pending) |
| [L5](#l5-zustand-store-doubles-as-a-data-access-layer) | 🟢 Low | Zustand store doubles as a data-access layer | ✅ Fixed (uncommitted `src/db/repository.ts` refactor) |

## Summary — new findings (2026-07-08 re-review)

| ID | Priority | Finding | Area | Status |
|----|----------|---------|------|--------|
| [N1](#n1-search-is-completely-broken-escape-clause-collapses-to-an-empty-string) | 🔴 Critical | Search is completely broken: ESCAPE clause collapses to an empty string | Search / Regression | ✅ Fixed |
| [N2](#n2-splitzoneindb-is-still-not-transactional-h2-not-actually-fixed) | 🟠 High | `splitZoneInDb` is still not transactional (H2 not actually fixed) | Data integrity | ✅ Fixed |
| [N3](#n3-search-retry-and-swallow-masks-deterministic-failures-as-no-results) | 🟠 High | Search retry-and-swallow masks deterministic failures as "no results" | Error handling | ✅ Fixed |
| [N4](#n4-pinch-and-pan-gestures-fight-over-translation-during-two-finger-gestures) | 🟡 Medium | Pinch and pan gestures fight over translation during two-finger gestures | UX / Gestures | ✅ Fixed (device check pending) |
| [N5](#n5-errorboundary-ignores-theme-and-language-and-renders-paper-components-without-a-provider) | 🟡 Medium | ErrorBoundary ignores theme and language, and renders Paper components without a provider | Startup / UX | ✅ Fixed |
| [N6](#n6-isvalidgeometry-is-duplicated-verbatim-in-settingstsx-and-repositoryts) | 🟢 Low | `isValidGeometry` is duplicated verbatim in settings.tsx and repository.ts | Reuse | ✅ Fixed |
| [N7](#n7-fill-opacity-sanitization-lives-in-the-ui-layer-and-is-passed-as-a-callback) | 🟢 Low | Fill-opacity sanitization lives in the UI layer and is passed as a callback | Architecture | ✅ Fixed |
| [N8](#n8-withdb-globally-serializes-all-db-access-and-is-a-nested-call-deadlock-footgun) | 🟢 Low | `withDb` globally serializes all DB access and is a nested-call deadlock footgun | Concurrency / Design | ⚠️ Made safe (queue kept) |

## Compatibility & release notes (v1.2.0 → next)

- **No breaking changes for existing users' data.** The SQLite schema is unchanged; updating the app requires no migration.
- **Backup files are compatible in both directions.** New exports add a `preferences` array; the old app version ignores it on import. Old backups (without `preferences` / `fill_opacity`) still import into the new version, with opacity defaulting to 0.4.
- **Import validation is stricter (intentional).** Backup files with malformed zone geometry or items referencing missing zones are now rejected with a clear message instead of importing corrupt data (or failing with a raw SQLite error). Tell users: a backup that "worked" before but was actually corrupt will now be refused.
- **Visible behavior change:** with `userInterfaceStyle: "automatic"`, users whose device is in dark mode will see the app switch to the dark theme after updating (theme setting defaults to "Auto"). They can force Light in Settings → Appearance.
- **A new native build is required** (EAS/dev build): `app.json` `userInterfaceStyle` and the `expo-sqlite` patch bump (55.0.15 → 55.0.17) are native-level changes; an OTA/JS-only update is not sufficient.
- **Search regression is fixed:** the broken `ESCAPE` clause ([N1](#n1-search-is-completely-broken-escape-clause-collapses-to-an-empty-string)) that made every search return "No item found" has been corrected. Confirm search on a device before release; the N4 gesture rework also still wants an on-device pinch/pan check.

---

# New findings (2026-07-08)

## 🔴 Critical

### N1. Search is completely broken: ESCAPE clause collapses to an empty string

**Status: ✅ Fixed** — the template literal now writes `ESCAPE '\\'`, so the SQL text is literally `ESCAPE '\'`. Verified empirically: the string contains a single backslash and `SELECT 'a%b' LIKE '%\%%' ESCAPE '\'` executes in sqlite3. The retry/swallow that masked it was removed (see N3).

**File:** [src/db/repository.ts](../src/db/repository.ts#L104) (`searchItems`); masked by [app/search.tsx](../app/search.tsx#L41)

The M4 fix added `ESCAPE '\'` to the LIKE clauses — but inside a JavaScript **template literal**, `\'` is an escape sequence that collapses to `'`. The SQL actually sent is `LIKE ?1 ESCAPE '' COLLATE NOCASE`. SQLite rejects an empty escape string on **every** execution (verified: `Error: ESCAPE expression must be a single character`). Every search therefore throws; the new retry-and-swallow in `search.tsx` retries the same broken SQL, fails again, logs a `console.warn`, and returns `[]` — so **every search silently shows "No item found"** on all platforms. This is a total regression of the search feature, and the swallow (N3) is why it wasn't noticed. Note the misleading comment in `search.tsx` blaming an "expo-sqlite web driver" issue — the real cause is this SQL.

**AI fix prompt:**

> In `src/db/repository.ts`, `searchItems` builds SQL in a template literal containing `ESCAPE '\'`. JavaScript collapses `\'` to `'`, so SQLite receives `ESCAPE ''` (empty escape string) and throws "ESCAPE expression must be a single character" on every search. Fix by writing the backslash as `\\` in the template literal so the SQL text is literally `ESCAPE '\'` — i.e. `` `... i.name LIKE ?1 ESCAPE '\\' COLLATE NOCASE OR i.notes LIKE ?1 ESCAPE '\\' COLLATE NOCASE ...` ``. Keep the existing `query.replace(/[\\%_]/g, "\\$&")` escaping of the user input — it is correct.
>
> Verify empirically, not just by reading: print the SQL string with `node -e` to confirm it contains a single backslash between the quotes, and run the query shape against `sqlite3 :memory:` (e.g. `SELECT 'x' LIKE '%x%' ESCAPE '\';`) to confirm it executes. Then remove the now-unjustified retry/swallow in `app/search.tsx` per finding N3, and manually confirm in the app that searching an existing item returns it and searching `%` returns only items literally containing `%`.

---

## 🟠 High

### N2. `splitZoneInDb` is still not transactional (H2 not actually fixed)

**Status: ✅ Fixed** — `splitZoneInDb`'s five statements now run inside a single `db.withTransactionAsync`. `insertZone`'s MAX+INSERT pair was wrapped too. Typecheck passes.

**File:** [src/db/repository.ts](../src/db/repository.ts#L169)

Original finding H2 asked for the split-zone sequence to run inside `db.withTransactionAsync`. The refactor moved the five statements from the store into `repository.splitZoneInDb`, but they still execute as bare sequential `runAsync` calls — only `importAllData` (line 238) got a transaction. The `withDb` queue serializes calls from *other* screens but provides **no atomicity**: a crash or error midway still leaves duplicated zones, unmoved items, or a half-deleted original zone. H2's failure scenario is unchanged.

**AI fix prompt:**

> In `src/db/repository.ts`, wrap the body of `splitZoneInDb` (the `SELECT MAX(sort_order)` read, the two zone INSERTs, the items UPDATE, and the original-zone DELETE) in a single `db.withTransactionAsync(async () => { ... })` block, exactly like `importAllData` in the same file. Keep the function signature and the `withDb` wrapper unchanged; let errors propagate. While there, do the same for `insertZone` (its MAX+INSERT pair is currently two separate statements). Verify with `npx tsc --noEmit` and a manual smoke test: split a zone with items and confirm two new zones appear, items land in the first, and the original is gone.

### N3. Search retry-and-swallow masks deterministic failures as "no results"

**Status: ✅ Fixed** — the retry and the misleading web-driver comment are gone. `runSearch` now has a single try/catch that, on error, warns, clears results, and sets a new `searchError` state; the screen renders a distinct `search.error` message (added in `en`/`fr`) instead of the no-results text. The debounce and `searchSeq` stale-guard are unchanged.

**File:** [app/search.tsx](../app/search.tsx#L41-L52) (`runSearch`)

`runSearch` wraps `searchItems` in an untyped catch, blindly retries the identical query once, then swallows the second failure into `r = []` with only a `console.warn` — and still sets `searched = true`. Any persistent failure (like N1's malformed SQL) is presented to the user as a normal "No item found for …" result. The accompanying comment attributes failures to a transient "expo-sqlite web driver" issue, which sends future maintainers hunting a phantom upstream bug; this is exactly how N1 shipped unnoticed. Error handling at this altitude should distinguish "empty result" from "query failed," not conflate them.

**AI fix prompt:**

> In `app/search.tsx`, remove the retry-and-swallow inside `runSearch` (and its misleading comment about the expo-sqlite web driver — the real failure it masked was malformed SQL, fixed in finding N1). Replace with: a single try/catch; on error, `console.warn` it, keep `results` empty, and set a new `searchError: boolean` state instead of `searched = true`. Render a distinct error message for that state (add i18n keys `search.error` in `en` — "Search failed. Please try again." — and `fr` — "La recherche a échoué. Veuillez réessayer." — following the existing key style in `src/i18n.ts`). Keep the debounce and the `searchSeq` stale-response guard exactly as they are. Verify with `npx tsc --noEmit`, then manually: a normal search shows results; a query with no matches shows the existing no-results text; a thrown error (temporarily rethrow in the catch to test) shows the new error text, not "no results".

---

## 🟡 Medium

### N4. Pinch and pan gestures fight over translation during two-finger gestures

**Status: ✅ Fixed (needs on-device confirmation)** — reworked to a base + per-gesture-delta model: `baseTranslateX/Y` hold the committed translation; pan writes `panX/Y`, pinch writes `pinchX/Y` (focal correction, subtracting pan's contribution so centroid movement isn't double-counted). `useAnimatedStyle` composes `base + panDelta + pinchDelta` and each gesture folds its delta into the base (clamped) in `onEnd`. All math stays in worklets. Typecheck passes; the pinch-around-corner / pinch-while-dragging feel should still be confirmed on a device/simulator.

**File:** [src/components/ZoomableContainer.tsx](../src/components/ZoomableContainer.tsx#L73)

The L4 fix made `pinch.onUpdate` write `translateX/translateY` (focal-point math). But the composed gesture is `Gesture.Simultaneous(pinch, pan, doubleTap)`, and Pan tracks the centroid of all touches with `minPointers(1)` as a floor — so during a two-finger pinch whose centroid drifts more than 10px, **both** handlers write the same shared values each frame with different formulas (pan: `savedTranslate + e.translation`; pinch: focal-preserving value). The last writer per frame wins, the formulas don't converge, and the content jitters and loses the focal anchor. Before the change, pinch wrote only `scale`, so there was no conflict.

**AI fix prompt:**

> In `src/components/ZoomableContainer.tsx` (react-native-gesture-handler v2 + Reanimated v4, worklets), the pinch and pan gestures — composed with `Gesture.Simultaneous` — both write `translateX/translateY` during a two-finger pinch, fighting each frame. Fix by giving each gesture its own contribution instead of both owning the total: keep base shared values (`baseTranslateX/Y`, `baseScale`) plus per-gesture deltas — pinch computes scale and its focal-correction translate delta relative to *its own* start; pan computes its translation delta relative to *its* start; `useAnimatedStyle` composes `base + panDelta + pinchDelta` (and each gesture folds its delta into the base in `onEnd`, resetting the delta to zero). Apply the existing `clampTranslate` to the composed total inside the animated style or in each `onUpdate` using the composed value. Alternative acceptable approach: keep single ownership by making pan the only translate writer and having pinch expose its focal correction as a separate pair of shared values composed in the style. Keep MIN/MAX scale clamps, the `enabled` gating, and the double-tap reset. All math stays in worklets — no `runOnJS` in `onUpdate`. Verify with `npx tsc --noEmit` and on a device/simulator: pinch around a corner (content under fingers stays put, no jitter), pinch while dragging both fingers (smooth follow), one-finger pan still works, double-tap resets.

### N5. ErrorBoundary ignores theme and language, and renders Paper components without a provider

**Status: ✅ Fixed** — the `ErrorBoundary` now uses plain RN `View`/`Text`/`Pressable` (no Paper, so no provider dependency), picks `darkPalette`/`lightPalette` via `useColorScheme()`, and pulls strings from the default `i18n` instance (`startup.error` + `startup.retry`). Typecheck passes.

**File:** [app/_layout.tsx](../app/_layout.tsx#L15-L27)

The new root `ErrorBoundary` hardcodes `lightPalette` (white screen for dark-mode users, now reachable since C2 enabled dark mode) and the English literal `"Retry"` (French users see English), even though `useColorScheme` and the `startup.retry` i18n key exist. It also renders react-native-paper `Text`/`Button` — but when the boundary replaces `RootLayout`, `PaperProvider` is not mounted, so Paper falls back to default MD3 theming (and is one provider-dependency away from crashing the crash screen itself).

**AI fix prompt:**

> In `app/_layout.tsx`, make the exported `ErrorBoundary` self-sufficient: it renders *instead of* `RootLayout`, so it must not depend on `PaperProvider`. Use plain React Native components (`View`, `Text`, `Pressable`) instead of react-native-paper. Pick the palette with `useColorScheme()` from react-native (`darkPalette`/`lightPalette` from `src/theme/palette.ts`). For the strings, use `i18n.t("startup.retry")` via the default i18n instance imported from `src/i18n` (it initializes on import and doesn't need a React provider), plus a generic message (reuse `startup.error`). Keep the same visual structure: centered message + retry button calling the `retry` prop. Verify with `npx tsc --noEmit` and by temporarily throwing inside `RootLayout` in a dark-mode simulator: the error screen must be dark and French (device in French).

---

## 🟢 Low

### N6. `isValidGeometry` is duplicated verbatim in settings.tsx and repository.ts

**Status: ✅ Fixed** — `isValidGeometry` is now exported from `repository.ts` (keeping its type-guard signature) and imported by `settings.tsx`; the duplicate is deleted. Typecheck passes.

**Files:** [app/settings.tsx](../app/settings.tsx#L96), [src/db/repository.ts](../src/db/repository.ts#L3)

The same rect-geometry validator was pasted byte-for-byte into both files by the C1 fix. When the geometry shape evolves, the two copies will drift: import validation and read-time validation would disagree, so data could pass one gate and be silently dropped by the other.

**AI fix prompt:**

> Export `isValidGeometry` from `src/db/repository.ts` (keep its type-guard signature `(g: unknown) => g is Zone["geometry"]`) and delete the duplicate in `app/settings.tsx`, importing it instead. No behavior change. Verify with `npx tsc --noEmit`.

### N7. Fill-opacity sanitization lives in the UI layer and is passed as a callback

**Status: ✅ Fixed** — `DEFAULT_FILL_OPACITY` and `sanitizeFillOpacity` moved to `repository.ts` and are exported; `importAllData` no longer takes a callback and calls the local function. The `0.4` fallbacks in `EditZoneDialog.tsx` and `ZoneOverlay.tsx` now use the constant (DDL default left as-is). The post-import theme block is replaced by a new `reloadThemeMode()` store action (in-memory only, no DB write), reused by `init()` so the union check lives once. Typecheck passes.

**Files:** [app/settings.tsx](../app/settings.tsx#L133-L166), [src/db/repository.ts](../src/db/repository.ts#L235)

`sanitizeFillOpacity` and `DEFAULT_FILL_OPACITY` are defined in the settings screen and injected into `repository.importAllData` as a function parameter — so the data-integrity rule lives in the UI while the INSERT lives in the repository, and any future caller must re-supply the callback or write unvalidated data. The 0.4 default is also independently hardcoded in `schema.ts`, `EditZoneDialog.tsx`, and `ZoneOverlay.tsx`. Related duplication: after import, settings re-reads and re-validates `themeMode` with the same literal-union check `useAppStore.init` already performs, then rewrites the identical value to the DB.

**AI fix prompt:**

> Consolidate fill-opacity handling in this Expo app: 1) Move `DEFAULT_FILL_OPACITY = 0.4` and `sanitizeFillOpacity` into `src/db/repository.ts`, export both, and remove the `sanitizeFillOpacity` parameter from `importAllData` (call the local function directly). 2) Replace the hardcoded `0.4` fallbacks in `src/components/dialogs/EditZoneDialog.tsx` and `src/components/ZoneOverlay.tsx` with the imported constant (leave the SQL DDL default in `schema.ts` as-is, but add the constant reference in a comment is NOT needed — just leave DDL alone). 3) In `app/settings.tsx`, replace the post-import `getPreference("themeMode")` + literal-union check + `setThemeMode` block with a new store action `reloadThemeMode()` in `src/store/useAppStore.ts` that reads the preference and updates only in-memory state (no DB write — the imported row is already in the DB); reuse it from `init()` so the union check exists once. Verify with `npx tsc --noEmit` and an export→import round trip preserving opacity and theme.

### N8. `withDb` globally serializes all DB access and is a nested-call deadlock footgun

**Status: ⚠️ Made safe; queue retained pending a web smoke test.** Removing the queue is the preferred outcome but is conditioned on a web run (`expo start --web`, exercise search-while-navigating + import) to confirm no worker errors — not doable in this environment. So the queue stays and a documented invariant was added: a `withDb` callback must never call `withDb` (deadlock), and repository functions must remain single-level. Revisit removal once the web test can be run now that N1's malformed SQL is fixed.

**File:** [src/db/database.ts](../src/db/database.ts#L15-L26)

The new `withDb` chains every read and write in the app onto one promise queue. Two costs: (1) it defeats the reader concurrency WAL mode was enabled for — e.g. a large `importAllData` transaction holds the queue for its full duration, stalling every unrelated read; (2) any `withDb` callback that ever calls another `withDb`-wrapped function (directly or via `getPreference`/a repository helper) deadlocks permanently — no current caller nests (verified), but nothing prevents the next contributor from doing so. If the queue was added to work around a specific web-driver symptom, that symptom was most likely N1's malformed SQL, not genuine query overlap.

**AI fix prompt:**

> In `src/db/database.ts`, reassess the `withDb` global serialization queue added recently. After fixing finding N1 (the malformed `ESCAPE ''` SQL that made searches throw), test whether the queue is still needed on web (the original motivation was overlapping-query worker errors). Preferred outcome: remove the queue and have `withDb` be simply `getDb().then(fn)`, relying on expo-sqlite's connection-level serialization and `withTransactionAsync` for atomicity — run the app on web and exercise search-while-navigating and import to confirm no worker errors. If the queue must stay, make it safe: add a documented invariant comment that `withDb` callbacks must never call `withDb` (deadlock), and exclude nesting structurally by keeping all repository functions single-level. Either way, verify with `npx tsc --noEmit` plus a web smoke test (`npx expo start --web`): map load, search, zone edit, export/import.

---

# Original findings (2026-07-07) — details

## 🔴 Critical

### C1. Malformed backup import can permanently brick the app

**Status: ✅ Fixed** in `548fe10` — import now validates geometry shape (`app/settings.tsx` `isValidZone`) and `repository.listZonesWithCounts` skips corrupt rows defensively instead of throwing. Verified in re-review. (Cleanup follow-up: the validator is duplicated, see N6.)

**Files:** [app/settings.tsx](../app/settings.tsx#L96), [src/store/useAppStore.ts](../src/store/useAppStore.ts#L69)

The import validator only checked that `zone.geometry` was a *string* — never that it was parseable JSON with the right shape. The string was written to the DB verbatim, and `loadZones()` ran an unguarded `JSON.parse` over every row. A backup file containing `"geometry": "hello"` passed validation, imported successfully, and then **every subsequent launch threw inside `loadZones()`** — zones never loaded and the app booted to a blank screen until reinstalled. A persistent denial-of-service via a user-supplied file. Even without import, a single corrupt row killed *all* zones because the throw escaped the whole `.map()`.

**AI fix prompt:**

> In the Expo/React Native app at the repo root, fix a data-corruption bug that can permanently blank the app:
>
> 1. In `app/settings.tsx`, inside `importData`, extend the zone validation (`isValidZone`) so `geometry` must be a string that parses as JSON to an object of shape `{ type: "rect", x, y, w, h }` where `x`, `y`, `w`, `h` all satisfy `Number.isFinite`. Reject the whole file with the existing `settings.import_invalid_format` alert if any zone fails.
> 2. In `src/store/useAppStore.ts`, make `loadZones` defensive: replace the `rows.map(...)` that does `JSON.parse(r.geometry)` with a `flatMap` that wraps the parse in try/catch, additionally validates the parsed shape (same rules as above), skips invalid rows with a `console.warn` including the zone id, and never throws. One corrupt row must not prevent the remaining zones from loading.
> 3. Keep the `Zone["geometry"]` type unchanged. Do not change the DB schema.
>
> Verify with `npx tsc --noEmit`, and manually reason through: importing a backup where one zone has `"geometry": "not-json"` must show the invalid-format alert; a pre-existing corrupt row in the DB must load all other zones normally.

### C2. `userInterfaceStyle: "light"` silently disables auto dark mode

**Status: ✅ Fixed** in `86c1fd4` — `app.json` now uses `"automatic"`. Requires a new native build to take effect (see Compatibility notes above).

**File:** [app.json](../app.json#L8)

`"userInterfaceStyle": "light"` locked the OS-reported appearance to light, so `useColorScheme()` in `src/theme/useAppTheme.ts` always returned `"light"`. The **"Auto" theme mode built in commit `3a35e00` could therefore never resolve to dark**. Manual "Dark" still worked because it bypasses the OS value — which is why this was easy to miss in testing.

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

**Status: ✅ Fixed** in `7f141dc` — `initError` state + retry UI in `index.tsx`, `ErrorBoundary` exported from `_layout.tsx`, and `getDb()` resets its promise on failure so retry actually re-attempts. Follow-up on the ErrorBoundary's theming/i18n: see N5.

**Files:** [app/_layout.tsx](../app/_layout.tsx#L15), [src/store/useAppStore.ts](../src/store/useAppStore.ts#L48), [app/index.tsx](../app/index.tsx#L34)

`init()` was called fire-and-forget with no `.catch`. If `getDb()` or `loadZones()` rejected (migration failure, corrupt DB — see C1), the rejection was swallowed, `initialized` stayed `false`, and the index screen rendered an empty `View` forever: no message, no retry. There was also no `ErrorBoundary` export in the root layout, so any render error was a white screen.

**AI fix prompt:**

> In this Expo Router app, make startup failures visible and recoverable:
>
> 1. In `src/store/useAppStore.ts`, add an `initError: string | null` field to the store. Wrap the body of `init()` in try/catch; on failure set `initError` to the error message and leave `initialized` false. Allow `init()` to be re-run after a failure (reset `initError` at the start).
> 2. In `app/index.tsx`, when `initError` is set, render a centered error message plus a "Retry" `Button` (react-native-paper) that calls `init()` again, instead of the current blank `View`. Add i18n keys for the message and button in both `en` and `fr` in `src/i18n.ts`, following the existing key naming style.
> 3. In `app/_layout.tsx`, export an `ErrorBoundary` component (expo-router supports `export function ErrorBoundary({ error, retry })`) rendering the error message and a retry button, styled minimally with the palette from `src/theme/useAppTheme.ts`.
>
> Verify with `npx tsc --noEmit` and by temporarily making `getDb()` throw to confirm the retry UI appears.

### H2. `splitZone` is not transactional

**Status: ❌ Not fixed.** The refactor moved the statements into `repository.splitZoneInDb`, but there is still no `withTransactionAsync` around them — only `importAllData` got one. The `withDb` queue serializes concurrent callers but does not provide atomicity. Carried forward as **N2** with an updated prompt targeting the new file.

**File:** originally `src/store/useAppStore.ts`; now [src/db/repository.ts](../src/db/repository.ts#L169)

`splitZone` runs five sequential statements (insert zone A, insert zone B, move items, delete original) with no transaction. A crash or error midway leaves duplicated zones, unmoved items, or a half-deleted state.

**AI fix prompt:** superseded — use the prompt in [N2](#n2-splitzoneindb-is-still-not-transactional-h2-not-actually-fixed).

### H3. Import drops `fill_opacity`; preferences not included in backup

**Status: ✅ Fixed** in `361cbfc` — export includes `preferences`, import restores `fill_opacity` (validated/clamped) and preferences inside the transaction, and the theme is re-applied after import. Verified round-trip in re-review. (Cleanup follow-up: sanitizer location, see N7.)

**File:** [app/settings.tsx](../app/settings.tsx#L124), [src/db/repository.ts](../src/db/repository.ts#L231)

Export used `SELECT *`, so `fill_opacity` was in the backup file — but the import `INSERT` omitted it, so every zone silently reverted to the 0.4 default on restore. The `preferences` table (theme choice) was also excluded from export entirely.

**AI fix prompt:**

> In `app/settings.tsx` of this Expo app, make backup/restore lossless:
>
> 1. In `importData`, include `fill_opacity` in the zones INSERT, defaulting to `0.4` when absent from the backup (older backups must still import). Validate it is a finite number between 0 and 1 when present; clamp or fall back to 0.4 otherwise.
> 2. In `handleExport`, also export the `preferences` table (key/value rows) as a `preferences` array in the JSON. In `importData`, restore it with `INSERT OR REPLACE` inside the existing transaction, treating the array as optional so old backups still import. After import, re-read the `themeMode` preference and apply it via the store's `setThemeMode`/state so the UI reflects the restored theme without a restart.
> 3. To prevent this class of bug recurring, consider building the INSERT column lists from an explicit whitelist array of column names shared between validation and INSERT construction — but keep it simple and readable.
>
> Verify with `npx tsc --noEmit` and reason through an export→import round trip: zone opacity and theme mode must survive.

### H4. `getDb()` race can run migrations twice

**Status: ✅ Fixed** in `786db7b` — the promise is memoized and reset on rejection. Verified: no double-open path remains, and the reset composes correctly with the init retry UI. (The same commit also added the `withDb` queue — see N8 for a design note on it.)

**File:** [src/db/database.ts](../src/db/database.ts#L5)

The module-level `db` variable was assigned only *after* `openDatabaseAsync` and all migrations completed. Two concurrent callers during startup both saw `db === null`, both opened the database, and both ran migrations and seeding concurrently.

**AI fix prompt:**

> In `src/db/database.ts`, fix the initialization race in `getDb()`: instead of caching the `SQLiteDatabase` instance (which is only assigned after the async open/migrate completes), cache the *promise*. Concretely: keep a module-level `let dbPromise: Promise<SQLite.SQLiteDatabase> | null = null;`, move the current open/migrate/seed body into a private `async function openAndMigrate()`, and have `getDb()` do `if (!dbPromise) dbPromise = openAndMigrate(); return dbPromise;`. On rejection, reset `dbPromise` to `null` so a later call can retry (this pairs with the init-retry UI in finding H1). Keep the exported signature `getDb(): Promise<SQLite.SQLiteDatabase>` unchanged. Verify with `npx tsc --noEmit`.

---

## 🟡 Medium

### M1. Zones can be dragged off-canvas and become unrecoverable

**Status: ✅ Fixed** in `ba27412` — all three gestures clamp to the exported `SVG_W`/`SVG_H`, the top-left resize now anchors the bottom-right corner correctly, and `commitGeometry` clamps as a safety net. Verified in re-review, including worklet safety.

**File:** [src/components/ZoneEditOverlay.tsx](../src/components/ZoneEditOverlay.tsx#L62)

Drag and resize gestures had no clamping to the 300×600 SVG viewBox. A zone dragged far off-screen took its edit handles with it and became hard or impossible to recover from the UI.

**AI fix prompt:**

> In `src/components/ZoneEditOverlay.tsx`, clamp zone editing to the SVG canvas. The canvas is 300×600 SVG units (see `SVG_W`/`SVG_H` in `src/components/VanLayoutSVG.tsx` — export them or pass them as props rather than duplicating the constants). In the `onUpdate` worklets:
>
> - Drag gesture: clamp `svgX` to `[0, SVG_W - svgW.value]` and `svgY` to `[0, SVG_H - svgH.value]`.
> - Bottom-right resize: clamp width/height so `x + w <= SVG_W` and `y + h <= SVG_H`, keeping the existing `MIN_ZONE_SIZE_SVG` minimum.
> - Top-left resize: clamp so `x >= 0` and `y >= 0` while preserving the anchored bottom-right corner and the minimum size.
>
> These run as Reanimated worklets — keep the math worklet-safe (no JS-thread calls in `onUpdate`). Also clamp once in `commitGeometry` as a safety net for any pre-existing out-of-bounds rows. Verify with `npx tsc --noEmit`.

### M2. Empty names can be saved for items and zones

**Status: ✅ Fixed** in `cf10ad4` — both edit dialogs guard `handleSave` and disable the Save button.

**Files:** [src/components/dialogs/EditItemDialog.tsx](../src/components/dialogs/EditItemDialog.tsx#L25), [src/components/dialogs/EditZoneDialog.tsx](../src/components/dialogs/EditZoneDialog.tsx#L37)

Both edit dialogs called `onSave(name.trim(), …)` with no emptiness check, so an item or zone could end up with an invisible blank name. `CreateZoneDialog` already guarded against this.

**AI fix prompt:**

> In `src/components/dialogs/EditItemDialog.tsx` and `src/components/dialogs/EditZoneDialog.tsx`, prevent saving an empty name: in each `handleSave`, compute `const trimmed = name.trim()` and return early if it's empty (mirroring the guard in `CreateZoneDialog.tsx`). Additionally disable the Save button (`disabled={!name.trim()}`) so the constraint is visible to the user. Do not add new i18n strings or error toasts — the disabled state is sufficient. Verify with `npx tsc --noEmit`.

### M3. Stale highlight timer clears a newer highlight

**Status: ✅ Fixed** in `ba297bb` — the auto-clear timer is owned by `setHighlightedZoneId` in the store; both screens' bare `setTimeout`s removed. Verified: highlighting A then B leaves B highlighted for a full 4s.

**Files:** [app/search.tsx](../app/search.tsx), [app/out-of-van.tsx](../app/out-of-van.tsx), [src/store/useAppStore.ts](../src/store/useAppStore.ts#L96)

Both screens cleared the zone highlight with a bare `setTimeout(() => setHighlightedZoneId(null), 4000)`. Locating item A and then item B within 4 seconds meant A's timer cleared B's highlight early.

**AI fix prompt:**

> In this app, zone highlighting is set via `setHighlightedZoneId` in `src/store/useAppStore.ts` and auto-cleared by bare 4-second `setTimeout`s in `app/search.tsx` (`handleItemPress`) and `app/out-of-van.tsx` (`handleLocate`), which race with each other. Centralize the auto-clear in the store:
>
> 1. In `useAppStore.ts`, add a module-level `let highlightTimer: ReturnType<typeof setTimeout> | null = null;`. Change `setHighlightedZoneId(zoneId)` so it always clears any pending timer first, sets the state, and — when `zoneId` is non-null — schedules a new 4-second timer that sets it back to `null`.
> 2. Remove the `setTimeout` calls from `app/search.tsx` and `app/out-of-van.tsx`, keeping only `setHighlightedZoneId(item.zone_id)` before navigation.
>
> Verify with `npx tsc --noEmit` and reason through: highlighting zone A then zone B within 4s must leave B highlighted for a full 4s.

### M4. SQL LIKE wildcards not escaped in search

**Status: ⚠️ Regressed.** The attempted fix (uncommitted, `src/db/repository.ts`) escapes the user input correctly but writes the SQL `ESCAPE` clause as `'\'` inside a template literal, which collapses to an empty string and makes **every** search throw — silently masked by the new retry/swallow. See **N1** (critical) for the corrected fix.

**File:** originally `src/store/useAppStore.ts`; now [src/db/repository.ts](../src/db/repository.ts#L104)

The query is safely parameterized (no injection), but `%` and `_` typed by the user act as wildcards — searching for `%` matches every item.

**AI fix prompt:** superseded — use the prompt in [N1](#n1-search-is-completely-broken-escape-clause-collapses-to-an-empty-string).

### M5. `GestureHandlerRootView` not at the app root

**Status: ✅ Fixed** in `f46cb0a` — root layout wraps the whole tree; `ZoomableContainer` uses a plain `View` (which also carries the new `onLayout` measurement).

**File:** [src/components/ZoomableContainer.tsx](../src/components/ZoomableContainer.tsx), [app/_layout.tsx](../app/_layout.tsx#L86)

`GestureHandlerRootView` lived inside `ZoomableContainer`, so only the map screen was covered; adding a `GestureDetector` on any other screen would throw.

**AI fix prompt:**

> In this Expo Router app, move `GestureHandlerRootView` from `src/components/ZoomableContainer.tsx` to the root layout: in `app/_layout.tsx`, wrap the entire returned tree (outside `PaperProvider`) in `<GestureHandlerRootView style={{ flex: 1 }}>` imported from `react-native-gesture-handler`. In `ZoomableContainer.tsx`, replace the `GestureHandlerRootView` with a plain `View` (keep the same styles). Verify with `npx tsc --noEmit` and confirm the map's pinch/pan/double-tap gestures and the zone edit-mode drag/resize still work.

### M6. `router.back()` after search breaks under deep linking

**Status: ✅ Fixed** in `ad66059` — both search and out-of-van use `router.dismissTo("/")`. Verified against the installed expo-router 55.0.13: `dismissTo` maps to React Navigation's `POP_TO`, which pops to `/` when it's in the stack and pushes it otherwise, so the deep-link case is covered.

**File:** [app/search.tsx](../app/search.tsx#L80), [app/out-of-van.tsx](../app/out-of-van.tsx#L43)

`handleItemPress` called `router.back()` assuming the map screen was underneath. If search was opened via deep link (`van-storage://search`), back popped out of the app instead of landing on the highlighted map.

**AI fix prompt:**

> In `app/search.tsx`, in `handleItemPress`, replace `router.back()` with a navigation call that reliably lands on the map screen (route `/`) even when the search screen was opened via deep link: use `router.dismissTo("/")` if available in the installed expo-router version (SDK 55 / expo-router ~55), otherwise `router.navigate("/")`. Check how `app/out-of-van.tsx` `handleLocate` handles the same situation (`router.replace("/")`) and make both screens consistent with whichever approach preserves a sensible back stack. Verify with `npx tsc --noEmit`.

---

## 🟢 Low

### L1. Export-success alert uses the "Import" title

**Status: ✅ Fixed** in `e82ba68` — `settings.export_success_title` added in both locales and used.

**File:** [app/settings.tsx](../app/settings.tsx#L62)

The fallback alert when sharing is unavailable showed `t("settings.import_confirm_title")` ("Import") as the title of an *export* success message.

**AI fix prompt:**

> In `app/settings.tsx` (`handleExport`, the branch where `Sharing.isAvailableAsync()` is false), the alert title wrongly reuses `settings.import_confirm_title`. Add a proper key `settings.export_success_title` to both `en` ("Export") and `fr` ("Export") in `src/i18n.ts`, following the existing naming style, and use it as the alert title. Verify with `npx tsc --noEmit`.

### L2. Double-tap on "add item" inserts duplicates

**Status: ✅ Fixed** in `390dc2a` — `adding` in-flight guard with `finally`, and the plus button is disabled while in flight.

**File:** [app/zone/[id].tsx](../app/zone/[id].tsx#L66)

`handleAddItem` had no in-flight guard; a fast double-tap on the plus button inserted the item twice.

**AI fix prompt:**

> In `app/zone/[id].tsx`, add an in-flight guard to `handleAddItem`: introduce a `const [adding, setAdding] = useState(false)` state, return early when `adding` is true, set it true before the `await addItem(...)` and false in a `finally` block. Also pass `disabled={adding}` to the plus `IconButton`. Keep clearing the input and reloading items as today. Verify with `npx tsc --noEmit`.

### L3. Import shows raw SQLite error when an item's zone is missing

**Status: ✅ Fixed** in `136805b` — orphan check against a `Set` of zone ids before the transaction, with a dedicated `settings.import_orphan_items` message in both locales.

**File:** [app/settings.tsx](../app/settings.tsx#L140)

An imported item whose `zone_id` didn't match any imported zone triggered a foreign-key failure; the transaction rolled back but the user saw a raw SQLite error.

**AI fix prompt:**

> In `app/settings.tsx`, in `importData`, pre-validate referential integrity before starting the DB transaction: build a `Set` of imported zone ids and check every item's `zone_id` is in it. If any item references a missing zone, show the existing `settings.import_invalid_format` alert (or add a more specific i18n key in `en`/`fr` such as `settings.import_orphan_items` explaining that some items reference unknown zones) and abort without touching the database. Verify with `npx tsc --noEmit`.

### L4. Zoom doesn't pinch around the focal point; pan has no bounds

**Status: ⚠️ Partially fixed** in `9ad6a88` — focal-point math and translate clamping are implemented and the clamp worklet is correct, but making pinch write `translateX/Y` while pan runs simultaneously introduced a gesture conflict. See **N4**.

**File:** [src/components/ZoomableContainer.tsx](../src/components/ZoomableContainer.tsx)

Pinch zoom scaled around the view center rather than the fingers' focal point, and pan could push the content fully off-screen.

**AI fix prompt:** superseded — use the prompt in [N4](#n4-pinch-and-pan-gestures-fight-over-translation-during-two-finger-gestures).

### L5. Zustand store doubles as a data-access layer

**Status: ✅ Fixed** (uncommitted working-tree refactor) — `src/db/repository.ts` owns all SQL; the store keeps state + actions; screens import read helpers directly; settings uses `exportAllData`/`importAllData`. Design follow-ups on the new layer: N7 (sanitizer location) and N8 (`withDb` queue).

**File:** [src/store/useAppStore.ts](../src/store/useAppStore.ts), [src/db/repository.ts](../src/db/repository.ts)

Several store "actions" were stateless async passthroughs to the DB, while `settings.tsx` bypassed the store and called `getDb()` directly.

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
- **Gestures/threading:** Reanimated shared values with `runOnJS` only on commit — correct pattern, no main-thread blocking found. ✅ (Re-verified after the `9ad6a88` gesture changes: all per-frame math stays in worklets.)
- **iOS permissions:** document picker and share sheet are system UI; no `NSxxxUsageDescription` entries needed. ✅
- **Silently skipping corrupt zone rows** in `listZonesWithCounts` (part of the C1 fix) hides bad rows from the map with only a `console.warn`. Accepted as the intended fail-safe behavior — import-side validation should keep such rows from existing at all — but worth revisiting if users ever report "vanished" zones.
- **`dismissTo("/")` deep-link behavior** was investigated and cleared: expo-router's `dismissTo` uses React Navigation `POP_TO`, which pushes the target when it isn't in the history, so users are never stranded.
