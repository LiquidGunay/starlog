# Preview Feedback Bundle

Last updated: 2026-03-30

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
  - `/home/ubuntu/starlog_preview_bundle/android/starlog-preview-0.1.0-preview.rc2-103.apk`
  - SHA-256: `0c9666daee9d4c6b99384de289a84a28b441b9d0a6d4f2271f387f251bdf8741`
- Linux desktop helper package:
  - `/home/ubuntu/starlog_preview_bundle/desktop/starlog-desktop-helper-v0.1.0-x86_64-linux-starlog-desktop-helper_0.1.0_amd64.deb`
  - SHA-256: `b92faffa698b30fc52a41ca02a98f249a3f108817e156d91d9b0413c7296120c`
- Desktop helper checksum file:
  - `/home/ubuntu/starlog_preview_bundle/desktop/checksums.sha256`
- Bundle checksum file:
  - `/home/ubuntu/starlog_preview_bundle/checksums.sha256`

Phone proof artifacts copied into the same bundle:

- `/home/ubuntu/starlog_preview_bundle/evidence/assistant-shell.png`
- `/home/ubuntu/starlog_preview_bundle/evidence/alarms-briefing.png`

## Hosted Starlog

- PWA: [https://starlog-web-production.up.railway.app](https://starlog-web-production.up.railway.app)
- API health: [https://starlog-api-production.up.railway.app/v1/health](https://starlog-api-production.up.railway.app/v1/health)

Use the existing Starlog passphrase for the single-user login/bootstrap flow already configured for
this deployment.

## Install now

### Phone

Fastest path on this machine when the Windows ADB daemon is healthy:

1. Use `/mnt/c/Temp/android-platform-tools/platform-tools/adb.exe`.
2. Install `C:\Temp\starlog-preview-0.1.0-preview.rc2-103.apk`.
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

### Browser/PWA

Open the hosted PWA directly:

- [https://starlog-web-production.up.railway.app/assistant](https://starlog-web-production.up.railway.app/assistant)

Recommended feedback pass:

1. Use the phone app for capture and alarms.
2. Use the hosted PWA for the main assistant/chat workflow.
3. Use the desktop helper only when you want local clipping from the laptop.

## Current proof status

- Fresh RC2 APK build: passed on 2026-03-27
- Fresh PWA release gate: passed on 2026-03-27
- Fresh hosted-smoke + Windows-helper validation bundle: passed on 2026-03-27
- Fresh installed-phone proof on this host: blocked on 2026-03-27 by Windows `adb.exe` daemon failure (`protocol fault ... connection reset`)
- Earlier phone assistant/alarms screenshots remain available from the prior proof import
- Hosted Railway web/API: live
- Desktop helper package: present and checksumed

Supporting references:

- [docs/RELEASE_HANDOFF.md](./RELEASE_HANDOFF.md)
- [docs/RELEASE_HANDOFF_RUNBOOK.md](./RELEASE_HANDOFF_RUNBOOK.md)
- [docs/evidence/mobile/wi-601-phone-proof.md](./evidence/mobile/wi-601-phone-proof.md)
- [docs/FINAL_PREVIEW_SIGNOFF.md](./FINAL_PREVIEW_SIGNOFF.md)
- [docs/ANDROID_RELEASE_QA_MATRIX.md](./ANDROID_RELEASE_QA_MATRIX.md)
