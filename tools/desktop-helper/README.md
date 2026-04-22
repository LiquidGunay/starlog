# Starlog Desktop Helper (Tauri)

Desktop capture companion for Starlog.

## Current capabilities

- Two-surface desktop UX aligned to the Starlog design language:
  - compact quick-capture popup,
  - full helper workspace window.
- Capture-first workflow:
  - clipboard capture,
  - screenshot capture,
  - recent captures,
  - handoff into `Library` or `Assistant`.
- Global OS shortcuts plus window-local fallback (`Cmd/Ctrl+Shift+C` and `Cmd/Ctrl+Shift+S`).
- Persisted API base between launches; bearer token uses OS secure storage in Tauri runtime (browser fallback keeps local-storage behavior only outside Tauri).
- Setup-pack controls in the workspace config surface:
  - `Copy Setup Checklist` copies a redacted, current readiness summary for daily-use setup/handoff.
  - `Reset Local State` clears API base, secure/local token, recent captures, and remembered surface mode on the current device.
- Runtime diagnostics card for clipboard, screenshot, OCR, active-window metadata, and shortcut wiring, with refresh/copy controls plus latest-attempt notes for bug reports.
- Native clipboard capture in Tauri runtime, with focused-window browser clipboard fallback when native access is unavailable.
- Best-effort active app/window metadata capture per clip.
- Native screenshot capture via platform commands:
  - macOS: interactive `screencapture -i`
  - Windows: full-screen PowerShell capture
  - Linux: best-effort `grim`/`slurp`, `gnome-screenshot`, ImageMagick `import`, plus full-screen `grim` or `scrot` fallback
- Strict on-device OCR attempt for screenshots via local `tesseract` when available.
- Screenshot region selection overlays are OS-native capture surfaces; the helper window itself stays in compact/workspace bounds and does not switch to full-screen UI.
- `Open Workspace` launches a dedicated larger helper window (`workspace`) from the quick popup instead of resizing the popup itself.
- Queued upload to Starlog API.
- Best-effort cleanup of temporary screenshot files after upload.
- In-app recent-capture history with artifact IDs, clip summaries, screenshot thumbnails, captured context, and the backend used for the capture.
- Recent capture handoff now carries artifact id, app/window context, backend, source URL, and summary into the shared Assistant draft, and the web Assistant renders that helper handoff as an explicit banner with `Open in Library` / `Clear handoff` actions.

## Validation matrix

| Surface | Linux | macOS | Windows | Notes |
| --- | --- | --- | --- | --- |
| Clipboard capture | Validated via local helper build; requires `wl-paste`, `xclip`, or `xsel`; browser fallback while focused | Expected via `pbpaste`; real-host validation still pending | Validated on 2026-03-10 via `powershell.exe` `Get-Clipboard -Raw` from the host | Diagnostics card reports the preferred backend and now points at host-specific fixes when capture fails. |
| Screenshot capture | Validated via local helper build; requires `grim+slurp`, `gnome-screenshot`, `import`, `grim`, or `scrot` | Expected via `screencapture -i`; real-host validation still pending | Validated on 2026-03-10 via host PowerShell full-screen capture into `%TEMP%` | Linux falls back to full-screen capture when only `grim` or `scrot` is present. macOS/Windows failures now map to explicit permission guidance. |
| Active window metadata | Validated via local helper build; uses `xdotool` or `hyprctl` | Expected via `osascript`/System Events; real-host validation still pending | Validated on 2026-03-10 via host PowerShell user32 bridge after fixing the `$PID` variable collision in the probe script | Missing metadata does not block capture; diagnostics now degrade with actionable host guidance instead of silently implying success. |
| OCR | `tesseract` | `tesseract` | `tesseract` | OCR is intentionally local-only. |
| Recent capture actions | Browser-path validated on 2026-04-22 via Playwright helper + web Assistant suites; real-host rerun still pending | Pending rerun | Pending rerun | `Open in Library` and `Ask Assistant` now preserve artifact and capture-context handoff into the shared Assistant composer. |
| Shortcut wiring | Global shortcut plugin plus window fallback | Global shortcut plugin plus window fallback | Global shortcut plugin plus window fallback | Window-local key handling remains the last-resort fallback. |

## Host validation evidence

