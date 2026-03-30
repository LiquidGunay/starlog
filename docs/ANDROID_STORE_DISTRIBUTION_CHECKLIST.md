# Android Store Distribution Checklist (WI-622)

Date: 2026-03-30

## 1) Release metadata template

- Release name: `Starlog v1 __`
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
    - Preview RC APK issues do not block the production AAB unless they reproduce on the signed production QA APK.

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
- Build the signed production artifacts with the canonical script:
  - `STARLOG_VERSION_NAME=<v> STARLOG_ANDROID_VERSION_CODE=<n> STARLOG_UPLOAD_STORE_FILE=/abs/path/starlog-upload.keystore STARLOG_UPLOAD_STORE_PASSWORD='***' STARLOG_UPLOAD_KEY_ALIAS=starlog_upload STARLOG_UPLOAD_KEY_PASSWORD='***' bash ./scripts/android_prepare_production_release.sh`
- Expected outputs:
  - `/home/ubuntu/starlog_production_bundle/android/starlog-<v>-<n>.aab`
  - `/home/ubuntu/starlog_production_bundle/android/starlog-<v>-<n>-signed.apk` (unless `STARLOG_BUILD_QA_APK=0`)
  - `/home/ubuntu/starlog_production_bundle/android/checksums.sha256`
  - `/home/ubuntu/starlog_production_bundle/android/starlog-<v>-<n>-release-metadata.json`
- Optional Windows staging for physical-phone QA:
  - add `STARLOG_STAGE_WINDOWS_APK=1`

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
  - production QA screenshots should come from the signed production APK, not the preview RC APK

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
- Runtime UI loads after reinstall on the signed production QA APK:
  - collect fresh evidence alongside the release
- Known blocker list reviewed:
  - `docs/ANDROID_RELEASE_QA_MATRIX.md`
- Go/No-Go:
  - `GO` only when the production AAB is signed, the signed QA APK smoke pass is clean, and no dev-client-only manifest/runtime behavior leaks into the release path.
