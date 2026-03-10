# Android Dev Build

This is the active native-mobile path for Starlog. It keeps the Expo-managed app, but switches from Expo Go-only testing to a local Android development build so native modules can be used directly.

## What this enables

- Installable Android dev app (`com.starlog.app.dev`)
- Local Metro connection with `expo-dev-client`
- Tracked native Android project under `apps/mobile/android`
- Native modules already wired into the repo:
  - SQLite-backed mobile state
  - audio recording for voice-note capture
  - Android share-intent receive via `expo-share-intent`
  - Android-only share-intent plugin path while iOS extension patching remains deferred

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

In this repo's current Linux/WSL-style environment, the local paths have been:

- Android SDK: `~/.local/android`
- JDK 17: `~/.local/jdks/temurin-17`

The repo now includes a helper launcher that wires those defaults, prefers the Starlog AOSP AVD if present, redirects emulator runtime state into a writable `XDG_RUNTIME_DIR`, and falls back to `-accel off` when `/dev/kvm` is not accessible:

```bash
pnpm android:emulator
```

Useful overrides:

- `AVD_NAME=starlog-api34 pnpm android:emulator`
- `pnpm android:emulator:aosp`
- `EMULATOR_WIPE_DATA=1 pnpm android:emulator`
- `EMULATOR_HEADLESS=0 pnpm android:emulator`

## Local Android dev build (recommended)

From repo root:

```bash
pnpm --filter mobile android:local
```

That compiles and installs the development build locally using your machine's Android SDK.

The native Android project can also be validated directly:

```bash
export JAVA_HOME="$HOME/.local/jdks/temurin-17"
export ANDROID_HOME="$HOME/.local/android"
export ANDROID_SDK_ROOT="$HOME/.local/android"
cd apps/mobile
APP_VARIANT=development npx expo prebuild --platform android --no-install
cd android
./gradlew assembleDebug
```

The resulting debug APK is written to:

```bash
apps/mobile/android/app/build/outputs/apk/debug/app-debug.apk
```

Once a device/emulator is attached and the Android package manager is actually responsive, you can run the repo smoke flow from root:

```bash
pnpm test:android:smoke
```

That script installs the debug APK, launches Starlog, sends a `starlog://capture?...` deep link, and sends a plain-text Android share intent into the dev build.

Useful overrides for the shell smoke helper:

```bash
ADB_SERIAL=<device-serial> pnpm test:android:smoke
REVERSE_PORTS=8081,8000 pnpm test:android:smoke
SKIP_INSTALL=1 SKIP_DEEP_LINK=1 pnpm test:android:smoke
```

This is useful when:

- more than one Android device/emulator is attached,
- Metro/API need `adb reverse`,
- the app is already installed and you only want to resend share/deep-link intents.

For fresh Codex worktrees in this environment, also run:

```bash
npx pnpm@9.15.0 install
```

before `tsc`, `expo prebuild`, or direct Gradle validation.

### Windows-host physical-device smoke flow

On this host, physical-device validation has been more reliable through a native Windows `adb.exe` than through WSL-driven `adb shell`.

From repo root in PowerShell:

```powershell
.\scripts\android_native_smoke_windows.ps1 -ReversePorts "8081,8000"
```

Equivalent from the repo root in WSL:

```bash
pnpm test:android:smoke:windows
```

Optional Windows overrides:

```powershell
.\scripts\android_native_smoke_windows.ps1 `
  -Serial 9dd62e84 `
  -ReversePorts "8081,8000" `
  -SkipInstall `
  -SkipDeepLink
```

Use the Windows-host script when:

- WSL `adb shell` hangs or streams truncate,
- the connected phone only appears in Windows `adb`,
- you need a reproducible physical-device flow for this repo's current host setup.

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
The current config explicitly disables the iOS share-extension branch until that patch path is implemented.

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
- Starlog companion prefills quick capture, copies shared files/audio into app-owned storage for more durable drafts, shared images/files upload as media-backed artifacts, multiple shared files stay grouped in the companion queue, and shared audio preloads the voice-upload path

Manual validation matrix for Android native share:

- text share:
  - quick capture title/text populate
- URL share:
  - quick capture source URL populates
- image/file share:
  - shared file list is visible in quick capture before submit
  - submit uploads media-backed artifact instead of placeholder text
- audio share:
  - `Voice clip` becomes ready without recording in-app
  - `Upload / Queue Voice` sends the shared file into `/v1/capture/voice`
- restart/background:
  - shared files/audio survive routine app backgrounding or restart before submit

Validation status in this repo:

- Expo Android prebuild succeeds locally
- Gradle `assembleDebug` succeeds locally
- shared Android assets now use valid tracked PNGs instead of the earlier broken placeholders that blocked native asset generation
- emulator boot in this environment needs a writable non-`/run/user/...` runtime dir for the emulator's gRPC/JWK state, which `pnpm android:emulator` now sets up automatically
- local SDK CLI calls in this environment also need malformed empty proxy vars stripped; the emulator helper handles that before invoking Android tooling
- the lean AOSP API 34 x86_64 image (`pnpm android:emulator:aosp`) avoids the heaviest Google-app first-boot work and is the current best emulator fallback for local Starlog validation here
- first boot under software-emulated x86_64 can publish `package` before `sys.boot_completed` flips; the Android smoke helper now accepts that earlier package/activity-ready state and retries transient install failures during first-boot package-manager stabilization

The remaining native-mobile tasks now focus on on-device STT/LLM execution and iOS parity.
