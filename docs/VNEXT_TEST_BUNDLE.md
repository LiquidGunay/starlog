# vNext Test Bundle

This is the operator handoff for the current semi-stable preview bundle on current `origin/master`
baseline `0193c96` after the 2026-03-27 semistable release-handoff refresh.

## Current green baseline

Validated locally from the refreshed release worktree on 2026-03-27:

- Android preview APK build:
  - `APP_VARIANT=preview STARLOG_VERSION_NAME=0.1.0-preview.rc2 STARLOG_ANDROID_VERSION_CODE=103 STARLOG_ALLOW_DEBUG_RELEASE_SIGNING=true ./gradlew assembleRelease --console=plain`
- PWA release gate:
  - `bash ./scripts/pwa_release_gate.sh`
  - PASS at `2026-03-27T18:17:09Z`
- Fresh validation bundle:
  - `bash ./scripts/cross_surface_proof_bundle.sh 20260327T181800Z`
  - hosted smoke: passed
  - Windows helper smoke/probes/screenshots: passed
  - PWA visual proof: skipped because that lane was disabled for this run
  - Android smoke/screenshots: skipped because those lanes were disabled for this run
  - separate host checks then found the Windows ADB daemon unhealthy before a fresh installed-phone rerun could be attempted

The current release baseline is ready for PWA testing now and for Android sideload testing from the
fresh RC2 APK. The remaining release-evidence gaps are a fresh PWA visual-proof rerun and a fresh
installed-phone proof run from this host after the Windows ADB daemon is healthy again.

## Install and test surfaces

### PWA

- Hosted URL: [starlog-web-production.up.railway.app](https://starlog-web-production.up.railway.app)
- API health: [starlog-api-production.up.railway.app/v1/health](https://starlog-api-production.up.railway.app/v1/health)
- Primary route: `/assistant`
- Secondary checks:
  - `/artifacts`
  - `/integrations`
  - `/ai-jobs`
- Read first:
  - `README.md`
  - `docs/PWA_GO_LIVE_RUNBOOK.md`
  - `docs/PWA_HOSTED_SMOKE_CHECKLIST.md`
  - `docs/AI_VALIDATION_SMOKE_MATRIX.md`
  - `docs/CROSS_SURFACE_PROOF.md`

What to judge:

- chat feels like the main operating surface,
- hold-to-talk states read clearly,
- inline cards stay readable after repeated voice turns,
- cross-surface proof artifacts line up with the isolated API evidence in `docs/CROSS_SURFACE_PROOF.md`.

### Android phone

- Primary doc: `docs/ANDROID_DEV_BUILD.md`
- Supporting docs:
  - `docs/PHONE_SETUP.md`
  - `docs/ANDROID_RELEASE_QA_MATRIX.md`
  - `docs/PREVIEW_FEEDBACK_BUNDLE.md`
- Current preview RC2 artifact:
  - `/home/ubuntu/starlog_preview_bundle/android/starlog-preview-0.1.0-preview.rc2-103.apk`
  - fresh worktree build source: `/home/ubuntu/starlog-worktrees/validation-artifact-bundle/apps/mobile/android/app/build/outputs/apk/release/app-release.apk`
  - staged Windows copy: `C:\Temp\starlog-preview-0.1.0-preview.rc2-103.apk`

Core phone checks:

- install and launch the preview RC2,
- verify the assistant/chat shell,
- verify the alarms / briefing surface,
- use the live Railway deployment for real feedback,
- capture any follow-up screenshots/logs you want from your own usage pass.

### Desktop helper

- Primary docs:
  - `docs/DESKTOP_HELPER_MAIN_LAPTOP_SETUP.md`
  - `docs/DESKTOP_HELPER_V1_RELEASE.md`
  - `docs/LOCAL_AI_WORKER.md`
- Core checks:
  - launch helper popup and full surface,
  - verify bridge health,
  - verify one capture path,
  - verify local voice diagnostics and local STT smoke if the host runtime is installed.

## Local preview bundle

Generated bundle path on this machine:

- `/home/ubuntu/starlog_preview_bundle`

Install from:

- phone APK: `/home/ubuntu/starlog_preview_bundle/android/starlog-preview-0.1.0-preview.rc2-103.apk`
- laptop `.deb`: `/home/ubuntu/starlog_preview_bundle/desktop/starlog-desktop-helper-v0.1.0-x86_64-linux-starlog-desktop-helper_0.1.0_amd64.deb`

## Remaining drift to call out

- Hosted smoke drift still exists operationally. The latest isolated rerun passed, but prior runs
  have drifted because overlapping or stale local `next build` / `next start` processes can poison
  `bash ./scripts/pwa_hosted_smoke.sh`. Treat hosted smoke as green only when run in isolation.
- Linux `adb` still does not see the phone on this host; the intended physical-device path remains
  the Windows platform-tools `adb.exe`.
- On the 2026-03-27 semistable pass, the Windows `adb.exe` path itself became unhealthy and returned
  `protocol fault (couldn't read status): connection reset`, so a fresh installed-phone screenshot
  proof was not captured from this host even though the RC2 APK built and staged successfully.
- The cross-surface host-local proof is now documented in `docs/CROSS_SURFACE_PROOF.md`; the
  canonical bundle path is `artifacts/cross-surface-proof/<timestamp>/`, and on the recorded run,
  the built PWA shell loaded and rendered the helper-uploaded artifact, but the seeded
  assistant-thread marker still required API-level evidence rather than a visible transcript render.

## Fast pre-handoff verification

```bash
./scripts/ci_smoke_matrix.sh
bash ./scripts/pwa_release_gate.sh
```

If you are touching hosted web behavior, also rerun:

```bash
bash ./scripts/pwa_hosted_smoke.sh
```

Run that hosted smoke in isolation to avoid stale local web-server drift.

## Visual references

- `/home/ubuntu/starlog_extras/starlog_unified_design_april_2026/starlog_design_document_design.md`
- `/home/ubuntu/starlog_extras/starlog_unified_design_april_2026/main_room_chat/screen.png`
- `/home/ubuntu/starlog_extras/starlog_unified_design_april_2026/knowledge_base/screen.png`
- `/home/ubuntu/starlog_extras/starlog_unified_design_april_2026/srs_review/screen.png`
- `/home/ubuntu/starlog_extras/starlog_unified_design_april_2026/agenda_rituals/screen.png`

## Feedback to ask for

- Did chat/voice feel like the main control surface?
- Which surface felt closest to daily use: hosted PWA, phone, or desktop helper?
- Which parts still felt like debug tooling rather than a product?
- Which failure or setup step was confusing enough that the docs should change before the next pass?
