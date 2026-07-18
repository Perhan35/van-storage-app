[![Build Android APK](https://github.com/Perhan35/van-storage-app/actions/workflows/build-android.yml/badge.svg?branch=main)](https://github.com/Perhan35/van-storage-app/actions/workflows/build-android.yml)

# My Inventory

A mobile-first inventory app for camper vans. It lets you draw a top-down map of your van, split it into colored zones (cupboards, drawers, garage, roof box…), and keep track of every item stored inside — so you never have to dig through three cabinets to find the headlamp again.

The app was built specifically for a **Citroën Jumpy / T&T Vans Aventourer** conversion, but the zone layout is fully editable so it works for any van.

## Features

- **Visual van map** — interactive SVG layout with pinch-to-zoom and tap-to-open zones
- **Zones** — create, name, color, move, resize, split, and delete zones directly on the map (Edit mode), with magnetic edge-snapping while dragging/resizing and a per-zone fill-opacity control
- **Items** — add items to a zone, edit them, move them between zones, attach free-text notes
- **Out-of-van tracking** — mark items as "currently outside the van" so you can see at a glance what's been unpacked, with a dedicated screen filterable by zone and season
- **Seasonal items** — tag items as summer/winter/none and switch the app's season mode from Settings; a changeover dialog walks you through what to load in and take out of the van
- **Checklists** — mark a zone as a checklist (e.g. a packing list) so its items can be individually checked off, with a one-tap reset for the whole zone
- **Expiration tracking** — set an expiration date and reminder lead time (in days) per item; a startup dialog surfaces anything expired or expiring soon, and Settings has a full expiration overview
- **Push notification reminders** — local notifications are scheduled automatically ahead of each item's expiration date (device build only, not on web or in Expo Go)
- **Swipe actions** — swipe items left/right in zone and search views to toggle out-of-van status or (in checklist zones) checked status
- **Search** — full-text search across item names and notes, with the same swipe actions as the zone view
- **Local-first storage** — everything lives in a local SQLite database on the device, no account, no cloud, no network required
- **Backup / restore** — export and import the full inventory as JSON, for transferring between devices or keeping snapshots
- **Light / dark / auto theme** — follows the device theme by default, overridable from Settings
- **English UI** — the UI is by default in English, available in French according to the phone's settings
- **Hidden trivia game** 🥚 — double-tap the version number at the bottom of Settings to launch a quiz mode that tests you on where your own items live, what season they belong to, and how many items are in each zone

## Tech stack

- [Expo](https://expo.dev/) SDK 57 (React Native 0.86, React 19, New Architecture enabled)
- [Expo Router](https://docs.expo.dev/router/introduction/) v57 — file-based routing under [app/](app/)
- [expo-sqlite](https://docs.expo.dev/versions/latest/sdk/sqlite/) — local database
- [expo-notifications](https://docs.expo.dev/versions/latest/sdk/notifications/) — local expiration reminders
- [React Native Paper](https://callstack.github.io/react-native-paper/) — Material 3 UI components
- [react-native-svg](https://github.com/software-mansion/react-native-svg) — van layout rendering
- [react-native-gesture-handler](https://docs.swmansion.com/react-native-gesture-handler/) + [reanimated](https://docs.swmansion.com/react-native-reanimated/) — pan / pinch / drag / swipe interactions
- [Zustand](https://zustand-demo.pmnd.rs/) — global state store
- [i18next](https://www.i18next.com/) / [react-i18next](https://react.i18next.com/) — English / French localization
- TypeScript end-to-end
- [EAS Build](https://docs.expo.dev/build/introduction/) — Android APK / AAB builds, with a GitHub Actions workflow to build and sign APKs

## Project layout

```
van-storage-app/
├── app/                                  # Expo Router screens (file-based routing)
│   ├── _layout.tsx                       # Root stack + header (edit toggle, search, settings…)
│   ├── index.tsx                         # Van map home screen + FAB (add item / add zone)
│   ├── zone/[id].tsx                     # Zone detail (item list, checklist, expiration, swipe actions)
│   ├── search.tsx                        # Item search with swipe actions
│   ├── out-of-van.tsx                    # Items currently outside the van (zone + season filters)
│   ├── settings.tsx                      # Theme, season, reminders, backup/restore, expiration overview
│   └── game.tsx                          # Hidden trivia game (easter egg, see below)
├── src/
│   ├── components/
│   │   ├── VanLayoutSVG.tsx              # Main interactive van map
│   │   ├── VanOutline.tsx                # Static van outline SVG
│   │   ├── ZoneOverlay.tsx               # Read-only zone tap target
│   │   ├── ZoneEditOverlay.tsx           # Drag/resize zone in edit mode (with edge snapping)
│   │   ├── ZoomableContainer.tsx         # Pinch-zoom + pan wrapper
│   │   ├── ItemCountBadge.tsx            # Item count badge
│   │   ├── ColorPickerField.tsx          # Zone color picker
│   │   ├── ExpirationField.tsx           # Expiration date + reminder-days picker
│   │   ├── AnimatedCheckbox.tsx          # Checklist checkbox animation
│   │   ├── AnimatedCheckRow.tsx          # Row highlight when checked
│   │   ├── AnimatedOutOfVanRow.tsx       # Row highlight when marked out-of-van
│   │   ├── seasonIcon.ts / expirationIcon.ts  # Icon/color helpers for season & expiration state
│   │   ├── dialogs/
│   │   │   ├── AddItemDialog.tsx         # Create item (zone picker, season, expiration)
│   │   │   ├── EditItemDialog.tsx        # Edit item
│   │   │   ├── CreateZoneDialog.tsx / EditZoneDialog.tsx  # Zone create/edit (color, opacity, checklist)
│   │   │   ├── SeasonChangeoverDialog.tsx     # Guided summer/winter swap
│   │   │   └── ExpirationOverviewDialog.tsx   # Expired / expiring-soon / up-to-date item list
│   │   └── game/                         # Trivia game UI (HUD, question banner, answers, feedback)
│   ├── db/
│   │   ├── database.ts                   # SQLite open + types
│   │   ├── schema.ts                     # Migrations (zones, items, preferences)
│   │   ├── repository.ts                 # Queries (listing, search, export/import)
│   │   ├── preferences.ts                # Key/value app preferences (theme, season, reminders)
│   │   └── seed.ts                       # Default zones for first launch
│   ├── notifications/
│   │   └── reminders.ts                  # Schedules/cancels local expiration-reminder notifications
│   ├── game/
│   │   └── questions.ts                  # Trivia question generation
│   ├── theme/
│   │   ├── palette.ts                    # Light/dark Paper themes + app palette
│   │   └── useAppTheme.ts                # Theme hook (auto/light/dark)
│   ├── utils/
│   │   ├── expiration.ts                 # Expiration status (ok / soon / expired)
│   │   ├── date.ts                       # Locale-aware date formatting
│   │   └── color.ts / colors.ts          # Color helpers
│   ├── hooks/useTextSelectionFix.ts      # Prevents cursor jumps in controlled TextInput fields
│   ├── i18n.ts                           # en/fr translation resources
│   └── store/
│       └── useAppStore.ts                # Zustand store (all data + actions)
├── assets/                               # App icons, splash screen
├── app.json                              # Expo config (name, slug, Android package, plugins)
├── eas.json                              # EAS Build profiles (preview APK, production AAB)
├── metro.config.js                       # Metro bundler config
└── package.json
```

## Data model

Three tables, defined in [src/db/schema.ts](src/db/schema.ts):

- **zones** — `id`, `name`, `color`, `geometry` (JSON: `{type, x, y, w, h}` in SVG coordinates), `sort_order`, `fill_opacity`, `checklist` (0/1), timestamps
- **items** — `id`, `name`, `zone_id` (FK, cascade delete), `notes`, `out_of_van` (0/1), `season` (`summer` / `winter` / `none`), `checked` (0/1), `expiration_date`, `reminder_days`, timestamps
- **preferences** — simple `key`/`value` store for app-level settings (theme mode, season mode, reminders enabled, etc.)

All data is stored in a single SQLite file managed by `expo-sqlite`. There is no remote backend.

## How it works

1. On first launch the store calls [`init()`](src/store/useAppStore.ts) which opens the database, runs migrations, seeds default zones if the table is empty, and loads everything into the Zustand store.
2. The home screen ([app/index.tsx](app/index.tsx)) renders the van outline + zone overlays inside a zoomable container, with a FAB for adding items/zones. Tapping a zone navigates to [app/zone/[id].tsx](app/zone/[id].tsx) where you can add/edit/move/check off items and see expiration status.
3. Toggling **Edit mode** from the header replaces the read-only zone overlays with draggable/resizable handles ([src/components/ZoneEditOverlay.tsx](src/components/ZoneEditOverlay.tsx)), snapping to nearby edges, and disables zoom so the layout can be freely rearranged.
4. Items with an `expiration_date` get a local notification scheduled via [src/notifications/reminders.ts](src/notifications/reminders.ts), fired `reminder_days` before the date; the store resyncs all reminders whenever items or the reminders-enabled setting change. On startup, if anything is expired or expiring soon, an overview dialog pops up automatically.
5. Zones flagged as a **checklist** let items be checked off via swipe or tap, with progress reset from the zone header once everything's been used.
6. Setting the app's **season mode** (Settings) filters/highlights seasonal items and offers a guided changeover dialog for swapping summer/winter gear.
7. Backups go through [app/settings.tsx](app/settings.tsx): export dumps all tables to a JSON file (shared via the system share sheet on device, downloaded as a file on web); import wipes the current data and replays the JSON.

## Easter egg

Double-tap the version number at the bottom of the **Settings** screen to open a hidden trivia game ([app/game.tsx](app/game.tsx)): it quizzes you on which zone an item lives in (tap the zone on the map to answer), what season an item belongs to, and how many items are in a given zone — all generated live from your own inventory data ([src/game/questions.ts](src/game/questions.ts)). Tracks score and streak; close it from the header `×` button.

## Platforms

- **Android** — primary target, packaged as `com.perhan35.myinventory`; APKs are built and signed via a GitHub Actions workflow using EAS
- **iOS** — supported by the Expo toolchain (the code is platform-agnostic) but no signed build is currently produced
- **Web** — works as a PWA-style app via `react-native-web`, useful for development without a device (push notifications are disabled on this platform)

## Getting started

See [CONTRIBUTION.md](CONTRIBUTION.md) for the full list of commands to install, run, test and deploy the app — locally, with or without the Android SDK, and on a physical Android phone.

## License

Personal project — no license declared. Ask the author before reusing.
