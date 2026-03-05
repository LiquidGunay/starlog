# Starlog Desktop Helper (Tauri)

Scaffold for the cross-platform desktop helper used to clip content from non-browser apps.

## Planned v1 capabilities
- Hotkeys (Cmd/Ctrl+Shift+C and Cmd/Ctrl+Shift+S) wired at UI level; global OS registration is next.
- Screenshot region capture stub (macOS uses `screencapture -i`; other platforms return a placeholder result)
- Metadata enrichment (window title, app source)
- Queued upload to Starlog API

This scaffold currently provides a lightweight UI shell, clipboard capture to `POST /v1/artifacts`, and screenshot command wiring.
