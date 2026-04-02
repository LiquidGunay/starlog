# Android Store Distribution Checklist (WI-305)

Date: 2026-03-15

## 1) Release metadata template

- Release name: `Starlog v1 RC __`
- Package: `com.starlog.app`
- Version name: `STARLOG_VERSION_NAME` (example `0.1.0`)
- Version code: `STARLOG_ANDROID_VERSION_CODE` (integer, monotonic)
- Track: `Internal testing` -> `Closed testing` -> `Production`
- Release notes template:
  - New in this build:
    - Share capture (text/url/image/file/audio) with retry queue.
    - Quick triage and review on phone.
    - Alarm + offline briefing playback pipeline.
  - Reliability fixes:
    - Secure token storage abstraction.
    - Native module/runtime hardening for Android dev builds.
  - Known issues:
    - Dev-client Metro transport toast can appear during local debug sessions.

## 2) Build + signing checklist

- Signing/env inputs present:
  - `STARLOG_UPLOAD_STORE_FILE`
  - `STARLOG_UPLOAD_STORE_PASSWORD`
  - `STARLOG_UPLOAD_KEY_ALIAS`
  - `STARLOG_UPLOAD_KEY_PASSWORD`
- Deterministic version inputs set:
  - `STARLOG_VERSION_NAME` or `STARLOG_ANDROID_VERSION_NAME`
  - `STARLOG_ANDROID_VERSION_CODE`
- Verify production config:
  - `cd apps/mobile && APP_VARIANT=production STARLOG_VERSION_NAME=<v> STARLOG_ANDROID_VERSION_CODE=<n> ./node_modules/.bin/expo config --json`
- Build debug verification APK (device QA):
  - `cd apps/mobile/android && ./gradlew assembleDebug`
- Build production AAB path (store upload artifact):
  - `cd apps/mobile/android && APP_VARIANT=production ./gradlew bundleRelease`
- Build sideload QA APK path:
  - `cd apps/mobile/android && APP_VARIANT=production STARLOG_VERSION_NAME=<v> STARLOG_ANDROID_VERSION_CODE=<n> STARLOG_ALLOW_DEBUG_RELEASE_SIGNING=true ./gradlew assembleRelease --console=plain`
- Run the release smoke gate before sideloading the APK onto a phone:
  - `cd /home/ubuntu/starlog && APK_PATH=/home/ubuntu/starlog_production_bundle/android/starlog-0.1.0-108.apk ADB=/mnt/c/Temp/android-platform-tools/platform-tools/adb.exe ADB_SERIAL=9dd62e84 STAGE_TO_WINDOWS=1 pnpm test:android:release-smoke`

## 3) Icon/screenshot asset audit

- App icons/splash in repo:
  - `apps/mobile/assets/icon.png` (`512x512`)
  - `apps/mobile/assets/adaptive-icon.png` (`512x512`)
  - `apps/mobile/assets/splash.png` (`512x512`)
- QA evidence screenshots collected:
  - `docs/evidence/mobile/wi-303-smoke-after-force-stop.png`
  - `docs/evidence/mobile/wi-303-smoke-localhost-reverse.png`
  - `docs/evidence/mobile/wi-303-smoke-after-reinstall.png`
  - `docs/evidence/mobile/wi-303-smoke-final.png`

## 4) Permissions + data safety inventory

From `apps/mobile/android/app/src/main/AndroidManifest.xml`:

- `android.permission.INTERNET`
- `android.permission.MODIFY_AUDIO_SETTINGS`
- `android.permission.READ_EXTERNAL_STORAGE`
- `android.permission.RECORD_AUDIO`
- `android.permission.SYSTEM_ALERT_WINDOW`
- `android.permission.VIBRATE`
- `android.permission.WRITE_EXTERNAL_STORAGE`

Data-safety submission draft:

- Data types handled by app flow:
  - User-provided text clips, URLs, uploaded/shared media, optional voice recordings.
- Purpose:
  - Capture/organization workflow, transcription/briefing/review features.
- Transport/storage:
  - API transport to Starlog backend when online.
  - Local queued/offline persistence on-device.
- User controls:
  - Manual capture/actions, queue flush/retry, account/session token management.

## 5) Pre-upload QA gate

- Device smoke script passes:
  - `docs/evidence/mobile/wi-303-smoke-log.txt`
- Runtime UI loads after reinstall:
  - `docs/evidence/mobile/wi-303-smoke-after-reinstall.png`
- Known blocker list reviewed:
  - `docs/ANDROID_RELEASE_QA_MATRIX.md`
- Go/No-Go:
  - `GO` only when production AAB is signed and Metro/dev-client-only warnings are absent from release runtime path.
