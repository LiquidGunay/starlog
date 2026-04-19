# Final Preview Signoff

Last updated: 2026-04-19

This document is the release-decision handoff for the current voice-native preview build. It is
intentionally narrower than [docs/VNEXT_TEST_BUNDLE.md](./VNEXT_TEST_BUNDLE.md): it states the
exact merged baseline, the validated surfaces, and the shortest path to the current installable
feedback bundle.

The repeatable release entrypoint is `python3 scripts/release_handoff.py`; the current bundle
snapshot is mirrored in [docs/RELEASE_HANDOFF.md](./RELEASE_HANDOFF.md).

## Signoff baseline

Current release baseline is the native alarm + local TTS morning-briefing refresh on top of the
current preview bundle flow.

This baseline currently corresponds to:

- commit `cdd44e4`
- branch target: `master`

## Current release decision

Status: `READY FOR DIRECT INSTALL FEEDBACK`

Interpretation:

- desktop helper is ready for operator testing on the target laptop
- hosted PWA is ready for operator testing on phone/laptop browsers
- a standalone PWA release bundle now exists for archive/self-host staging
- Android preview `0.1.0-preview.4 (104)` is built, installed, and proven on the connected phone
- the native fullscreen alarm and local TTS briefing handoff are both proven on the connected phone

This is ready to hand to the operator for immediate phone, hosted-web, standalone-PWA, and desktop
feedback.

## Green evidence in baseline

### PWA

- public web URL is live:
  - [https://starlog-web-production.up.railway.app](https://starlog-web-production.up.railway.app)
- public API health is live:
  - [https://starlog-api-production.up.railway.app/v1/health](https://starlog-api-production.up.railway.app/v1/health)
- release gate reference:
  - [docs/PWA_RELEASE_VERIFICATION_GATE.md](./PWA_RELEASE_VERIFICATION_GATE.md)
- hosted smoke reference:
  - [docs/PWA_HOSTED_SMOKE_CHECKLIST.md](./PWA_HOSTED_SMOKE_CHECKLIST.md)

Validated in the current pass:

- `bash ./scripts/pwa_release_gate.sh`
- `./scripts/package_pwa_release.sh`
- hosted smoke path remains valid against the live Railway deployment

### Desktop helper

- release runbook:
  - [docs/DESKTOP_HELPER_V1_RELEASE.md](./DESKTOP_HELPER_V1_RELEASE.md)
- current RC evidence includes:
  - authenticated localhost bridge discovery
  - local STT smoke on this host
  - real helper upload into a local API
  - fresh `.deb` package artifact rebuild on 2026-04-19

### Android

- primary build/runbook:
  - [docs/ANDROID_DEV_BUILD.md](./ANDROID_DEV_BUILD.md)
- QA matrix:
  - [docs/ANDROID_RELEASE_QA_MATRIX.md](./ANDROID_RELEASE_QA_MATRIX.md)
- current preview artifact:
  - `/home/ubuntu/starlog_preview_bundle/android/starlog-preview-0.1.0-preview.4-104.apk`
- staged Windows-visible artifact:
  - `C:\Temp\starlog-preview-0.1.0-preview.4-104.apk`
- version:
  - `0.1.0-preview.4 (104)`

Fresh proof from this host on 2026-04-19:

- APK install succeeded through Windows `adb.exe`
- native alarm preview rendered on the connected phone
- `Dismiss + Briefing` returned to `MainActivity`
- Android `TextToSpeech` bound and played local speech after dismiss
- proof artifacts:
  - `docs/evidence/mobile/wi-704-alarm-preview.png`
  - `docs/evidence/mobile/wi-704-alarm-after-dismiss.png`
  - `docs/evidence/mobile/wi-704-alarm-tts-proof.md`

## Local feedback bundle

Generated local bundle on this machine:

- `/home/ubuntu/starlog_preview_bundle`

Use [docs/PREVIEW_FEEDBACK_BUNDLE.md](./PREVIEW_FEEDBACK_BUNDLE.md) for the exact APK path, desktop
package path, standalone PWA bundle path, hosted Railway URLs, and install steps.

## Operator command

Run this from a native Windows PowerShell session in the repo root when you want to reinstall the
current Android preview artifact:

```powershell
.\scripts\android_native_smoke_windows.ps1 `
  -AdbPath "C:\Temp\android-platform-tools\platform-tools\adb.exe" `
  -Serial 9dd62e84 `
  -ApkPath "C:\Temp\starlog-preview-0.1.0-preview.4-104.apk" `
  -AppPackage "com.starlog.app.preview" `
  -AppActivity "com.starlog.app.preview/com.starlog.app.dev.MainActivity" `
  -ReversePorts "8000"
```

If the phone is not visible first, use the Android connection steps in:

- [AGENTS.md](../AGENTS.md)

## Follow-up docs

Keep this release decision aligned with:

- `docs/PREVIEW_FEEDBACK_BUNDLE.md`
- `docs/ANDROID_RELEASE_QA_MATRIX.md`
- `docs/STARLOG_SETUP_GUIDE.md`

## Recommended operator handoff order

1. Install the phone APK from the local preview bundle.
2. Test the native alarm + local TTS briefing flow on phone.
3. Test the hosted PWA immediately.
4. Install the desktop helper package from the local preview bundle.
5. Use the same Starlog passphrase against every surface.
