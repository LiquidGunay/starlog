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
  - iOS share-extension path is now enabled in app config, but this document covers Android validation only

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

If your deep-link payload includes `source_url=` or other query params, the repo smoke
helpers now quote the remote Android shell command so `adb shell` does not split the URI
at `&`.

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
.\scripts\android_native_smoke_windows.ps1 -ReversePorts "8000"
```

Equivalent from the repo root in WSL:

```bash
pnpm test:android:smoke:windows
```

Optional Windows overrides:

```powershell
.\scripts\android_native_smoke_windows.ps1 `
  -Serial 9dd62e84 `
  -ReversePorts "8000" `
  -SkipInstall `
  -SkipDeepLink
```

Use the Windows-host script when:

- WSL `adb shell` hangs or streams truncate,
- the connected phone only appears in Windows `adb`,
- you need a reproducible physical-device flow for this repo's current host setup.

Both smoke helpers also accept an explicit dev-client URL now. That lets the script bootstrap the Expo dev build before it launches Starlog actions:

```bash
DEV_CLIENT_URL='exp+starlog://expo-development-client/?url=http%3A%2F%2F<WINDOWS_LAN_IP>%3A8081' \
REVERSE_PORTS=8000 \
./scripts/android_native_smoke.sh
```

When `DEV_CLIENT_URL` / `-DevClientUrl` is provided, the smoke helpers now skip the extra direct `MainActivity` launch because the Expo development client URL already opens the app.

### WSL physical-device Metro relay

On this host, the most reliable dev-client path has been:

1. start Expo in LAN mode,
2. expose WSL Metro through a Windows-side TCP relay,
3. only keep `adb reverse` for the API port instead of also reversing Metro.

Start the relay from WSL:

```bash
pnpm android:metro:relay:windows
```

This binds Windows `0.0.0.0:8081` and forwards it to the current WSL Metro server. The phone can then use your Windows LAN IP directly.

Start Expo with a stable LAN host identity:

```bash
cd apps/mobile
REACT_NATIVE_PACKAGER_HOSTNAME=<WINDOWS_LAN_IP> pnpm start:dev-client:lan
```

Validated host pattern here:

- Windows LAN IP: `192.168.0.102`
- WSL Metro target: current WSL interface IP on port `8081`
- `adb reverse`: keep `8000` for the API and avoid `8081` entirely on this host once the dev client is opened through its explicit LAN URL

Open the dev client with the repo helper instead of relying on the launcher home screen:

```bash
ADB=/mnt/c/Temp/android-platform-tools/platform-tools/adb.exe \
ADB_SERIAL=192.168.0.104:5555 \
METRO_HOST=<WINDOWS_LAN_IP> \
pnpm android:open:dev-client
```

Equivalent explicit URL form:

```text
exp+starlog://expo-development-client/?url=http://<WINDOWS_LAN_IP>:8081
```

This is the physical-phone path that validated cleanly here. When `tcp:8081` was still reversed, the phone could render the app but often showed a misleading `Cannot connect to Metro...` toast. Opening the explicit dev-client URL with only `tcp:8000` reversed removed that warning.

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

For this WSL + physical-phone setup, prefer the LAN form:

```bash
cd apps/mobile
REACT_NATIVE_PACKAGER_HOSTNAME=<WINDOWS_LAN_IP> pnpm start:dev-client:lan
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
