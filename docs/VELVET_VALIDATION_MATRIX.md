# Velvet Rollout Validation Matrix

Date: `2026-03-27`
Workitem: `WI-613`

This document is the focused validation runbook for the Velvet UI rollout across:

- `WI-610` / `codex/velvet-pwa-salon-thread`
- `WI-611` / `codex/velvet-mobile-capture-gesture`
- `WI-612` / `codex/velvet-desktop-helper-instrument`

It is intentionally narrower than the general release docs. The goal is to give the supervisor and
surface owners one concrete command/evidence bundle for the Velvet redesign across browser, phone,
and Windows helper validation.

## Validation roots

Run the commands in this document against the code under review, not the canonical checkout unless
that checkout is itself the branch under test.

Preferred roots:

- PWA branch root: `/home/ubuntu/starlog-worktrees/velvet-pwa-salon-thread`
- Mobile branch root: `/home/ubuntu/starlog-worktrees/velvet-mobile-capture-gesture`
- Desktop-helper branch root: `/home/ubuntu/starlog-worktrees/velvet-desktop-helper-instrument`
- Optional combined validation root: a disposable worktree that contains the UI branches being
  validated together

Shell examples below use these environment variables:

```bash
PWA_ROOT=/home/ubuntu/starlog-worktrees/velvet-pwa-salon-thread
MOBILE_ROOT=/home/ubuntu/starlog-worktrees/velvet-mobile-capture-gesture
HELPER_ROOT=/home/ubuntu/starlog-worktrees/velvet-desktop-helper-instrument
```

## Ready-now baseline on this host

Observed on `2026-03-27` from `/home/ubuntu/starlog-worktrees/velvet-cross-device-validation`:

- PWA hosted smoke passed via `bash ./scripts/pwa_hosted_smoke.sh`
- Desktop-helper quick popup browser-fallback smoke passed via:
  - `./node_modules/.bin/playwright test tools/desktop-helper/tests/helper.spec.ts --grep "quick popup can switch to workspace in browser fallback"`
- Windows host PowerShell is reachable from WSL:
  - `PS=5.1.26100.7920`
  - `Get-Clipboard -Raw` succeeded with `CLIP_LEN=62`
- Windows ADB path sees the connected phone:
  - serial `9dd62e84`
  - model `CPH2381`

Reusable scaffolding for future passes now lives in:

- `scripts/prepare_cross_surface_proof_bundle.sh`
- `scripts/capture_cross_surface_windows_host_probe.sh`
- `scripts/cross_surface_proof_bundle.sh`

Compatibility wrappers still exist:

- `scripts/prepare_velvet_validation_bundle.sh`
- `scripts/capture_velvet_windows_host_probe.sh`
- `scripts/velvet_validation_artifacts.sh`

## One-command artifact bundle

The default supervisor entrypoint is now:

```bash
cd /home/ubuntu/starlog
./scripts/cross_surface_proof_bundle.sh
```

That command creates `artifacts/cross-surface-proof/<timestamp>/`, runs the ready-now PWA and Windows
checks, and writes a per-step summary to:

- `artifacts/cross-surface-proof/<timestamp>/RUN_SUMMARY.md`
- `artifacts/cross-surface-proof/<timestamp>/run-summary.json`

If you run it from a fresh linked worktree, attach the shared dependency state first:

```bash
cd /home/ubuntu/starlog-worktrees/<your-worktree>
bash scripts/use_shared_worktree_state.sh --source /home/ubuntu/starlog
./scripts/cross_surface_proof_bundle.sh
```

Optional paths stay explicit via environment variables:

```bash
cd /home/ubuntu/starlog
STARLOG_VALIDATION_RUN_PWA_PROOF=1 \
STARLOG_CROSS_SURFACE_API_BASE='http://127.0.0.1:8011' \
STARLOG_CROSS_SURFACE_TOKEN='<token>' \
STARLOG_VALIDATION_RUN_ANDROID_SMOKE=1 \
STARLOG_VALIDATION_RUN_ANDROID_SCREENSHOT=1 \
ADB=/mnt/c/Temp/android-platform-tools/platform-tools/adb.exe \
ADB_SERIAL=9dd62e84 \
REVERSE_PORTS=8000 \
SKIP_INSTALL=1 \
./scripts/cross_surface_proof_bundle.sh
```

Optional roots for split worktrees can also be overridden:

```bash
VALIDATION_ROOT=/home/ubuntu/starlog \
PWA_ROOT=/home/ubuntu/starlog-worktrees/velvet-pwa-salon-thread \
MOBILE_ROOT=/home/ubuntu/starlog-worktrees/velvet-mobile-capture-gesture \
HELPER_ROOT=/home/ubuntu/starlog-worktrees/velvet-desktop-helper-instrument \
./scripts/cross_surface_proof_bundle.sh
```

