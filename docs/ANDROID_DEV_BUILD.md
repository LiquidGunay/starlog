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
  - any iOS share-extension config remains non-v1 and does not affect the Android validation path documented here

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
  - signed app bundle for Play upload
  - optional signed QA APK generated from the same signing inputs
  - uses `APP_VARIANT=production`
  - package: `com.starlog.app`

## Release signing + version policy

Release tasks now fail by default unless explicit release-signing credentials are provided.
This prevents accidental debug-keystore signing for production output.

Required signing inputs for release tasks:

- `STARLOG_UPLOAD_STORE_FILE`
- `STARLOG_UPLOAD_STORE_PASSWORD`
- `STARLOG_UPLOAD_KEY_ALIAS`
- `STARLOG_UPLOAD_KEY_PASSWORD`

Deterministic version inputs:

- `STARLOG_VERSION_NAME` (or `STARLOG_ANDROID_VERSION_NAME`) controls app version display.
- `STARLOG_ANDROID_VERSION_CODE` controls Android `versionCode`.
- `STARLOG_IOS_BUILD_NUMBER` controls iOS `buildNumber` (optional).

Production config verification example:

```bash
cd apps/mobile
APP_VARIANT=production \
STARLOG_VERSION_NAME=0.1.0 \
STARLOG_ANDROID_VERSION_CODE=1 \
npx expo config --json
```

Production release build example (signed AAB + signed QA APK):

```bash
STARLOG_VERSION_NAME=0.1.0 \
STARLOG_ANDROID_VERSION_CODE=105 \
STARLOG_UPLOAD_STORE_FILE=/abs/path/starlog-upload.keystore \
STARLOG_UPLOAD_STORE_PASSWORD='***' \
STARLOG_UPLOAD_KEY_ALIAS=starlog_upload \
STARLOG_UPLOAD_KEY_PASSWORD='***' \
bash ./scripts/android_prepare_production_release.sh
```

What the production script does:

- verifies the resolved Expo production config is `Starlog` / `com.starlog.app`
- requires real upload-keystore credentials before release tasks run
- builds the Play-upload artifact at `app/build/outputs/bundle/release/app-release.aab`
- also builds a signed release APK for device QA by default
- copies renamed artifacts plus `checksums.sha256` and metadata into `/home/ubuntu/starlog_production_bundle/android` by default

Useful overrides:

- `STARLOG_RELEASE_ARTIFACT_ROOT=/abs/path/out`
- `STARLOG_BUILD_QA_APK=0` to skip the signed QA APK
- `STARLOG_STAGE_WINDOWS_APK=1` to copy the signed QA APK into `/mnt/c/Temp`
- `STARLOG_WINDOWS_STAGE_DIR=/mnt/c/Temp/custom-dir`

Manual Gradle equivalent for the store-upload artifact only:

```bash
cd apps/mobile/android
APP_VARIANT=production \
STARLOG_VERSION_NAME=0.1.0 \
STARLOG_ANDROID_VERSION_CODE=1 \
STARLOG_UPLOAD_STORE_FILE=/abs/path/starlog-upload.keystore \
STARLOG_UPLOAD_STORE_PASSWORD='***' \
STARLOG_UPLOAD_KEY_ALIAS=starlog_upload \
STARLOG_UPLOAD_KEY_PASSWORD='***' \
./gradlew bundleRelease
```

Manual Gradle equivalent for the signed QA APK:

```bash
cd apps/mobile/android
APP_VARIANT=production \
STARLOG_VERSION_NAME=0.1.0 \
STARLOG_ANDROID_VERSION_CODE=1 \
STARLOG_UPLOAD_STORE_FILE=/abs/path/starlog-upload.keystore \
STARLOG_UPLOAD_STORE_PASSWORD='***' \
STARLOG_UPLOAD_KEY_ALIAS=starlog_upload \
STARLOG_UPLOAD_KEY_PASSWORD='***' \
./gradlew assembleRelease
```

For local non-production troubleshooting only, you can temporarily allow debug signing in
release tasks with:

```bash
STARLOG_ALLOW_DEBUG_RELEASE_SIGNING=true
```

Do not use that override for production artifacts.

## Production vs preview release paths

