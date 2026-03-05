# Starlog Desktop Helper (Tauri)

Scaffold for the cross-platform desktop helper used to clip content from non-browser apps.

## Planned v1 capabilities
- Hotkeys (Cmd/Ctrl+Shift+C and Cmd/Ctrl+Shift+S) wired at UI level; global OS registration is next.
- Screenshot region capture (macOS uses `screencapture -i`; other platforms return a placeholder result).
- Strict on-device OCR attempt for screenshots via local `tesseract` when available.
- Metadata enrichment (window title, app source).
- Queued upload to Starlog API.

This scaffold currently provides a lightweight UI shell, clipboard capture to `POST /v1/capture`, and screenshot command wiring that can post OCR text when present.
