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
| Clipboard capture | `wl-paste`, `xclip`, or `xsel`; browser fallback while focused | `pbpaste` | PowerShell `Get-Clipboard` | Diagnostics card reports the preferred backend. |
| Screenshot capture | `grim+slurp`, `gnome-screenshot`, `import`, `grim`, or `scrot` | `screencapture -i` | PowerShell full-screen capture | Linux falls back to full-screen capture when only `grim` or `scrot` is present. |
| Active window metadata | `xdotool` or `hyprctl` | `osascript` | PowerShell user32 bridge | Missing metadata does not block capture. |
| OCR | `tesseract` | `tesseract` | `tesseract` | OCR is intentionally local-only. |
| Shortcut wiring | Global shortcut plugin plus window fallback | Global shortcut plugin plus window fallback | Global shortcut plugin plus window fallback | Window-local key handling remains the last-resort fallback. |

## Validation commands

- Browser-style validation: `./node_modules/.bin/playwright test`
- Rust backend validation: `cd tools/desktop-helper/src-tauri && cargo check`
- Native helper build: `cd tools/desktop-helper && ./node_modules/.bin/tauri build`

## Manual runtime checks

1. Launch the helper and confirm the runtime diagnostics card shows the expected clipboard/screenshot backends for the current desktop session.
2. Trigger `Cmd/Ctrl+Shift+C` while another app is focused, then again with the helper focused to verify both global and window-local shortcut paths.
3. Trigger `Cmd/Ctrl+Shift+S` and confirm the status text clearly reports whether the helper used region capture, a full-screen fallback, or no backend at all.
4. Inspect Recent captures and confirm metadata, OCR details, and screenshot preview thumbnails render after a successful upload.