- Preview / RC distribution remains the sideloadable APK path for feedback devices.
- Production distribution now means a real signed `bundleRelease` AAB for Play Console plus an optional signed QA APK built from the same keystore inputs.
- The tracked Android `main` manifest no longer carries dev-client-only schemes or `DevSettingsActivity`; those are now debug-only so release packaging stays closer to the store runtime.

## Main-phone installable preview artifact (WI-402)

For this host and the current repo state, the selected installable daily-use artifact is a
`preview` release APK, not a debug build and not the production AAB.

- Output artifact: `apps/mobile/android/app/build/outputs/apk/release/app-release.apk`
- Selected package: `com.starlog.app.preview`
- Resolved launcher component on device: `com.starlog.app.preview/com.starlog.app.dev.MainActivity`
- Version name: `0.1.0-preview.1`
- Version code: `101`
- SHA-256: `95a2a568be36666b365a342f5651abdd6fdd776199b6da8c43435d57537abfd4`

Reproducible build command:

```bash
export JAVA_HOME="$HOME/.local/jdks/temurin-17"
export ANDROID_HOME="$HOME/.local/android"
export ANDROID_SDK_ROOT="$HOME/.local/android"
cd /home/ubuntu/starlog/apps/mobile/android
APP_VARIANT=preview \
STARLOG_VERSION_NAME=0.1.0-preview.1 \
STARLOG_ANDROID_VERSION_CODE=101 \
STARLOG_ALLOW_DEBUG_RELEASE_SIGNING=true \
./gradlew assembleRelease --console=plain
```

This debug-signing override is acceptable only for local internal installation on the main
phone. It does not replace the real release-signing inputs required for store or production
distribution:

- `STARLOG_UPLOAD_STORE_FILE`
- `STARLOG_UPLOAD_STORE_PASSWORD`
- `STARLOG_UPLOAD_KEY_ALIAS`
- `STARLOG_UPLOAD_KEY_PASSWORD`

On this WSL + Windows-host setup, the phone is reachable from Windows `adb.exe`, not from the
local Linux `adb`. That means the built APK must be staged into a Windows-visible path before
installation:

```bash
cp /home/ubuntu/starlog/apps/mobile/android/app/build/outputs/apk/release/app-release.apk \
  /mnt/c/Temp/starlog-preview-0.1.0-preview.1-101.apk

powershell.exe -NoProfile -Command "& { & 'C:\Temp\android-platform-tools\platform-tools\adb.exe' -s <SERIAL> install -r 'C:\Temp\starlog-preview-0.1.0-preview.1-101.apk' }"
```

Launch verification command on this host:

```bash
/mnt/c/Temp/android-platform-tools/platform-tools/adb.exe -s <SERIAL> \
  shell am start -W -n com.starlog.app.preview/com.starlog.app.dev.MainActivity
```

## Current voice-native RC artifact (WI-581)

Current preview release-candidate artifact:

- Output artifact: `/home/ubuntu/starlog/apps/mobile/android/app/build/outputs/apk/release/app-release.apk`
- Selected package: `com.starlog.app.preview`
- Version name: `0.1.0-preview.rc1`
- Version code: `102`
- SHA-256: `01a4dea0fb448e9ae02e5cdce39789c6a80efd5ec6f6c361ec225268743aaa5a`

Reproducible build command:

```bash
export JAVA_HOME="$HOME/.local/jdks/temurin-17"
export ANDROID_HOME="$HOME/.local/android"
export ANDROID_SDK_ROOT="$HOME/.local/android"
cd /home/ubuntu/starlog/apps/mobile/android
APP_VARIANT=preview \
STARLOG_VERSION_NAME=0.1.0-preview.rc1 \
STARLOG_ANDROID_VERSION_CODE=102 \
STARLOG_ALLOW_DEBUG_RELEASE_SIGNING=true \
./gradlew assembleRelease --console=plain
```

For this host, Linux `adb devices -l` may stay empty even when the physical phone is reachable
through the Windows platform-tools `adb.exe`. Use the Windows-host path below for reproducible
installs and keep the phone on that device path for the final screenshot proof.

For the current RC proof pass, the APK has already been staged into a Windows-visible path:

- `C:\Temp\starlog-preview-0.1.0-preview.rc1-102.apk`

