# Contributing & Running the App

This document lists every command you need to install, run, test and deploy **My Van Inventory**. It is split by what you have installed locally:

1. [Prerequisites](#prerequisites)
2. [Install](#install)
3. [Run locally — no Android SDK needed](#run-locally--no-android-sdk-needed)
4. [Run locally — with the Android SDK / emulator](#run-locally--with-the-android-sdk--emulator)
5. [Run on a physical Android phone](#run-on-a-physical-android-phone)
6. [Type-checking and linting](#type-checking-and-linting)
7. [Building and deploying](#building-and-deploying)
8. [Troubleshooting](#troubleshooting)

---

## Prerequisites

Required for every workflow:

- **Node.js** ≥ 20 (LTS recommended) — `node --version`
- **npm** ≥ 10 — `npm --version` (or `pnpm` / `yarn`, but the lockfile is `package-lock.json`)
- **Git** — `git --version`

Optional, depending on the workflow:

- **Expo Go** app on your phone — for the no-SDK workflow ([Android](https://play.google.com/store/apps/details?id=host.exp.exponent) / [iOS](https://apps.apple.com/app/expo-go/id982107779))
- **Android Studio** + Android SDK + an emulator — for the SDK workflow
- **EAS CLI** + an [Expo account](https://expo.dev) — for cloud builds and store deployment
- **Java JDK 17** — only if you produce a local APK without EAS

---

## Install

Clone and install dependencies:

```bash
git clone <repo-url> van-storage-app
cd van-storage-app
npm install
```

That's it — Expo handles native dependency linking automatically. There is no `pod install` step because we don't ship a custom iOS native module set, and no Android Gradle sync because we don't keep an `android/` folder in the repo (managed workflow).

---

## Run locally — no Android SDK needed

You have three zero-SDK options. Pick whichever fits your machine.

### Option A — Expo Go on your phone (easiest)

This is the recommended way to develop without installing Android Studio.

```bash
npm start
```

This starts the Metro bundler and prints a QR code in the terminal.

1. Make sure your phone and your computer are on the **same Wi-Fi network**.
2. Open the **Expo Go** app on the phone.
3. Scan the QR code (Android: from inside Expo Go; iOS: with the Camera app).
4. The app loads on your phone and reloads automatically on every save.

If your network blocks LAN connections, force a tunnel:

```bash
npx expo start --tunnel
```

### Option B — Web browser (fastest iteration loop)

The app fully runs in a browser via `react-native-web`, which is great for UI iteration:

```bash
npm run web
```

This opens `http://localhost:8081` in your default browser. SQLite runs in a Web Worker, so all features (zones, items, import/export) work — only native share sheets fall back to a plain file download.

### Option C — iOS Simulator (macOS only, no Android needed)

If you're on a Mac with Xcode installed:

```bash
npm run ios
```

This boots the iOS Simulator and installs the app via Expo Go. No Android SDK required at all.

---

## Run locally — with the Android SDK / emulator

If you've installed Android Studio and have an emulator (or a USB-debugging device) configured:

```bash
# 1. Make sure an emulator is running, or a device is connected:
adb devices

# 2. Boot the app on it
npm run android
```

This builds a JS bundle, opens Metro, installs Expo Go on the target, and launches the project inside it.

To explicitly target one device when several are connected:

```bash
adb devices                                  # find the serial
npx expo start --android --device <serial>
```

### Running a custom dev client (instead of Expo Go)

If you ever add a native module not bundled in Expo Go, generate a development build:

```bash
npx expo prebuild              # creates the android/ folder
npx expo run:android           # compiles and installs the dev client
```

`expo run:android` requires the Android SDK, an `ANDROID_HOME` env var, and JDK 17. After this, every subsequent run is just `npm start` + open the dev client on the device.

---

## Run on a physical Android phone

There are three ways to get the app onto a real phone, in increasing order of "production-likeness".

### 1. Expo Go (development, fastest)

Same as [Option A above](#option-a--expo-go-on-your-phone-easiest). Code changes hot-reload immediately. Best for daily development.

### 2. USB-debugging via ADB (development, with Android SDK)

Plug the phone into your computer with a USB cable, enable **Developer options → USB debugging** on the phone, then:

```bash
adb devices                    # confirm the phone shows up
npm run android                # builds + installs + launches
```

To stream logs from the device:

```bash
adb logcat | grep -i "ReactNative\|Expo\|vanstorage"
```

### 3. Standalone APK (no computer needed afterwards)

This is what you want if you just need the app installed on your phone permanently, with no Metro bundler running. Two paths:

#### 3a. Cloud build with EAS (recommended — no Android SDK on your machine)

```bash
# One-time setup
npm install -g eas-cli
eas login
eas build:configure          # only if eas.json is missing — already present in this repo

# Build a preview APK in the cloud
eas build --profile preview --platform android
```

When the build finishes, EAS prints a download URL. Open it from the phone's browser and tap the APK to install (you'll need to allow "Install unknown apps" for your browser the first time).

The `preview` profile is defined in [eas.json](eas.json) and produces an APK directly installable without the Play Store.

#### 3b. Local APK build (requires Android SDK + JDK 17)

```bash
eas build --profile preview --platform android --local
```

Same APK, but built on your machine. Slower the first time, no cloud minutes used.

#### Installing the APK

```bash
# Via USB (with adb)
adb install -r path/to/van-storage.apk

# Or transfer the APK file to the phone (email, USB, cloud drive) and tap it
```

---

## Type-checking and linting

The project ships with TypeScript but no test runner or linter is currently configured.

```bash
# Type-check the whole project
npx tsc --noEmit
```

There is no `npm test` script — if you add tests, wire them up in [package.json](package.json) under `scripts`.

---

## Building and deploying

### EAS build profiles

The `--profile` flag passed to `eas build` selects a profile defined under `"build"` in [eas.json](eas.json). This project currently defines two:

| Profile | Output | Use case |
| --- | --- | --- |
| `preview` | Android **APK** | Sideload onto a phone for testing without the Play Store |
| `production` | Android **AAB** (App Bundle) | Upload to the Play Console for release |

Pass whichever you want with `--profile`:

```bash
eas build --platform android --profile preview      # APK for direct install
eas build --platform android --profile production   # AAB for the Play Store
```

Profile names are **not fixed** — they're just keys in `eas.json`. The Expo defaults from `eas build:configure` are `development`, `preview`, and `production`, but you can rename them or add your own (e.g. `staging`, `qa`, `internal`) and reference them the same way:

```jsonc
// eas.json
{
  "build": {
    "preview":    { "android": { "buildType": "apk" } },
    "staging":    { "android": { "buildType": "apk" }, "channel": "staging" },
    "production": { "android": { "buildType": "app-bundle" } }
  }
}
```

```bash
eas build --platform android --profile staging
```

See the [Expo docs on build profiles](https://docs.expo.dev/build/eas-json/) for the full list of available options (env vars, channels, resource class, distribution, etc.).

### Android — Play Store (AAB)

The `production` profile in [eas.json](eas.json) builds an Android App Bundle, which is the format the Play Store expects:

```bash
eas build --profile production --platform android
```

To submit the resulting AAB to the Play Console automatically:

```bash
eas submit --platform android --latest
```

You'll need to have configured a service account in `eas.json` under a `submit` section the first time.

### Bumping the version

Update both fields before producing a release build:

- `version` in [package.json](package.json)
- `version` in [app.json](app.json) (Expo also auto-increments `versionCode` per EAS build)

### iOS

No iOS build profile is defined yet. To add one, extend [eas.json](eas.json) with an `ios` block under `production` and run:

```bash
eas build --profile production --platform ios
```

You'll need an Apple Developer account.

### Web

To produce a static web bundle (deployable to Netlify, Vercel, GitHub Pages, …):

```bash
npx expo export --platform web
# output goes to dist/
```

---

## Troubleshooting

**`Error: Cannot find module 'expo'`** — run `npm install` from the project root.

**Metro is stuck on "Loading..." on the phone** — your phone and computer aren't on the same network, or a firewall is blocking port 8081. Use `npx expo start --tunnel`.

**`adb: device unauthorized`** — unplug, replug, and tap "Allow USB debugging" in the prompt that appears on the phone screen.

**`SDK location not found`** — set `ANDROID_HOME` (e.g. `export ANDROID_HOME=$HOME/Library/Android/sdk` on macOS) or run the no-SDK workflow above.

**Build fails on EAS with "Invalid project ID"** — the `eas.projectId` in [app.json](app.json) is tied to a specific Expo account. Run `eas init` to claim a new project ID for your own account.

**Database doesn't reset between builds** — SQLite data is stored on the device; uninstall the app or clear its app data from Android settings to start fresh.

**Web SQLite worker crashes on second launch** — see the comment in [src/db/schema.ts](src/db/schema.ts): column additions are handled via `PRAGMA table_info` checks rather than `ALTER TABLE` retries because the worker doesn't surface duplicate-column errors as catchable exceptions.
