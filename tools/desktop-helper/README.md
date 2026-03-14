# Starlog Desktop Helper (Tauri)

Desktop helper for clipping content from non-browser apps.

## Current capabilities
- Global OS shortcuts plus window-local fallback (`Cmd/Ctrl+Shift+C` and `Cmd/Ctrl+Shift+S`).
- Persisted API base and bearer token between launches.
- Runtime diagnostics card for clipboard, screenshot, OCR, active-window metadata, and shortcut wiring, with refresh/copy controls plus latest-attempt notes for bug reports.
- Native clipboard capture in Tauri runtime, with focused-window browser clipboard fallback when native access is unavailable.
- Best-effort active app/window metadata capture per clip.
- Native screenshot capture via platform commands:
  - macOS: interactive `screencapture -i`
  - Windows: full-screen PowerShell capture
  - Linux: best-effort `grim`/`slurp`, `gnome-screenshot`, ImageMagick `import`, plus full-screen `grim` or `scrot` fallback
- Strict on-device OCR attempt for screenshots via local `tesseract` when available.
- Queued upload to Starlog API.
- Best-effort cleanup of temporary screenshot files after upload.
- In-app recent-capture history with artifact IDs, clip summaries, screenshot thumbnails, captured context, and the backend used for the capture.

## Validation matrix

| Surface | Linux | macOS | Windows | Notes |
| --- | --- | --- | --- | --- |
| Clipboard capture | Validated via local helper build; requires `wl-paste`, `xclip`, or `xsel`; browser fallback while focused | Expected via `pbpaste`; real-host validation still pending | Validated on 2026-03-10 via `powershell.exe` `Get-Clipboard -Raw` from the host | Diagnostics card reports the preferred backend and now points at host-specific fixes when capture fails. |
| Screenshot capture | Validated via local helper build; requires `grim+slurp`, `gnome-screenshot`, `import`, `grim`, or `scrot` | Expected via `screencapture -i`; real-host validation still pending | Validated on 2026-03-10 via host PowerShell full-screen capture into `%TEMP%` | Linux falls back to full-screen capture when only `grim` or `scrot` is present. macOS/Windows failures now map to explicit permission guidance. |
| Active window metadata | Validated via local helper build; uses `xdotool` or `hyprctl` | Expected via `osascript`/System Events; real-host validation still pending | Validated on 2026-03-10 via host PowerShell user32 bridge after fixing the `$PID` variable collision in the probe script | Missing metadata does not block capture; diagnostics now degrade with actionable host guidance instead of silently implying success. |
| OCR | `tesseract` | `tesseract` | `tesseract` | OCR is intentionally local-only. |
| Shortcut wiring | Global shortcut plugin plus window fallback | Global shortcut plugin plus window fallback | Global shortcut plugin plus window fallback | Window-local key handling remains the last-resort fallback. |

## Host validation evidence

| Host path | Date | Checks | Result |
| --- | --- | --- | --- |
| Linux helper workspace in this repo | 2026-03-10 | Playwright helper UI tests, `cargo check`, Linux Tauri release build | Passed. Browser fallback logic, runtime note rendering, Rust backend checks, and the Linux release artifact stayed green. |
| Windows host backend from WSL via `powershell.exe` | 2026-03-10 | PowerShell version probe, `Get-Clipboard -Raw`, foreground-window probe, full-screen screenshot capture | Passed. PowerShell reported `5.1.26100.7705`; clipboard returned `STATUS=ok` with `LENGTH=141`; the foreground-window probe returned `APP:Codex` / `TITLE:Codex`; screenshot capture wrote `C:\Users\bossg\AppData\Local\Temp\starlog-host-matrix-test.png` with `SIZE=192937`. |
| Windows OCR/tooling probe from WSL via `cmd.exe` | 2026-03-10 | `where tesseract` | Not installed on the Windows `PATH` in this host check, so OCR remains a setup dependency even though screenshot capture itself worked. |
| Windows shortcut path | 2026-03-10 | Manual-only check | Not directly automatable from WSL. The helper still exposes the same Tauri global-shortcut plus window-keydown fallback matrix documented below. |

