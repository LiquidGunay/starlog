# Starlog Desktop Helper (Tauri)

Desktop helper for clipping content from non-browser apps.

## Current capabilities
- Global OS shortcuts plus window-local fallback (`Cmd/Ctrl+Shift+C` and `Cmd/Ctrl+Shift+S`).
- Persisted API base and bearer token between launches.
- Runtime diagnostics card for clipboard, screenshot, OCR, active-window metadata, and shortcut wiring.
- Native clipboard capture in Tauri runtime, with focused-window browser clipboard fallback when native access is unavailable.
- Best-effort active app/window metadata capture per clip.
- Native screenshot capture via platform commands:
  - macOS: interactive `screencapture -i`
  - Windows: full-screen PowerShell capture
  - Linux: best-effort `grim`/`slurp`, `gnome-screenshot`, ImageMagick `import`, plus full-screen `grim` or `scrot` fallback
- Strict on-device OCR attempt for screenshots via local `tesseract` when available.
- Queued upload to Starlog API.
- Best-effort cleanup of temporary screenshot files after upload.
- In-app recent-capture history with artifact IDs, clip summaries, screenshot thumbnails, and captured context.

## Validation matrix

| Surface | Linux | macOS | Windows | Notes |
| --- | --- | --- | --- | --- |
| Clipboard capture | Validated via local helper build; requires `wl-paste`, `xclip`, or `xsel`; browser fallback while focused | Expected via `pbpaste`; real-host validation still pending | Validated on 2026-03-10 via `powershell.exe` `Get-Clipboard -Raw` from the host | Diagnostics card reports the preferred backend and now points at PowerShell/host-session fixes on Windows. |
| Screenshot capture | Validated via local helper build; requires `grim+slurp`, `gnome-screenshot`, `import`, `grim`, or `scrot` | Expected via `screencapture -i`; real-host validation still pending | Validated on 2026-03-10 via host PowerShell full-screen capture into `%TEMP%` | Linux falls back to full-screen capture when only `grim` or `scrot` is present. Windows errors now mention the interactive desktop-session requirement. |
| Active window metadata | Validated via local helper build; uses `xdotool` or `hyprctl` | Expected via `osascript`; real-host validation still pending | Validated on 2026-03-10 via host PowerShell user32 bridge after fixing the `$PID` variable collision in the probe script | Missing metadata does not block capture, but diagnostics now degrade with actionable host guidance instead of silently implying success. |
| OCR | `tesseract` | `tesseract` | `tesseract` | OCR is intentionally local-only. |
| Shortcut wiring | Global shortcut plugin plus window fallback | Global shortcut plugin plus window fallback | Global shortcut plugin plus window fallback | Window-local key handling remains the last-resort fallback. |

## Validated host notes

- Linux: helper build, Playwright browser checks, and Rust tests run in this repo environment.
- Windows 11 host path: validated on 2026-03-10 from WSL via `powershell.exe` interop.
  - PowerShell version probe returned `5.1.26100.7705`.
  - Clipboard probe via `Get-Clipboard -Raw` succeeded.
  - Foreground-window probe returned `APP:Codex` and `TITLE:Codex` after replacing the buggy `$pid` script variable with `$processIdValue`.
  - Screenshot probe wrote `C:\Users\bossg\AppData\Local\Temp\starlog-host-matrix.png`.
- macOS: no real-host validation has been run from this branch yet.

## Troubleshooting

| Host | Symptom | Likely fix |
| --- | --- | --- |
| Windows | Screenshot capture reports that an interactive desktop session is required | Run the helper from an unlocked Windows desktop session instead of a headless/background host. |
| Windows | Active window diagnostics degrade or recent captures show `powershell-user32-error` | Keep a normal Windows app focused, then refresh diagnostics or retry the clip. If the problem persists, confirm PowerShell can load `user32.dll`. |
| Windows | Clipboard capture says PowerShell could not be launched | Ensure `powershell.exe` is present on the Windows `PATH` seen by the helper runtime. |
| macOS | Diagnostics show `pbpaste`, `screencapture`, or `osascript` unavailable | Restore the standard macOS CLI tools and re-check Screen Recording / Accessibility permissions for the app. |
| Linux | Clipboard or screenshot backends are unavailable | Install the backend named in diagnostics, for example `wl-clipboard`, `xclip`, `xsel`, `grim`, `slurp`, `gnome-screenshot`, `imagemagick`, or `scrot`. |

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

1. Launch the helper and confirm the runtime diagnostics card shows the expected clipboard/screenshot backends for the current desktop session.
2. On Windows, keep a normal foreground app focused and confirm the Active window diagnostics line remains `Ready` instead of degrading.
3. Trigger `Cmd/Ctrl+Shift+C` while another app is focused, then again with the helper focused to verify both global and window-local shortcut paths.
4. Trigger `Cmd/Ctrl+Shift+S` and confirm the status text clearly reports whether the helper used region capture, a full-screen fallback, or no backend at all.
5. Inspect Recent captures and confirm metadata, OCR details, and screenshot preview thumbnails render after a successful upload.