## Validation targets

| Target | Branch dependency | Command(s) to run | Expected evidence | Current status |
| --- | --- | --- | --- | --- |
| PWA browser | `WI-610` | `bash ./scripts/pwa_hosted_smoke.sh` | log, API log, Playwright screenshots under `artifacts/pwa-hosted-smoke/` | Ready now; passed on `2026-03-27` |
| PWA visual proof | `WI-610` | `STARLOG_CROSS_SURFACE_API_BASE=... STARLOG_CROSS_SURFACE_TOKEN=... node scripts/cross_surface_web_proof.mjs artifacts/cross-surface-proof/<stamp>/hosted-pwa` | `pwa-assistant-thread.png`, `pwa-artifacts-desktop-clip.png`, `pwa-proof.json` | Blocked on Velvet UI branch being ready for proof capture |
| Android phone, native companion | `WI-611` | follow the phone flow below; final smoke command is `./scripts/android_native_smoke.sh` | phone screenshot(s), smoke terminal log, optionally Metro relay log | Phone is visible now; full Velvet proof blocked on mobile UI branch |
| Android phone, installed PWA | `WI-610` | open PWA on phone browser against LAN web/API, then capture screenshots manually | one `/assistant` screenshot, one secondary workspace screenshot | Blocked on Velvet PWA branch |
| Windows helper browser-fallback smoke | `WI-612` | `./node_modules/.bin/playwright test tools/desktop-helper/tests/helper.spec.ts` | Playwright output and any `test-results/` assets | Ready now; quick popup smoke passed on `2026-03-27` |
| Windows host runtime probes | `WI-612` | PowerShell clipboard/screenshot probes from helper README | terminal output and created screenshot file | Clipboard probe confirmed; screenshot/OCR probe should be rerun after Velvet helper branch |
| Windows helper visual QA | `WI-612` | `cd tools/desktop-helper && node ./scripts/capture_qa_screenshots.mjs` | helper screenshots under the chosen artifact folder | Blocked on Velvet helper branch being ready |

## Target-specific pass criteria

### 1. PWA browser

The Velvet PWA branch is ready when all of the following are true:

1. `bash ./scripts/pwa_hosted_smoke.sh` passes.
2. The PWA still renders the primary thread and artifact surfaces without auth/session regressions.
3. One screenshot bundle exists for the Velvet `/assistant` and related surface proving the new
   composition, not just structural correctness.

Preferred evidence paths:

- `artifacts/pwa-hosted-smoke/hosted-smoke-<timestamp>.log`
- `artifacts/pwa-hosted-smoke/api-<timestamp>.log`
- `artifacts/pwa-hosted-smoke/test-results/`
- `artifacts/cross-surface-proof/<timestamp>/hosted-pwa/`

### 2. Android phone

The phone path is ready when all of the following are true:

1. The phone stays unlocked for the entire validation run.
2. The Windows ADB path still reports serial `9dd62e84` as `device`.
3. Metro relay reaches `http://127.0.0.1:8081` from Windows before opening the dev client.
4. The Velvet mobile screen is visible on-device.
5. One screenshot proves the main Velvet capture flow and one screenshot proves either briefing or
   assistant follow-up state.

Preferred evidence path:

- `artifacts/cross-surface-proof/<timestamp>/phone-app/`

Suggested contents:

- `adb-devices.txt`
- `metro-relay.txt`
- `android-smoke.txt`
- `velvet-mobile-capture.png`
- `velvet-mobile-briefing.png`

### 3. Windows desktop helper

The Windows helper path is ready when all of the following are true:

1. Browser-fallback Playwright helper coverage still passes.
2. Clipboard and screenshot host probes still work from WSL via `powershell.exe`.
3. The compact helper popup visibly reflects the Velvet branch rather than only the workspace view.
4. One visual QA bundle exists from the helper branch.

Preferred evidence path:

- `artifacts/cross-surface-proof/<timestamp>/desktop-helper/`

Suggested contents:

- `helper-playwright.txt`
- `windows-probes.txt`
- `desktop-helper-workspace-config.png`
- `desktop-helper-quick-popup.png`
- `desktop-helper-workspace-diagnostics.png`
- `screenshots.json`

## Exact command bundles

### PWA hosted smoke

Run from the PWA branch root or a combined validation worktree that includes the Velvet PWA changes:

```bash
cd "$PWA_ROOT"
bash ./scripts/pwa_hosted_smoke.sh
```

Recorded passing baseline on this branch:

