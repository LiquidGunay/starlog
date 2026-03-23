# Final Preview Signoff

Last updated: 2026-03-23

This document is the release-decision handoff for the current voice-native preview build. It is
intentionally narrower than [docs/VNEXT_TEST_BUNDLE.md](./VNEXT_TEST_BUNDLE.md): it states the
exact merged baseline, the validated surfaces, and the shortest path to the current installable
feedback bundle.

## Signoff baseline

Current merged baseline on `origin/master`:

- `#76` `docs(android): record current-master phone proof blocker`
- `#77` `test(web): stabilize hosted smoke route assertions`
- `#78` `docs: refresh next preview bundle`
- `#79` `docs(desktop): refresh current-master proof evidence`
- `#80` `docs: add cross-surface proof runbook`
- `#81` `fix(api): restore research router registration`
- `#82` `docs: add final preview signoff handoff`

This baseline corresponds to:

- commit `0e967da`
- branch target: `master`

## Current release decision

Status: `READY FOR FEEDBACK`

Interpretation:

- desktop helper is ready for operator testing on the target laptop
- hosted PWA is ready for operator testing on phone/laptop browsers
- Android preview RC artifact has been installed and smoke-validated on the connected phone
- one local preview bundle now exists for phone + laptop install against the live Railway deployment

This is ready to hand to the operator for immediate phone, desktop, and hosted-web feedback.

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
- hosted smoke stabilization landed in `#77`

### Desktop helper

- release runbook:
  - [docs/DESKTOP_HELPER_V1_RELEASE.md](./DESKTOP_HELPER_V1_RELEASE.md)
- current-master desktop proof landed in `#79`
- current RC evidence includes:
  - authenticated localhost bridge discovery
  - local STT smoke on this host
  - real helper upload into a local API

### Android

- primary build/runbook:
  - [docs/ANDROID_DEV_BUILD.md](./ANDROID_DEV_BUILD.md)
- QA matrix:
  - [docs/ANDROID_RELEASE_QA_MATRIX.md](./ANDROID_RELEASE_QA_MATRIX.md)
- current preview RC artifact:
  - `/home/ubuntu/starlog/apps/mobile/android/app/build/outputs/apk/release/app-release.apk`
- staged Windows-visible artifact:
  - `C:\Temp\starlog-preview-0.1.0-preview.rc1-102.apk`
- version:
  - `0.1.0-preview.rc1 (102)`

Already proven in earlier phone-connected passes and preserved in the QA matrix:

- preview package install/launch
- deep-link capture prefill
- Railway-backed preview configuration
- briefing render/offline playback pipeline

Fresh imported proof from `WI-601`:

- `docs/evidence/mobile/wi-601-assistant-shell.png`
- `docs/evidence/mobile/wi-601-alarms-briefing.png`
- `docs/evidence/mobile/wi-601-smoke-log.txt`
- `docs/evidence/mobile/wi-601-phone-proof.md`

## Local feedback bundle

Generated local bundle on this machine:

- `/home/ubuntu/starlog_preview_bundle`

Use [docs/PREVIEW_FEEDBACK_BUNDLE.md](./PREVIEW_FEEDBACK_BUNDLE.md) for the exact APK path, desktop
package path, hosted Railway URLs, and install steps.

## Operator command

Run this from a native Windows PowerShell session in the repo root:

```powershell
.\scripts\android_native_smoke_windows.ps1 `
  -AdbPath "C:\Temp\android-platform-tools\platform-tools\adb.exe" `
  -Serial 9dd62e84 `
  -ApkPath "C:\Temp\starlog-preview-0.1.0-preview.rc1-102.apk" `
  -AppPackage "com.starlog.app.preview" `
  -AppActivity "com.starlog.app.preview/com.starlog.app.dev.MainActivity" `
  -ReversePorts "8000"
```

If the phone is not visible first, use the Android connection steps in:

- [AGENTS.md](../AGENTS.md)

## Follow-up docs

The cross-surface proof runbook from `#80` is now part of the merged baseline. Keep the release
decision in this document aligned with `docs/VNEXT_TEST_BUNDLE.md` whenever later proof or QA docs
change.

## Recommended operator handoff order

1. Test the hosted PWA immediately.
2. Install the phone APK from the local preview bundle.
3. Install the desktop helper package from the local preview bundle.
4. Use the same Starlog account/passphrase against the live Railway deployment.
5. Record feedback on whichever surface feels closest to daily use.
