# My Van Inventory

A mobile-first inventory app for camper vans. It lets you draw a top-down map of your van, split it into colored zones (cupboards, drawers, garage, roof box…), and keep track of every item stored inside — so you never have to dig through three cabinets to find the headlamp again.

The app was built specifically for a **Citroën Jumpy / T&T Vans Aventourer** conversion, but the zone layout is fully editable so it works for any van.

## Features

- **Visual van map** — interactive SVG layout with pinch-to-zoom and tap-to-open zones
- **Zones** — create, name, color, move, resize, split, and delete zones directly on the map (Edit mode)
- **Items** — add items to a zone, edit them, move them between zones, attach free-text notes
- **Out-of-van tracking** — mark items as "currently outside the van" so you can see at a glance what's been unpacked
- **Search** — full-text search across item names and notes
- **Local-first storage** — everything lives in a local SQLite database on the device, no account, no cloud, no network required
- **Backup / restore** — export and import the full inventory as JSON, for transferring between devices or keeping snapshots
- **English UI** — the UI is by default in English, available in French according to the phone's settings

## Tech stack

- [Expo](https://expo.dev/) SDK 54 (React Native 0.81, React 19, New Architecture enabled)
- [Expo Router](https://docs.expo.dev/router/introduction/) v6 — file-based routing under [app/](app/)
- [expo-sqlite](https://docs.expo.dev/versions/latest/sdk/sqlite/) — local database
- [React Native Paper](https://callstack.github.io/react-native-paper/) — Material 3 UI components
- [react-native-svg](https://github.com/software-mansion/react-native-svg) — van layout rendering
- [react-native-gesture-handler](https://docs.swmansion.com/react-native-gesture-handler/) + [reanimated](https://docs.swmansion.com/react-native-reanimated/) — pan / pinch / drag interactions
- [Zustand](https://zustand-demo.pmnd.rs/) — global state store
- TypeScript end-to-end
- [EAS Build](https://docs.expo.dev/build/introduction/) — Android APK / AAB builds

## Project layout

```
van-storage-app/
├── app/                          # Expo Router screens (file-based routing)
│   ├── _layout.tsx               # Root stack + header (edit toggle, search, settings…)
│   ├── index.tsx                 # Van map home screen
│   ├── zone/[id].tsx             # Zone detail (item list)
│   ├── search.tsx                # Item search
│   ├── out-of-van.tsx            # Items currently outside the van
│   └── settings.tsx              # Backup / restore (JSON export/import)
├── src/
│   ├── components/
│   │   ├── VanLayoutSVG.tsx      # Main interactive van map
│   │   ├── VanOutline.tsx        # Static van outline SVG
│   │   ├── ZoneOverlay.tsx       # Read-only zone tap target
│   │   ├── ZoneEditOverlay.tsx   # Drag/resize zone in edit mode
│   │   ├── ZoomableContainer.tsx # Pinch-zoom + pan wrapper
│   │   └── ItemCountBadge.tsx    # Item count badge
│   ├── db/
│   │   ├── database.ts           # SQLite open + types
│   │   ├── schema.ts             # Migrations (zones, items)
│   │   └── seed.ts               # Default zones for first launch
│   └── store/
│       └── useAppStore.ts        # Zustand store (all data + actions)
├── assets/                       # App icons, splash screen
├── app.json                      # Expo config (name, slug, Android package, plugins)
├── eas.json                      # EAS Build profiles (preview APK, production AAB)
├── metro.config.js               # Metro bundler config
└── package.json
```

## Data model

Two tables, defined in [src/db/schema.ts](src/db/schema.ts):

- **zones** — `id`, `name`, `color`, `geometry` (JSON: `{type, x, y, w, h}` in SVG coordinates), `sort_order`, timestamps
- **items** — `id`, `name`, `zone_id` (FK, cascade delete), `notes`, `out_of_van` (0/1), timestamps

All data is stored in a single SQLite file managed by `expo-sqlite`. There is no remote backend.

## How it works

1. On first launch the store calls [`init()`](src/store/useAppStore.ts) which opens the database, runs migrations, seeds default zones if the table is empty, and loads everything into the Zustand store.
2. The home screen ([app/index.tsx](app/index.tsx)) renders the van outline + zone overlays inside a zoomable container. Tapping a zone navigates to [app/zone/[id].tsx](app/zone/[id].tsx) where you can add/edit/move items.
3. Toggling **Edit mode** from the header replaces the read-only zone overlays with draggable/resizable handles ([src/components/ZoneEditOverlay.tsx](src/components/ZoneEditOverlay.tsx)) and disables zoom so the layout can be freely rearranged.
4. Backups go through [app/settings.tsx](app/settings.tsx): export dumps both tables to a JSON file (shared via the system share sheet on device, downloaded as a file on web); import wipes the current data and replays the JSON.

## Platforms

- **Android** — primary target, packaged as `com.perhan35.vanstorage`
- **iOS** — supported by the Expo toolchain (the code is platform-agnostic) but no signed build is currently produced
- **Web** — works as a PWA-style app via `react-native-web`, useful for development without a device

## Getting started

See [CONTRIBUTION.md](CONTRIBUTION.md) for the full list of commands to install, run, test and deploy the app — locally, with or without the Android SDK, and on a physical Android phone.

## License

Personal project — no license declared. Ask the author before reusing.