- log: `artifacts/pwa-hosted-smoke/hosted-smoke-20260327T080949Z.log`
- API log: `artifacts/pwa-hosted-smoke/api-20260327T080949Z.log`

### PWA Velvet screenshot proof

Run after the Velvet PWA branch is ready and you have a valid token for the local API used in the
proof:

```bash
cd "$PWA_ROOT"
STARLOG_CROSS_SURFACE_API_BASE='http://127.0.0.1:8011' \
STARLOG_CROSS_SURFACE_TOKEN='<token>' \
node scripts/cross_surface_web_proof.mjs artifacts/cross-surface-proof/<timestamp>/hosted-pwa
```

### Android phone flow on this host

Use the runbook in `AGENTS.md` and `docs/PHONE_SETUP.md`. The shortest working path is:

```bash
cd "$MOBILE_ROOT"
ADB_WIN=/mnt/c/Temp/android-platform-tools/platform-tools/adb.exe
"$ADB_WIN" devices -l
"$ADB_WIN" -s 9dd62e84 shell svc power stayon usb
"$ADB_WIN" -s 9dd62e84 reverse tcp:8000 tcp:8000
bash -x "$MOBILE_ROOT/scripts/android_windows_metro_relay.sh"
powershell.exe -NoProfile -Command 'try { (Invoke-WebRequest -Uri "http://127.0.0.1:8081" -UseBasicParsing -TimeoutSec 5).StatusCode } catch { $_.Exception.Message; exit 1 }'
```

Then, once Metro is serving the Velvet mobile branch:

```bash
cd "$MOBILE_ROOT/apps/mobile"
APP_VARIANT=development REACT_NATIVE_PACKAGER_HOSTNAME=192.168.0.102 ./node_modules/.bin/expo start --dev-client --host lan --port 8081
```

And finally:

```bash
cd "$MOBILE_ROOT"
DEV_CLIENT_URL='exp+starlog://expo-development-client/?url=http%3A%2F%2F192.168.0.102%3A8081' \
ADB=/mnt/c/Temp/android-platform-tools/platform-tools/adb.exe \
ADB_SERIAL=9dd62e84 \
REVERSE_PORTS=8000 \
SKIP_INSTALL=1 \
./scripts/android_native_smoke.sh
```

Screenshot capture:

```bash
ADB_WIN=/mnt/c/Temp/android-platform-tools/platform-tools/adb.exe
"$ADB_WIN" -s 9dd62e84 exec-out screencap -p > /tmp/starlog-velvet-phone.png
```

### Windows helper baseline and post-branch checks

Fast browser-fallback smoke:

```bash
cd "$HELPER_ROOT"
./node_modules/.bin/playwright test tools/desktop-helper/tests/helper.spec.ts --grep "quick popup can switch to workspace in browser fallback"
```

Windows host clipboard probe:

```bash
powershell.exe -NoProfile -Command '$ver=$PSVersionTable.PSVersion.ToString(); Write-Output ("PS=" + $ver); try { $clip = Get-Clipboard -Raw; Write-Output ("CLIP_LEN=" + $clip.Length) } catch { Write-Output ("CLIP_ERR=" + $_.Exception.Message) }'
```

Bundle scaffolding plus host probe capture:

```bash
VALIDATION_ROOT=/home/ubuntu/starlog-worktrees/velvet-cross-device-validation
STAMP="$(date -u +"%Y%m%dT%H%M%SZ")"
cd "$VALIDATION_ROOT"
./scripts/prepare_cross_surface_proof_bundle.sh "$STAMP"
./scripts/capture_cross_surface_windows_host_probe.sh "$STAMP"
```

After the Velvet helper branch is ready, run:

```bash
cd "$HELPER_ROOT/tools/desktop-helper"
node ./scripts/capture_qa_screenshots.mjs
```

## Merge/handoff order

The supervisor can use this order for final proof capture:

1. Validate `WI-610` with hosted smoke and PWA screenshot proof.
2. Validate `WI-612` with helper Playwright plus Windows probe/screenshot bundle.
3. Validate `WI-611` on the connected phone after the LAN Metro relay is confirmed.

If all three UI branches are available at once, cherry-pick them into one disposable validation
worktree and store the final evidence bundle under:

- `artifacts/cross-surface-proof/<timestamp>/`

## Known blockers outside this branch

- The final Velvet screenshot proof is blocked on the UI branches actually rendering the new design.
- Android proof still depends on the physical phone remaining unlocked and on Metro being served from
  the branch under test.
- Windows helper screenshot/OCR proof remains host-dependent; clipboard probing is ready, but the
  final visual QA bundle should be captured from the finished helper branch.
