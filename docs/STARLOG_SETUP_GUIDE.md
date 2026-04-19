# Starlog Setup Guide

Last updated: 2026-04-19

This is the shortest operator guide for getting Starlog running across phone, browser/PWA, and the
desktop helper from the current preview release.

## Current release inputs

- Hosted PWA: [https://starlog-web-production.up.railway.app](https://starlog-web-production.up.railway.app)
- Hosted API health: [https://starlog-api-production.up.railway.app/v1/health](https://starlog-api-production.up.railway.app/v1/health)
- Android preview APK:
  - `/home/ubuntu/starlog_preview_bundle/android/starlog-preview-0.1.0-preview.4-104.apk`
  - SHA-256: `0b1bf8850bae7e9cb20346d2563a8e0ce039f850b35cbc958c1bac9f92226f1b`
- Desktop helper package:
  - `/home/ubuntu/starlog_preview_bundle/desktop/starlog-desktop-helper-v0.1.0-x86_64-linux-starlog-desktop-helper_0.1.0_amd64.deb`
  - SHA-256: `af41ea87e4dc6389574bf636d1010c0c739ad3580b2c2fb7b9e6976edcbc6e46`
- PWA standalone bundle:
  - `/home/ubuntu/starlog_preview_bundle/pwa/starlog-pwa-v0.1.0-standalone.tar.gz`
  - SHA-256: `85a391c2cbb0518c0a53e286b4ac01f99dd5b9516d078f2dea7988bceb15fcd1`

## Fastest feedback setup

1. Use the hosted PWA for the main Assistant thread.
2. Install the Android preview APK on the phone for alarms, briefing playback, and mobile capture.
3. Install the desktop helper on the laptop only if you want local clipboard/screenshot capture.
4. Use the same Starlog passphrase on every surface.

## Phone setup

### Install

From this host, the working install path is the Windows ADB binary:

```bash
cp /home/ubuntu/starlog/apps/mobile/android/app/build/outputs/apk/release/app-release.apk \
  /mnt/c/Temp/starlog-preview-0.1.0-preview.4-104.apk

/mnt/c/Temp/android-platform-tools/platform-tools/adb.exe -s <SERIAL> \
  install -r "C:\\Temp\\starlog-preview-0.1.0-preview.4-104.apk"
```

Manual sideload also works if you copy the APK to the phone and install it there.

### First launch

1. Open `com.starlog.app.preview/com.starlog.app.dev.MainActivity`.
2. Enter the Starlog API base only if the phone is not already pointed at the hosted API.
3. Sign in with the single-user passphrase, or use `Set Up Starlog` once on a new instance.

### Morning alarm + local TTS briefing

1. Open `Planner`.
2. In the briefing section, enter or edit the local morning briefing draft.
3. Save the local edit so the phone caches the exact text that should be spoken.
4. Choose the alarm time and schedule the morning alarm.
5. When the alarm fires, tap `Dismiss + Briefing`.
6. The phone should return to Starlog and play the cached briefing through the local Android TTS engine.

What is verified in the current pass:

- the fullscreen native alarm renders on the phone
- `Dismiss + Briefing` returns to the app
- Android binds `com.google.android.tts` and plays the local spoken briefing after dismiss

Supporting proof:

- [docs/evidence/mobile/wi-704-alarm-preview.png](/home/ubuntu/starlog/docs/evidence/mobile/wi-704-alarm-preview.png)
- [docs/evidence/mobile/wi-704-alarm-after-dismiss.png](/home/ubuntu/starlog/docs/evidence/mobile/wi-704-alarm-after-dismiss.png)
- [docs/evidence/mobile/wi-704-alarm-tts-proof.md](/home/ubuntu/starlog/docs/evidence/mobile/wi-704-alarm-tts-proof.md)

## Browser / PWA setup

### Hosted path

Open:

- [https://starlog-web-production.up.railway.app/assistant](https://starlog-web-production.up.railway.app/assistant)

Then:

1. Sign in with the same passphrase used on the phone.
2. Use `Assistant` as the default surface.
3. Pin or install the browser app if you want the PWA shell on laptop or phone.

### Standalone release bundle

The GitHub release also carries a standalone web bundle for offline handoff or self-hosted staging:

```bash
tar -xzf /home/ubuntu/starlog_preview_bundle/pwa/starlog-pwa-v0.1.0-standalone.tar.gz
cd starlog-pwa-v0.1.0
PORT=3000 HOSTNAME=0.0.0.0 node apps/web/server.js
```

Then point the UI at the desired Starlog API base from the login/setup screen.

## Desktop helper setup

Install on Linux:

```bash
sudo apt install /home/ubuntu/starlog_preview_bundle/desktop/starlog-desktop-helper-v0.1.0-x86_64-linux-starlog-desktop-helper_0.1.0_amd64.deb
```

Then follow:

- [docs/DESKTOP_HELPER_MAIN_LAPTOP_SETUP.md](/home/ubuntu/starlog/docs/DESKTOP_HELPER_MAIN_LAPTOP_SETUP.md)

Use the helper when you want:

- clipboard capture
- screenshot capture
- quick local handoff into Library or Assistant

## Self-host / local stack

For a full local Starlog stack:

```bash
./scripts/dev_stack.sh
```

That starts:

- API on `http://0.0.0.0:8000`
- web app on `http://localhost:3000`

For LAN testing from a phone:

```bash
./scripts/dev_stack.sh --lan
```

Detailed local/mobile references:

- [README.md](/home/ubuntu/starlog/README.md)
- [docs/PHONE_SETUP.md](/home/ubuntu/starlog/docs/PHONE_SETUP.md)
- [docs/ANDROID_DEV_BUILD.md](/home/ubuntu/starlog/docs/ANDROID_DEV_BUILD.md)
