# vNext Test Bundle

This is the operator handoff for the next voice-native preview build on current `origin/master`
(`c10a800`, merged Android blocker doc [#76](https://github.com/LiquidGunay/starlog/pull/76)).

## Current green baseline

Validated locally from a fresh master worktree with shared-state linking:

- API baseline: `39 passed` on the current validation suite used for the release pass.
- Web typecheck: `cd apps/web && ./node_modules/.bin/tsc --noEmit`
- Mobile typecheck: `cd apps/mobile && ./node_modules/.bin/tsc --noEmit`
- Desktop helper targeted smoke: `./node_modules/.bin/playwright test tools/desktop-helper/tests/helper.spec.ts --grep "quick popup can switch to workspace in browser fallback"`
- PWA release gate: `bash ./scripts/pwa_release_gate.sh`
- OpenAI runtime smoke with `.env` loaded: `cd services/ai-runtime && uv run --project . python scripts/openai_smoke.py`

The current release baseline is good enough for the next preview handoff, but it is not yet a
fully closed release proof because one phone step still has to be run from the Windows host and
hosted-smoke drift still needs watching.

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
- Current preview RC artifact:
  - `/home/ubuntu/starlog/apps/mobile/android/app/build/outputs/apk/release/app-release.apk`
  - staged Windows copy: `C:\Temp\starlog-preview-0.1.0-preview.rc1-102.apk`

Core phone checks:

- install and launch the preview RC,
- verify one hold-to-talk turn,
- verify one assistant/chat turn,
- verify one offline briefing playback path,
- capture screenshots/logs.

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

## Required host-external phone step

The remaining phone proof is blocked by host environment, not by the current app build. Per merged
Android blocker doc [#76](https://github.com/LiquidGunay/starlog/pull/76), this Linux Codex shell
still cannot execute `powershell.exe`, `cmd.exe`, or the Windows `adb.exe` that can actually reach
the connected phone.

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

Save:

- a hold-to-talk screenshot,
- an assistant/chat screenshot,
- an offline briefing playback screenshot,
- the Windows smoke log.

## Remaining drift to call out

- Hosted smoke drift still exists operationally. The latest isolated rerun passed, but prior runs
  have drifted because overlapping or stale local `next build` / `next start` processes can poison
  `bash ./scripts/pwa_hosted_smoke.sh`. Treat hosted smoke as green only when run in isolation.
- The phone proof is still host-external. The preview bundle is ready for user testing on web and
  desktop immediately, but the final fresh physical-phone screenshots still require the Windows-side
  operator step above.
- The cross-surface host-local proof is now documented in `docs/CROSS_SURFACE_PROOF.md`; on the
  recorded run, the built PWA shell loaded and rendered the helper-uploaded artifact, but the
  seeded assistant-thread marker still required API-level evidence rather than a visible transcript
  render.

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

- `docs/design/IMAGE_ASSETS.md`
- `docs/design/assets/voice_native_moodboard_board.png`
- `docs/design/assets/voice_native_pwa_chat_comp.png`
- `docs/design/assets/voice_native_mobile_voice_comp.png`
- `docs/design/assets/voice_native_desktop_helper_comp.png`

## Feedback to ask for

- Did chat/voice feel like the main control surface?
- Which surface felt closest to daily use: hosted PWA, phone, or desktop helper?
- Which parts still felt like debug tooling rather than a product?
- Which failure or setup step was confusing enough that the docs should change before the next pass?
