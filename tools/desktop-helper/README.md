# Starlog Desktop Helper (Tauri)

Desktop helper for clipping content from non-browser apps.

## Current capabilities
- Global OS shortcuts plus window-local fallback (`Cmd/Ctrl+Shift+C` and `Cmd/Ctrl+Shift+S`).
- Persisted API base and bearer token between launches.
- Native clipboard capture in Tauri runtime.
- Best-effort active app/window metadata capture per clip.
- Native screenshot capture via platform commands:
  - macOS: interactive `screencapture -i`
  - Windows: full-screen PowerShell capture
  - Linux: best-effort `grim`/`slurp`, `gnome-screenshot`, or ImageMagick `import`
- Strict on-device OCR attempt for screenshots via local `tesseract` when available.
- Queued upload to Starlog API.
- In-app recent-capture history with artifact IDs, clip summaries, screenshot thumbnails, and captured context.

The remaining desktop-helper work is mostly deeper runtime validation and extra capture controls, not basic native wiring.