| Host path | Date | Checks | Result |
| --- | --- | --- | --- |
| Linux helper workspace in this repo | 2026-03-10 | Playwright helper UI tests, `cargo check`, Linux Tauri release build | Passed. Browser fallback logic, runtime note rendering, Rust backend checks, and the Linux release artifact stayed green. |
| Linux RC localhost stack in this repo | 2026-03-22 | `build_release_artifacts.sh`, runtime dependency probe, Linux bootstrap script, authenticated bridge discovery on `127.0.0.1:8091`, real rootless STT smoke on `127.0.0.1:8171`, and real browser-fallback clipboard upload into a local API on `127.0.0.1:8010` | Passed for the current host-supported path. The helper discovered the authenticated bridge, uploaded a real clipboard capture (`art_b40fadfafc55444897413ec4bdc59593`) into the local API, and the rootless `faster-whisper` server transcribed `jfk.wav` through the bridge on CPU fallback. Native Linux clipboard/screenshot/OCR still require the generated `apt-get` package install on the Linux side. |
| Windows host backend from WSL via `powershell.exe` | 2026-03-10 | PowerShell version probe, `Get-Clipboard -Raw`, foreground-window probe, full-screen screenshot capture | Passed. PowerShell reported `5.1.26100.7705`; clipboard returned `STATUS=ok` with `LENGTH=141`; the foreground-window probe returned `APP:Codex` / `TITLE:Codex`; screenshot capture wrote `C:\\Users\\bossg\\AppData\\Local\\Temp\\starlog-host-matrix-test.png` with `SIZE=192937`. |
| Windows OCR/tooling probe from WSL via `cmd.exe` | 2026-03-10 | `where tesseract` | Not installed on the Windows `PATH` in this host check, so OCR remains a setup dependency even though screenshot capture itself worked. |
| Windows shortcut path | 2026-03-10 | Manual-only check | Not directly automatable from WSL. The helper still exposes the same Tauri global-shortcut plus window-keydown fallback matrix documented below. |

## Troubleshooting

| Host | Diagnostic or failure state | Action |
| --- | --- | --- |
| Linux | Screenshot diagnostics prefer `grim` or `scrot` only | Region capture is not fully available. Install `slurp`, `gnome-screenshot`, or ImageMagick `import` to restore an area-selection backend. |
| macOS | Screenshot note says the `screencapture` attempt was cancelled | Dismissing the selection is expected to report a cancellation. Re-run the capture and complete the selection, and grant Screen Recording permission if every attempt fails. |
| macOS | Active window diagnostics degrade or notes mention `osascript` failure | Grant Automation permission (System Events) and Accessibility permission for the helper, keep a normal app window focused, then refresh diagnostics. |
| Windows | Screenshot note says the `powershell` attempt failed | Run the helper in a logged-in Windows desktop session and keep `powershell.exe` on `PATH`. When running probe scripts from WSL, use `-ExecutionPolicy Bypass` because unsigned `\\\\wsl$` scripts are blocked by default. |
| Windows | Active window diagnostics degrade or recent captures show `powershell-user32-error` | Keep a normal Windows app focused, then refresh diagnostics or retry the clip. If the problem persists, confirm PowerShell can still load `user32.dll` from the interactive session. |
| Windows | OCR is marked degraded or unavailable | Install `tesseract` on the Windows `PATH`. Screenshot capture still works without OCR, but extracted text will stay empty until `tesseract` is present. |
| Browser fallback | Clipboard note mentions permission denial | Focus the helper window and allow clipboard access, or switch back to the native Tauri runtime for the preferred clipboard path. |

## Validation commands

- Browser-style validation: `./node_modules/.bin/playwright test`
- Rust backend validation: `cd tools/desktop-helper/src-tauri && cargo check`
- Native helper build: `cd tools/desktop-helper && ./node_modules/.bin/tauri build`
- Runtime dependency probe: `cd tools/desktop-helper && ./scripts/runtime_dependency_probe.sh`
- Linux dependency bootstrap: `cd tools/desktop-helper && ./scripts/bootstrap_linux_runtime_deps.sh [--output-json <path>]`
- Signing readiness probe (target-aware): `cd tools/desktop-helper && ./scripts/signing_readiness_check.sh <linux|windows|macos|all>`
- Bundle + release artifact staging: `cd tools/desktop-helper && ./scripts/build_release_artifacts.sh`
- RC localhost smoke with real API + bridge: `cd tools/desktop-helper && STARLOG_DESKTOP_HELPER_RC_API_BASE=http://127.0.0.1:8010 STARLOG_DESKTOP_HELPER_RC_BEARER_TOKEN=<token> STARLOG_DESKTOP_HELPER_RC_BRIDGE_TOKEN=<bridge-token> node ./scripts/capture_rc_smoke.mjs`
- Rootless local STT server: `uv run --project services/ai-runtime --extra local-voice python scripts/local_stt_server.py`
- QA screenshot capture: `cd tools/desktop-helper && node ./scripts/capture_qa_screenshots.mjs`
- Main-laptop install/setup handoff: `docs/DESKTOP_HELPER_MAIN_LAPTOP_SETUP.md`
- Windows host probes used in this branch:
  - `powershell.exe -NoProfile -Command 'Write-Output $PSVersionTable.PSVersion.ToString()'`
  - `powershell.exe -NoProfile -Command 'Get-Clipboard -Raw'`
  - PowerShell user32 foreground-window probe matching the helper script
  - PowerShell full-screen screenshot probe matching the helper script