Use this exact native Windows PowerShell command from the repo root for the remaining RC install
and screenshot proof:

```powershell
.\scripts\android_native_smoke_windows.ps1 `
  -AdbPath "C:\Temp\android-platform-tools\platform-tools\adb.exe" `
  -Serial 9dd62e84 `
  -ApkPath "C:\Temp\starlog-preview-0.1.0-preview.rc1-102.apk" `
  -AppPackage "com.starlog.app.preview" `
  -AppActivity "com.starlog.app.preview/com.starlog.app.dev.MainActivity" `
  -ReversePorts "8000"
```

Then capture and save:

- a hold-to-talk screenshot on the current RC APK
- an assistant/chat screenshot on the current RC APK
- the Windows smoke log for the RC install/run

## Current-master proof refresh (WI-590)

On 2026-03-22, the latest `origin/master` validation worktree resolved to the same commit already
present in the canonical checkout:

- `fbf6c44c8d42e825022d3a5b565860b4e5cbee7f`

The current preview artifact therefore remains:

- `/home/ubuntu/starlog/apps/mobile/android/app/build/outputs/apk/release/app-release.apk`
- staged host copy: `C:\Temp\starlog-preview-0.1.0-preview.rc1-102.apk`
- SHA-256: `01a4dea0fb448e9ae02e5cdce39789c6a80efd5ec6f6c361ec225268743aaa5a`

The remaining app-side artifact is unchanged, but the usable phone path on this host is now the
Windows platform-tools `adb.exe`; Linux `adb devices -l` still returns no connected phone here.

Use the native Windows-path install command above, then rerun the smoke via the note below when
you want another fresh physical-phone screenshot pass.

## Post-proof refresh note (WI-601)

On 2026-03-23, the main Codex shell on this host was again able to execute the Windows
platform-tools `adb.exe` path directly and complete a real physical-phone install/launch/smoke
pass against the current RC artifact.

Important path constraint that still applies:

- `adb.exe install` must use the native Windows APK path `C:\Temp\starlog-preview-0.1.0-preview.rc1-102.apk`
- the same run can then use `./scripts/android_native_smoke.sh` with `SKIP_INSTALL=1` for launch,
  deep-link, and text-share verification

Fresh evidence from that pass is now tracked in:

- `docs/evidence/mobile/wi-601-phone-proof.md`
- `docs/evidence/mobile/wi-601-smoke-log.txt`
- `docs/evidence/mobile/wi-601-assistant-shell.png`
- `docs/evidence/mobile/wi-601-alarms-briefing.png`

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
APP_VARIANT=production \
APK_PATH=/home/ubuntu/starlog_production_bundle/android/starlog-0.1.0-105-signed.apk \
./scripts/android_native_smoke.sh
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

Production QA APK flow:

```bash
APP_VARIANT=production \
APK_PATH=/home/ubuntu/starlog_production_bundle/android/starlog-0.1.0-105-signed.apk \
PRINT_CONFIG=1 \
./scripts/android_native_smoke.sh
```

Expected production resolution:

- package: `com.starlog.app`
- launcher activity: `com.starlog.app/com.starlog.app.dev.MainActivity`

Windows equivalent:

```powershell
.\scripts\android_native_smoke_windows.ps1 `
  -AppVariant production `
  -ApkPath "C:\Temp\starlog-0.1.0-105-signed.apk" `
  -PrintConfig
```

For an actual signed-production-QA smoke pass, remove `PRINT_CONFIG` / `-PrintConfig` and keep the same `APP_VARIANT` or `-AppVariant production` override.

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
Any iOS share-extension configuration is out of scope for v1 and does not affect this Android path.

## Point the app at the backend

Inside the app:

- local testing: set API base to `http://<LAN_IP>:8000`
- hosted testing: set API base to your Railway public API URL

The current mobile app stores this value locally, so you can switch between local and hosted backends without rebuilding.

## Current native limitations

This path is working now, but it does **not** yet implement:

- fully on-phone Whisper execution
- iOS share-extension patching/hardening as part of the v1 distribution path (Android is the active priority path)

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

The remaining native-mobile tasks for v1 now focus on on-device STT/LLM execution and Android polish. iOS parity is outside the current v1 distribution scope.
