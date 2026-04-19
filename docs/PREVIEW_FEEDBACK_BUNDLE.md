# Preview Feedback Bundle

Last updated: 2026-04-19

This bundle is refreshed and published through `python3 scripts/release_handoff.py`. The current
release snapshot lives in [`docs/RELEASE_HANDOFF.md`](./RELEASE_HANDOFF.md).

This is the shortest path to install Starlog on your phone and laptop and point it at the live
Railway deployment for real feedback.

## Local bundle

Generated bundle root on this machine:

- `/home/ubuntu/starlog_preview_bundle`
- `/home/ubuntu/starlog-preview-feedback-bundle-20260327.tar.gz` (compressed copy of the same bundle, if regenerated)

Installable artifacts inside it:

- Android preview APK:
  - `/home/ubuntu/starlog_preview_bundle/android/starlog-preview-0.1.0-preview.4-104.apk`
  - SHA-256: `0b1bf8850bae7e9cb20346d2563a8e0ce039f850b35cbc958c1bac9f92226f1b`
- Linux desktop helper package:
  - `/home/ubuntu/starlog_preview_bundle/desktop/starlog-desktop-helper-v0.1.0-x86_64-linux-starlog-desktop-helper_0.1.0_amd64.deb`
  - SHA-256: `af41ea87e4dc6389574bf636d1010c0c739ad3580b2c2fb7b9e6976edcbc6e46`
- PWA standalone bundle:
  - `/home/ubuntu/starlog_preview_bundle/pwa/starlog-pwa-v0.1.0-standalone.tar.gz`
  - SHA-256: `85a391c2cbb0518c0a53e286b4ac01f99dd5b9516d078f2dea7988bceb15fcd1`
- Desktop helper checksum file:
  - `/home/ubuntu/starlog_preview_bundle/desktop/checksums.sha256`
- Bundle checksum file:
  - `/home/ubuntu/starlog_preview_bundle/checksums.sha256`

Phone proof artifacts copied into the same bundle:

- `/home/ubuntu/starlog_preview_bundle/evidence/assistant-shell.png`
- `/home/ubuntu/starlog_preview_bundle/evidence/alarms-briefing.png`
- `/home/ubuntu/starlog_preview_bundle/docs/evidence/mobile/wi-704-alarm-preview.png`
- `/home/ubuntu/starlog_preview_bundle/docs/evidence/mobile/wi-704-alarm-after-dismiss.png`

## Hosted Starlog

- PWA: [https://starlog-web-production.up.railway.app](https://starlog-web-production.up.railway.app)
- API health: [https://starlog-api-production.up.railway.app/v1/health](https://starlog-api-production.up.railway.app/v1/health)

Use the existing Starlog passphrase for the single-user login/bootstrap flow already configured for
this deployment.

## Install now

### Phone

Fastest path on this machine when the Windows ADB daemon is healthy:

1. Use `/mnt/c/Temp/android-platform-tools/platform-tools/adb.exe`.
2. Install `C:\Temp\starlog-preview-0.1.0-preview.4-104.apk`.
3. Launch `com.starlog.app.preview/com.starlog.app.dev.MainActivity`.

If you prefer manual sideloading, copy the APK from `/home/ubuntu/starlog_preview_bundle/android/`
to the phone and install it there.

### Laptop

Linux desktop helper install:

```bash
sudo apt install /home/ubuntu/starlog_preview_bundle/desktop/starlog-desktop-helper-v0.1.0-x86_64-linux-starlog-desktop-helper_0.1.0_amd64.deb
```

Then follow [DESKTOP_HELPER_MAIN_LAPTOP_SETUP.md](./DESKTOP_HELPER_MAIN_LAPTOP_SETUP.md) for bridge
token/runtime setup if you want local capture or local voice routing.

### PWA standalone bundle

Extract and run:

```bash
tar -xzf /home/ubuntu/starlog_preview_bundle/pwa/starlog-pwa-v0.1.0-standalone.tar.gz
cd starlog-pwa-v0.1.0
PORT=3000 HOSTNAME=0.0.0.0 node apps/web/server.js
```

### Browser/PWA

Open the hosted PWA directly:

- [https://starlog-web-production.up.railway.app/assistant](https://starlog-web-production.up.railway.app/assistant)

Recommended feedback pass:

1. Use the phone app for capture and alarms.
2. Use the hosted PWA for the main assistant/chat workflow.
3. Use the desktop helper only when you want local clipping from the laptop.
4. Use [STARLOG_SETUP_GUIDE.md](./STARLOG_SETUP_GUIDE.md) for the cross-surface install and login flow.

## Current proof status

- Fresh preview.4 APK build: passed on 2026-04-19
- Fresh standalone PWA bundle build: passed on 2026-04-19
- Fresh desktop helper package build: passed on 2026-04-19
- Fresh installed-phone alarm + local TTS proof: passed on 2026-04-19
- Hosted Railway web/API: live
- Desktop helper package: present and checksumed

Supporting references:

- [docs/RELEASE_HANDOFF.md](./RELEASE_HANDOFF.md)
- [docs/RELEASE_HANDOFF_RUNBOOK.md](./RELEASE_HANDOFF_RUNBOOK.md)
- [docs/evidence/mobile/wi-601-phone-proof.md](./evidence/mobile/wi-601-phone-proof.md)
- [docs/evidence/mobile/wi-704-alarm-tts-proof.md](./evidence/mobile/wi-704-alarm-tts-proof.md)
- [docs/FINAL_PREVIEW_SIGNOFF.md](./FINAL_PREVIEW_SIGNOFF.md)
- [docs/ANDROID_RELEASE_QA_MATRIX.md](./ANDROID_RELEASE_QA_MATRIX.md)
