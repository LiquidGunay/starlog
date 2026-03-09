# Android Dev Build

This is the active native-mobile path for Starlog. It keeps the Expo-managed app, but switches from Expo Go-only testing to a local Android development build so native modules can be used directly.

## What this enables

- Installable Android dev app (`com.starlog.app.dev`)
- Local Metro connection with `expo-dev-client`
- Native modules already wired into the repo:
  - SQLite-backed mobile state
  - audio recording for voice-note capture
  - Android share-intent receive via `expo-share-intent`

## Files added for this path

- `apps/mobile/app.config.js`
- `apps/mobile/eas.json`
- `apps/mobile/package.json` (`expo-dev-client`, `expo-sqlite`, `expo-av`, `expo-share-intent`, build scripts)

## Build profiles

- `development`
  - installable APK
  - uses `APP_VARIANT=development`
  - package: `com.starlog.app.dev`
- `preview`
  - installable APK
  - uses `APP_VARIANT=preview`
  - package: `com.starlog.app.preview`
- `production`
  - app bundle
  - uses `APP_VARIANT=production`
  - package: `com.starlog.app`

## First-time setup

From repo root:

```bash
pnpm install
```

Then install the local Android toolchain on your laptop:

- Android Studio
- Android SDK / platform tools
- Java / JDK

## Local Android dev build (recommended)

From repo root:

```bash
pnpm --filter mobile android:local
```

That compiles and installs the development build locally using your machine's Android SDK.

If you prefer running the native compile directly from the app folder:

```bash
cd apps/mobile
APP_VARIANT=development npx expo run:android --device
```

## Optional EAS/cloud build

You do not need Expo/EAS credentials for the local Android build path above.

Only use EAS if you explicitly want Expo's hosted build system:

From repo root:

```bash
cd apps/mobile
npx eas-cli build --platform android --profile development
```

Use this only if you want Expo's hosted build pipeline. It is not required for local Android installs.

## Start the JS bundle for the dev client

From repo root:

```bash
pnpm --filter mobile start:dev-client
```

or

```bash
pnpm --filter mobile android:dev
```

Important: Android share-sheet receive depends on the native dev build. It does not work in Expo Go.

## Point the app at the backend

Inside the app:

- local testing: set API base to `http://<LAN_IP>:8000`
- hosted testing: set API base to your Railway public API URL

The current mobile app stores this value locally, so you can switch between local and hosted backends without rebuilding.

## Current native limitations

This path is working now, but it does **not** yet implement:

- fully on-phone Whisper execution
- iOS share-extension patching/hardening (Android is the active priority path)

Current voice-note STT design:

- phone records audio locally
- Starlog uploads the audio to the API
- a laptop-local worker runs Whisper later

That keeps the Android app simpler and lets the same local STT path also serve your laptop workflow.

Android share-sheet flow:

- build/install the dev client
- share text, URL, audio, image, or file to Starlog from Android
- Starlog companion prefills quick capture and, for shared audio, preloads the voice-upload path

The remaining native-mobile tasks now focus on on-device STT/LLM execution and iOS parity.
