# Final Preview Signoff

Last updated: 2026-03-23

This document is the release-decision handoff for the current voice-native preview build. It is
intentionally narrower than [docs/VNEXT_TEST_BUNDLE.md](./VNEXT_TEST_BUNDLE.md): it states the
exact merged baseline, the validated surfaces, the remaining blocker, and the shortest path to a
fully closed signoff once the pending phone proof is imported.

## Signoff baseline

Current merged baseline on `origin/master`:

- `#76` `docs(android): record current-master phone proof blocker`
- `#77` `test(web): stabilize hosted smoke route assertions`
- `#78` `docs: refresh next preview bundle`
- `#79` `docs(desktop): refresh current-master proof evidence`
- `#80` `docs: add cross-surface proof runbook`
- `#81` `fix(api): restore research router registration`

This baseline corresponds to:

- commit `c6da657`
- branch target: `master`

## Current release decision

Status: `CONDITIONALLY READY`

Interpretation:

- desktop helper is ready for operator testing on the target laptop
- hosted PWA is ready for operator testing on phone/laptop browsers
- Android preview RC artifact is built and staged
- full release closure is still blocked on one external proof-import step from `WI-601`

This is good enough to hand to the operator for immediate web/desktop feedback, but it is not yet
a fully closed phone-backed release proof.

## Green evidence in baseline

### PWA

- public web URL is live:
  - [https://starlog-web-production.up.railway.app](https://starlog-web-production.up.railway.app)
- public API health is live:
  - [https://starlog-api-production.up.railway.app/v1/health](https://starlog-api-production.up.railway.app/v1/health)
- release gate reference:
  - [docs/PWA_RELEASE_VERIFICATION_GATE.md](/tmp/starlog-final-signoff/docs/PWA_RELEASE_VERIFICATION_GATE.md)
- hosted smoke reference:
  - [docs/PWA_HOSTED_SMOKE_CHECKLIST.md](/tmp/starlog-final-signoff/docs/PWA_HOSTED_SMOKE_CHECKLIST.md)

Validated in the current pass:

- `bash ./scripts/pwa_release_gate.sh`
- hosted smoke stabilization landed in `#77`

### Desktop helper

- release runbook:
  - [docs/DESKTOP_HELPER_V1_RELEASE.md](/tmp/starlog-final-signoff/docs/DESKTOP_HELPER_V1_RELEASE.md)
- current-master desktop proof landed in `#79`
- current RC evidence includes:
  - authenticated localhost bridge discovery
  - local STT smoke on this host
  - real helper upload into a local API

### Android

- primary build/runbook:
  - [docs/ANDROID_DEV_BUILD.md](/tmp/starlog-final-signoff/docs/ANDROID_DEV_BUILD.md)
- QA matrix:
  - [docs/ANDROID_RELEASE_QA_MATRIX.md](/tmp/starlog-final-signoff/docs/ANDROID_RELEASE_QA_MATRIX.md)
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

Still missing for full closure in this pass:

- fresh physical-phone screenshot proof for:
  - hold-to-talk
  - assistant/chat
  - offline briefing playback
- imported Windows smoke log from the current RC run

## Exact blocker

The remaining blocker is the pending current-master physical-phone proof import:

- Windows-host `adb.exe` is now reachable from this shell and sees the phone
- Linux `adb` in this shell still does not see the connected phone
- the current RC still needs a fresh smoke log and screenshot set imported under `WI-601`

This blocker is already documented in:

- [docs/ANDROID_DEV_BUILD.md](/tmp/starlog-final-signoff/docs/ANDROID_DEV_BUILD.md)
- [docs/ANDROID_RELEASE_QA_MATRIX.md](/tmp/starlog-final-signoff/docs/ANDROID_RELEASE_QA_MATRIX.md)
- merged PR `#76`

## WI-601 completion contract

`WI-601` is the remaining closure item for this signoff. To complete it, import all of the
following into the repo after the native Windows run:

1. Windows smoke log for the RC APK install/run.
2. Hold-to-talk screenshot on the physical phone.
3. Assistant/chat screenshot on the physical phone.
4. Offline briefing playback screenshot on the physical phone.
5. Updated Android QA matrix rows and any evidence-path references.
6. A short note confirming whether the current `C:\Temp\starlog-preview-0.1.0-preview.rc1-102.apk`
   artifact was the one used for the proof run.

Once those artifacts are committed, this signoff can move from `CONDITIONALLY READY` to `READY`.

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

- [AGENTS.md](/tmp/starlog-final-signoff/AGENTS.md)

## Follow-up docs

The cross-surface proof runbook from `#80` is now part of the merged baseline. Keep the release
decision in this document aligned with `docs/VNEXT_TEST_BUNDLE.md` whenever later proof or QA docs
change.

## Recommended operator handoff order

1. Test the hosted PWA immediately.
2. Test the desktop helper immediately.
3. Run the native Windows Android smoke command.
4. Import the phone artifacts under `WI-601`.
5. Reclassify this preview as `READY`.
