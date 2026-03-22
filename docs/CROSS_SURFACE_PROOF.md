# Cross-Surface Proof

Last updated: 2026-03-22

This is the maximal reproducible cross-surface proof we can execute from the current Linux Codex host without
crossing the Windows-host Android boundary.

## What this proof covers directly

1. One isolated API instance on `http://127.0.0.1:8011`.
2. One persistent-thread marker written into `/v1/conversations/primary`.
3. One real desktop-helper clipboard clip uploaded into that same API.
4. One PWA verification pass against that same API plus the current built web app.
5. One local bridge STT proof for the desktop voice path.

## Evidence bundle from this run

Base folder:

- `artifacts/cross-surface-proof/2026-03-22T14-53-45Z/`

Primary files:

- `artifacts/cross-surface-proof/2026-03-22T14-53-45Z/api-proof.json`
- `artifacts/cross-surface-proof/2026-03-22T14-53-45Z/rc-smoke.json`
- `artifacts/cross-surface-proof/2026-03-22T14-53-45Z/pwa-proof.json`
- `artifacts/cross-surface-proof/2026-03-22T14-53-45Z/desktop-helper-rc-config.png`
- `artifacts/cross-surface-proof/2026-03-22T14-53-45Z/desktop-helper-rc-quick-popup.png`
- `artifacts/cross-surface-proof/2026-03-22T14-53-45Z/desktop-helper-rc-diagnostics.png`
- `artifacts/cross-surface-proof/2026-03-22T14-53-45Z/pwa-assistant-thread.png`
- `artifacts/cross-surface-proof/2026-03-22T14-53-45Z/pwa-artifacts-desktop-clip.png`

Supporting voice evidence:

- `artifacts/desktop-helper/rc-evidence/2026-03-22T15-00-00Z/voice-runtime/local-voice-smoke.json`

Supporting PWA gate evidence:

- `artifacts/pwa-release-gate/gate-20260322T144331Z.log`

## What the evidence proves

- `api-proof.json` shows the canonical `primary` conversation contains the WI-593 marker messages and that the same API
  also contains the desktop-helper artifact `art_e41767ea21f64addab8d43f97a948d66`.
- `rc-smoke.json` plus the helper screenshots show the desktop-helper popup/studio discovered the local bridge and
  uploaded the clipboard clip through the real API token path.
- `pwa-artifacts-desktop-clip.png` shows the PWA artifact surface rendering the `Desktop clip` uploaded by the helper
  into that same API.
- `pwa-proof.json` records whether the seeded thread/artifact markers were visible from the PWA during the proof run.
  On this run:
  - `assistant_marker_visible=false`
  - `artifact_marker_visible=false`
- `pwa-assistant-thread.png` confirms the current assistant shell on the built PWA loads successfully against the same
  configured API base, even though the seeded conversation marker did not surface in the rendered transcript during this
  host-local proof run.
- `local-voice-smoke.json` confirms the desktop bridge transcribed audio through the local STT server on this host.

## Reproducible host-local flow

1. Start an isolated API on a free localhost port.
2. Log in and seed `/v1/conversations/primary` with a known marker pair.
3. Run:

```bash
STARLOG_DESKTOP_HELPER_RC_API_BASE='http://127.0.0.1:8011' \
STARLOG_DESKTOP_HELPER_RC_BEARER_TOKEN='<token>' \
STARLOG_DESKTOP_HELPER_RC_BRIDGE_TOKEN='bridge-secret' \
STARLOG_DESKTOP_HELPER_RC_CLIPBOARD_TEXT='WI-593 desktop clip marker for cross-surface proof' \
node tools/desktop-helper/scripts/capture_rc_smoke.mjs artifacts/cross-surface-proof/<timestamp>
```

4. Run:

```bash
STARLOG_CROSS_SURFACE_API_BASE='http://127.0.0.1:8011' \
STARLOG_CROSS_SURFACE_TOKEN='<token>' \
node scripts/cross_surface_web_proof.mjs artifacts/cross-surface-proof/<timestamp>
```

5. Inspect:
   - `api-proof.json`
   - helper screenshots and `rc-smoke.json`
   - `pwa-proof.json` and the two PWA screenshots

## One remaining external step

The only step that still requires leaving this Linux Codex host is the physical-phone proof, because this process
cannot execute the Windows `adb.exe` binary that reaches the connected phone and local Linux `adb devices -l` is empty
on this host.

Run this exact command from a native Windows PowerShell session in the repo root:

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

- one hold-to-talk screenshot
- one assistant/chat screenshot
- the Windows smoke log

After that step, append the phone evidence path to this doc or `docs/ANDROID_RELEASE_QA_MATRIX.md`.