## Release packaging

- Staged release artifacts are generated under:
  - `artifacts/desktop-helper/v<version>/<arch-os>/`
- `build_release_artifacts.sh` produces:
  - host installers (`.deb`, `.AppImage`, `.msi`, `.dmg`, etc. when supported),
  - raw helper binary fallback,
  - `checksums.sha256`,
  - `manifest.tsv`,
  - `build-info.txt`.
- Artifact names are normalized as:
  - `starlog-desktop-helper-v<version>-<arch-os>-<source-file>`

## Signing and notarization

- Use `signing_readiness_check.sh` before RC packaging to catch missing cert/notarization env vars.
- `linux` target checks optional package-signing tools (`gpg`, `dpkg-sig`, `rpmsign`) and reports warnings.
- `windows` target checks `signtool` and certificate env (`WINDOWS_CERTIFICATE` + `WINDOWS_CERTIFICATE_PASSWORD`, or `WINDOWS_CERTIFICATE_SHA1`).
- `macos` target checks cert + notarization env (`APPLE_CERTIFICATE`, `APPLE_CERTIFICATE_PASSWORD`, `APPLE_API_KEY`, `APPLE_API_ISSUER`, `APPLE_API_KEY_PATH`, `APPLE_TEAM_ID`).
- Distribution runbook and RC checklist: `docs/DESKTOP_HELPER_V1_RELEASE.md`.

## Manual runtime checks

1. Launch the helper and confirm the runtime diagnostics card shows the expected clipboard/screenshot backends for the current desktop session, then use Refresh Diagnostics after any local dependency change.
2. Trigger `Cmd/Ctrl+Shift+C` while another app is focused, then again with the helper focused to verify both global and window-local shortcut paths.
3. Trigger `Cmd/Ctrl+Shift+S` and confirm the status text clearly reports whether the helper used region capture, a full-screen fallback, or no backend at all.
4. Inspect Recent captures and confirm metadata, capture-backend labels, OCR details, screenshot preview thumbnails, and the Assistant/Library handoff actions render after a successful upload.
5. Use Copy Diagnostics to capture a redacted runtime snapshot for issue reporting, then intentionally reproduce one clipboard or screenshot failure path and confirm the copied diagnostics snapshot includes the latest failure note without exposing the bearer token.

## Current Linux host note

The 2026-03-22 RC pass on this host validated the helper through the browser-fallback clipboard path plus the localhost bridge, and the new rootless local STT server proved real transcription without `sudo`. Native Linux screenshot/OCR validation is still blocked here because the runtime probe reported:

- no `wl-paste`, `xclip`, or `xsel`
- no `grim`, `slurp`, `gnome-screenshot`, `import`, or `scrot`
- no `tesseract`

The exact remaining operator step is:

```bash
sudo apt-get update
sudo apt-get install -y wl-clipboard grim slurp xclip scrot xdotool gnome-screenshot imagemagick tesseract-ocr ffmpeg
```

Until those binaries are installed, this host can validate release packaging, bridge discovery/auth, API upload flow, and real local STT, but not the full native Linux screenshot/OCR path.

## macOS validation checklist

1. Build and run the helper on a real macOS host (`cargo check` + Tauri build/run).
2. In System Settings -> Privacy & Security, confirm the helper has:
   - Screen Recording permission for screenshot capture.
   - Automation permission for System Events (active-window probe).
   - Accessibility permission if active-window metadata remains degraded.
3. Run `Cmd+Shift+S` and complete a region selection; verify Recent captures shows `Capture backend: screencapture`.
4. Run `Cmd+Shift+C`; verify clipboard capture succeeds via `pbpaste`.
5. Refresh diagnostics and confirm Active window status is `Ready` and probe detail includes the currently focused app/window.
