# Cross-Surface Proof

Last updated: 2026-03-30

This is the canonical runbook for refreshing one evidence bundle that captures all three user-facing
surfaces together on current `master`:

1. hosted PWA
2. installed Android phone app
3. desktop helper

The default runner is `./scripts/cross_surface_proof_bundle.sh`.

## Bundle layout

Every run writes one timestamped bundle under:

- `artifacts/cross-surface-proof/<timestamp>/`

Top-level files:

- `manifest.json`
- `RUN_SUMMARY.md`
- `run-summary.json`

Subfolders:

- `hosted-pwa/`
- `phone-app/`
- `desktop-helper/`
- `logs/`

## What the bundle proves

- `hosted-pwa/` captures hosted smoke output plus optional PWA proof screenshots against the same
  API/token configuration.
- `phone-app/` captures the installed-phone smoke log, device visibility, optional Metro relay log,
  and one or more screenshots from the phone.
- `desktop-helper/` captures helper Playwright smoke, Windows host probes, and helper screenshots in
  the same evidence set.

This keeps the latest hosted web, phone, and helper proof artifacts together instead of spreading
them across separate runbooks and folders.

## Canonical command

Baseline run with the ready-now lanes enabled:

```bash
cd /home/ubuntu/starlog
./scripts/cross_surface_proof_bundle.sh
```

That creates `artifacts/cross-surface-proof/<timestamp>/`, runs:

- hosted PWA smoke
- desktop-helper Playwright smoke
- Windows host probes
- desktop-helper QA screenshots

and records per-step results in `RUN_SUMMARY.md` and `run-summary.json`.

## Full run with optional PWA + phone lanes

Enable the optional proof lanes explicitly when you have the required token/device state:

```bash
cd /home/ubuntu/starlog
STARLOG_CROSS_SURFACE_RUN_PWA_PROOF=1 \
STARLOG_CROSS_SURFACE_API_BASE='http://127.0.0.1:8011' \
STARLOG_CROSS_SURFACE_TOKEN='<token>' \
STARLOG_CROSS_SURFACE_RUN_PHONE_SMOKE=1 \
STARLOG_CROSS_SURFACE_RUN_PHONE_SCREENSHOT=1 \
ADB=/mnt/c/Temp/android-platform-tools/platform-tools/adb.exe \
ADB_SERIAL=9dd62e84 \
REVERSE_PORTS=8000 \
SKIP_INSTALL=1 \
./scripts/cross_surface_proof_bundle.sh
```

Optional roots for split worktrees:

```bash
CROSS_SURFACE_PROOF_ROOT=/home/ubuntu/starlog \
PWA_ROOT=/home/ubuntu/starlog-worktrees/<pwa-worktree> \
MOBILE_ROOT=/home/ubuntu/starlog-worktrees/<mobile-worktree> \
HELPER_ROOT=/home/ubuntu/starlog-worktrees/<helper-worktree> \
./scripts/cross_surface_proof_bundle.sh
```

Compatibility note:

- `VALIDATION_ROOT` is still honored as a fallback bundle root for existing wrapper-driven flows.
- `STARLOG_CROSS_SURFACE_WORKITEM_ID` can override the manifest workitem id; otherwise the bundle
  records the generic `cross-surface-proof` identifier instead of a branch-specific WI value.

## Expected artifact structure

Hosted PWA:

- `hosted-pwa/hosted-smoke-summary.txt`
- `hosted-pwa/test-results/`
- `hosted-pwa/pwa-proof.json`
- `hosted-pwa/pwa-assistant-thread.png`
- `hosted-pwa/pwa-artifacts-desktop-clip.png`

Installed phone app:

- `phone-app/adb-devices.txt`
- `phone-app/metro-relay.txt`
- `phone-app/android-smoke.txt`
- `phone-app/phone-capture.png`

Desktop helper:

- `desktop-helper/helper-playwright.txt`
- `desktop-helper/windows-host-probes.txt`
- `desktop-helper/windows-host-probes.json`
- `desktop-helper/desktop-helper-workspace-config.png`
- `desktop-helper/desktop-helper-quick-popup.png`
- `desktop-helper/desktop-helper-workspace-diagnostics.png`
- `desktop-helper/screenshots.json`

## Manual phone step when the Linux host cannot complete it

If the Linux shell still cannot complete the installed-phone proof, use the native Windows ADB flow
documented in `AGENTS.md`, `docs/PHONE_SETUP.md`, and `docs/ANDROID_DEV_BUILD.md`, then copy the
resulting smoke log and screenshots into:

- `artifacts/cross-surface-proof/<timestamp>/phone-app/`

Run this exact command from a native Windows PowerShell session in the repo root when needed:

```powershell
.\scripts\android_native_smoke_windows.ps1 `
  -AdbPath "C:\Temp\android-platform-tools\platform-tools\adb.exe" `
  -Serial 9dd62e84 `
  -ApkPath "C:\Temp\starlog-preview-0.1.0-preview.rc3-104.apk" `
  -AppPackage "com.starlog.app.preview" `
  -AppActivity "com.starlog.app.preview/com.starlog.app.dev.MainActivity" `
  -ReversePorts "8000"
```
