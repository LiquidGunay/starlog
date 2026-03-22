# WI-581 Android voice-native RC summary

Date: 2026-03-22
Worktree: `/tmp/starlog-android-rc-10NdP4`
Branch: `codex/android-release-candidate`

## Commands revalidated in this pass

### Mobile TypeScript compile

```bash
cd apps/mobile
/home/ubuntu/starlog/apps/mobile/node_modules/.bin/tsc --noEmit
```

Result: PASS

### Preview release APK build

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

Result: PASS

Artifact metadata:

- APK: `/home/ubuntu/starlog/apps/mobile/android/app/build/outputs/apk/release/app-release.apk`
- Size: `78805683` bytes
- Timestamp: `2026-03-22 14:02:45 +0000`
- SHA-256: `01a4dea0fb448e9ae02e5cdce39789c6a80efd5ec6f6c361ec225268743aaa5a`
- Package: `com.starlog.app.preview`
- Version: `0.1.0-preview.rc1 (102)`

## Connected-phone evidence carried forward

- Install + cold launch on the connected OPPO phone:
  - `docs/evidence/mobile/wi-402-install-log.txt`
  - `docs/evidence/mobile/wi-402-preview-launch.png`
- Railway-configured preview app on phone:
  - `docs/evidence/mobile/wi-403-preview-configured.png`
- Deep-link capture prefill on phone:
  - `docs/evidence/mobile/wi-403-deeplink-fresh-build.png`
- Spoken briefing render / offline playback pipeline:
  - job `job_9b11f48641054fb590f4239fdc5db835`
  - briefing `brf_cca0f68239ff411683488f7cb7009e05`
  - `audio_ref=media://med_1c8c2a34778c4d5cafdb2e3d566405ab`

## Current-shell blockers

### Local Linux ADB cannot see the device

```text
List of devices attached
```

Command:

```bash
~/.local/android/platform-tools/adb devices -l
```

### Windows ADB cannot be executed from this Linux subagent shell

```text
bash: line 1: /mnt/c/Temp/android-platform-tools/platform-tools/adb.exe: cannot execute binary file: Exec format error
```

Command:

```bash
/mnt/c/Temp/android-platform-tools/platform-tools/adb.exe devices -l
```

## Remaining phone-side proof still needed

- Fresh screenshot of the hold-to-talk flow on the current RC APK
- Fresh screenshot of the assistant/chat flow on the current RC APK
- Final Windows-side install + smoke log for version `0.1.0-preview.rc1 (102)`