## Troubleshooting

| Host | Diagnostic or failure state | Action |
| --- | --- | --- |
| Linux | Screenshot diagnostics prefer `grim` or `scrot` only | Region capture is not fully available. Install `slurp`, `gnome-screenshot`, or ImageMagick `import` to restore an area-selection backend. |
| macOS | Screenshot note says the `screencapture` attempt was cancelled | Dismissing the selection is expected to report a cancellation. Re-run the capture and complete the selection, and grant Screen Recording permission if every attempt fails. |
| macOS | Active window diagnostics degrade or notes mention `osascript` failure | Grant Automation permission (System Events) and Accessibility permission for the helper, keep a normal app window focused, then refresh diagnostics. |
| Windows | Screenshot note says the `powershell` attempt failed | Run the helper in a logged-in Windows desktop session and keep `powershell.exe` on `PATH`. When running probe scripts from WSL, use `-ExecutionPolicy Bypass` because unsigned `\\wsl$` scripts are blocked by default. |
| Windows | Active window diagnostics degrade or recent captures show `powershell-user32-error` | Keep a normal Windows app focused, then refresh diagnostics or retry the clip. If the problem persists, confirm PowerShell can still load `user32.dll` from the interactive session. |
| Windows | OCR is marked degraded or unavailable | Install `tesseract` on the Windows `PATH`. Screenshot capture still works without OCR, but extracted text will stay empty until `tesseract` is present. |
| Browser fallback | Clipboard note mentions permission denial | Focus the helper window and allow clipboard access, or switch back to the native Tauri runtime for the preferred clipboard path. |

## Validation commands

- Browser-style validation: `./node_modules/.bin/playwright test`
- Rust backend validation: `cd tools/desktop-helper/src-tauri && cargo check`
- Native helper build: `cd tools/desktop-helper && ./node_modules/.bin/tauri build`
- Windows host probes used in this branch:
  - `powershell.exe -NoProfile -Command 'Write-Output $PSVersionTable.PSVersion.ToString()'`
  - `powershell.exe -NoProfile -Command 'Get-Clipboard -Raw'`
  - PowerShell user32 foreground-window probe matching the helper script
  - PowerShell full-screen screenshot probe matching the helper script

## Manual runtime checks

1. Launch the helper and confirm the runtime diagnostics card shows the expected clipboard/screenshot backends for the current desktop session, then use Refresh Diagnostics after any local dependency change.
2. Trigger `Cmd/Ctrl+Shift+C` while another app is focused, then again with the helper focused to verify both global and window-local shortcut paths.
3. Trigger `Cmd/Ctrl+Shift+S` and confirm the status text clearly reports whether the helper used region capture, a full-screen fallback, or no backend at all.
4. Use Copy Diagnostics to capture a redacted runtime snapshot for issue reporting, then inspect Recent captures and confirm metadata, capture-backend labels, OCR details, and screenshot preview thumbnails render after a successful upload.
5. Intentionally reproduce one clipboard or screenshot failure path and confirm the copied diagnostics snapshot includes the latest failure note without exposing the bearer token.

## macOS validation checklist

1. Build and run the helper on a real macOS host (`cargo check` + Tauri build/run).
2. In System Settings -> Privacy & Security, confirm the helper has:
   - Screen Recording permission for screenshot capture.
   - Automation permission for System Events (active-window probe).
   - Accessibility permission if active-window metadata remains degraded.
3. Run `Cmd+Shift+S` and complete a region selection; verify Recent captures shows `Capture backend: screencapture`.
4. Run `Cmd+Shift+C`; verify clipboard capture succeeds via `pbpaste`.
5. Refresh diagnostics and confirm Active window status is `Ready` and probe detail includes the currently focused app/window.
