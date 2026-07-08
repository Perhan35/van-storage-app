# Dependency Upgrade — Expo SDK 55 → 57

_Upgrade date: 2026-07-08. App version bumped **1.2.0 → 2.0.0** (major)._

This app is an Expo-managed React Native project, so "latest compatible" means the
versions certified by the installed Expo SDK, not necessarily the newest tag on npm.
Native modules are pinned by `npx expo install --fix`; pure-JS libraries are bumped to
their npm-latest.

## What changed

| Package | From | To | Notes |
|---------|------|-----|-------|
| expo | 55.0.18 | 57.0.4 | Two-major SDK jump |
| react-native | 0.83.6 | 0.86.0 | SDK-pinned |
| react | 19.2.0 | 19.2.3 | SDK-pinned |
| react-dom | 19.2.0 | 19.2.3 | SDK-pinned |
| react-native-reanimated | 4.2.1 | 4.5.0 | SDK-pinned |
| react-native-worklets | 0.7.4 | 0.10.0 | SDK-pinned |
| react-native-screens | 4.23.0 | 4.25.2 | SDK-pinned |
| react-native-safe-area-context | 5.6.0 | 5.7.0 | SDK-pinned |
| react-native-svg | 15.15.3 | 15.15.4 | SDK-pinned |
| expo-* modules | 55.x | 57.x | SDK-pinned |
| expo-splash-screen | — | 0.x (SDK 57) | **Newly added** (see config migration) |
| typescript | 5.9.2 | 6.0.3 | Major — compiles clean |
| @types/react | 19.2.10 | 19.2.17 | |
| @react-native-community/slider | 5.1.2 | 5.2.0 | |
| i18next | 26.0.8 | 26.3.4 | |
| react-i18next | 17.0.6 | 17.0.8 | |
| react-native-paper | 5.15.1 | 5.15.3 | |
| reanimated-color-picker | 4.2.0 | 5.1.2 | Major — no code impact (below) |
| zustand | 5.0.12 | 5.0.14 | |

## Code / config changes required by the upgrade

SDK 57 tightened the `app.json` schema. Migrated in [`app.json`](../app.json):

- Removed `newArchEnabled` — the New Architecture is the default in SDK 57.
- Removed `android.edgeToEdgeEnabled` — edge-to-edge is now the default.
- Moved the top-level `splash` block into the **`expo-splash-screen` config plugin**
  (the standalone `splash` key was removed). Installed `expo-splash-screen` to support it.

`reanimated-color-picker` v5 breaking changes (`adaptiveSpectrum` default flip, RGB
`SliderProps` rename, PascalCase ColorKit types) do **not** touch this app's usage in
[`ColorPickerField.tsx`](../src/components/ColorPickerField.tsx) — it only uses
`ColorPicker`, `Panel1`, `HueSlider`, `ColorPickerRef` and `onChangeJS`, all unchanged.

No other source changes were needed. `react-native-gesture-handler`'s modern
`Gesture`/`GestureDetector` API is identical between v2 and v3.

## ⚠️ Known problem — held back

### react-native-gesture-handler: stuck at 2.32.0 (npm-latest is 3.0.2)

`react-native-gesture-handler@3.0.2` was installed and tested. It **type-checks and
bundles fine** (the app's API usage is compatible), but Expo SDK 57 requires `~2.32.0`
and `expo-doctor` fails with a **major version mismatch** — v3 is not yet validated
against SDK 57's native layer. Since this is a native/SDK constraint that cannot be
resolved by application code, it was **rolled back to the SDK-pinned `~2.32.0`**.

**Revisit** when a future Expo SDK bumps its pinned gesture-handler to v3, then run
`npx expo install react-native-gesture-handler`.

The other packages `npm outdated` still lists (react 19.2.7, reanimated 4.5.1,
safe-area-context 5.8.0, svg 15.15.5, worklets 0.10.2) are the same situation — newer
patches exist on npm but Expo SDK 57 validates the pinned versions above. They are
intentionally left at the SDK-pinned versions.

## Verification

- `npx tsc --noEmit` — passes (TypeScript 6).
- `npx expo-doctor` — **20/20 checks pass**.
- `npx expo export --platform ios` — bundles successfully (full module graph resolves).
