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
- Packaging-time artifact assertions:
  - `scripts/android_prepare_production_release.sh` now fails if the built QA APK does not report:
    - package `com.starlog.app`
    - requested `versionCode` / `versionName`
    - `application-label:'Starlog'`
- Signed production QA APK smoke commands:
  - WSL/Linux: `APP_VARIANT=production APK_PATH=/home/ubuntu/starlog_production_bundle/android/starlog-<v>-<n>-signed.apk ./scripts/android_native_smoke.sh`
  - Windows: `.\scripts\android_native_smoke_windows.ps1 -AppVariant production -ApkPath "C:\Temp\starlog-<v>-<n>-signed.apk"`
- Release-smoke guard before sharing the QA APK:
  - `cd /home/ubuntu/starlog && APK_PATH=/home/ubuntu/starlog_production_bundle/android/starlog-<v>-<n>-signed.apk ADB=/mnt/c/Temp/android-platform-tools/platform-tools/adb.exe ADB_SERIAL=<SERIAL> STAGE_TO_WINDOWS=1 pnpm test:android:release-smoke`
- Expected production launcher target for smoke/install validation:
  - package: `com.starlog.app`
  - activity: `com.starlog.app/com.starlog.app.dev.MainActivity`

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

From the packaged release manifest at `apps/mobile/android/app/build/intermediates/merged_manifests/release/AndroidManifest.xml`:

- `android.permission.ACCESS_NETWORK_STATE`
- `android.permission.INTERNET`
- `android.permission.MODIFY_AUDIO_SETTINGS`
- `android.permission.POST_NOTIFICATIONS`
- `android.permission.READ_EXTERNAL_STORAGE`
- `android.permission.RECEIVE_BOOT_COMPLETED`
- `android.permission.RECORD_AUDIO`
- `android.permission.USE_BIOMETRIC`
- `android.permission.USE_FINGERPRINT`
- `android.permission.VIBRATE`
- `android.permission.WAKE_LOCK`
- `android.permission.WRITE_EXTERNAL_STORAGE`
- `com.google.android.c2dm.permission.RECEIVE`
- `com.google.android.finsky.permission.BIND_GET_INSTALL_REFERRER_SERVICE`
- `com.starlog.app.DYNAMIC_RECEIVER_NOT_EXPORTED_PERMISSION`
- launcher badge/update permissions contributed by dependencies:
  - Samsung / HTC / Sony / Huawei / OPPO / EverythingMe badge permission set present in the merged release manifest

Release-manifest note:

- `android.permission.SYSTEM_ALERT_WINDOW` is debug-only on this branch and must not be listed in production/store disclosure.
- Review the exact merged release manifest before each store submission in case upstream libraries change the dependency-contributed badge/install-referrer permission set.

Data-safety submission draft:

- Data types handled by app flow:
  - User-provided text clips, URLs, uploaded/shared media, optional voice recordings.
- Platform/device signals handled by release dependencies:
  - notification delivery state and boot-complete restart hooks for alarms/briefing reminders.
- Purpose:
  - Capture/organization workflow, transcription/briefing/review features, and scheduled notification/alarm continuity after reboot.
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
- Signed production QA APK smoke targets the packaged release component:
  - `com.starlog.app/com.starlog.app.dev.MainActivity`
- Known blocker list reviewed:
  - `docs/ANDROID_RELEASE_QA_MATRIX.md`
- Go/No-Go:
  - `GO` only when the production AAB is signed, the signed QA APK smoke pass is clean, and no dev-client-only manifest/runtime behavior leaks into the release path.
