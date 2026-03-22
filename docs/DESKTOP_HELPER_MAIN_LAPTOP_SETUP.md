# Desktop Helper Main-Laptop Setup Pack

Last updated: 2026-03-15

This guide is the daily-use setup handoff for the Linux desktop helper on this host.

## Selected artifact

- Package: `artifacts/desktop-helper/v0.1.0/x86_64-linux/starlog-desktop-helper-v0.1.0-x86_64-linux-starlog-desktop-helper_0.1.0_amd64.deb`
- Binary fallback: `artifacts/desktop-helper/v0.1.0/x86_64-linux/starlog-desktop-helper-v0.1.0-x86_64-linux-starlog_desktop_helper`
- Checksums:
  - `.deb`: `71acab0501593cb42167b171aa68a95dfafdad4b7b42d542db89c4a117f49892`
  - binary: `ebbe89fb7de09b4be6beaec3f8945efed48e519937c46f0888cacc5474885584`

## Production API target

- Verified production API health: `https://starlog-api-production.up.railway.app/v1/health`
- Use this API base in the helper for the current hosted setup:
  - `https://starlog-api-production.up.railway.app`

## Linux prerequisites on this host

The latest runtime probe on this host still reported:

- `clipboard`: missing
- `screenshot`: missing
- `active_window`: degraded
- `ocr`: degraded

Recommended install command for this Linux setup:

```bash
sudo apt-get update
sudo apt-get install -y wl-clipboard gnome-screenshot xdotool tesseract-ocr
```

Notes:

- `wl-clipboard` satisfies the Linux clipboard backend. `xclip` or `xsel` are valid alternatives.
- `gnome-screenshot` restores a deterministic screenshot backend on this host. `scrot` or ImageMagick `import` are alternatives.
- `xdotool` restores richer active-window metadata on X11-class sessions.
- `tesseract-ocr` enables local screenshot OCR.

## Install

```bash
sudo dpkg -i artifacts/desktop-helper/v0.1.0/x86_64-linux/starlog-desktop-helper-v0.1.0-x86_64-linux-starlog-desktop-helper_0.1.0_amd64.deb
```

If Debian reports unresolved dependencies:

```bash
sudo apt-get install -f
```

App entry points after install:

- desktop launcher: `Starlog Desktop Helper`
- binary: `/usr/bin/starlog_desktop_helper`

## First-run setup

1. Launch `Starlog Desktop Helper`.
2. From the popup, click `Open Workspace`.
3. Set `API base` to `https://starlog-api-production.up.railway.app`.
4. Paste the bearer token into `Bearer token`.
5. Click `Copy Setup Checklist` and keep the copied summary for support/reset reference.
6. Click `Refresh Diagnostics`.
7. Resolve any runtime items still marked `Partial` or `Unavailable`.

Production-origin note:

- The current Railway API CORS allowlist is intentionally scoped to the hosted PWA domain.
- A local browser-served helper fallback (`http://127.0.0.1:4173`) therefore fails production preflight with `Disallowed CORS origin`.
- Validate daily use against the installed Tauri helper on this laptop, or widen `STARLOG_CORS_ALLOW_ORIGINS` explicitly if you need browser-fallback clipping to hit Railway directly.

The helper now has a built-in `Reset Local State` control. It clears:

- local API base
- secure/local bearer token
- recent capture history
- remembered quick/workspace surface preference

## Daily-use smoke

1. Trigger `Cmd/Ctrl+Shift+C`.
2. Confirm the status line reports a saved clip and `Recent Captures` shows the new artifact id.
3. Trigger `Cmd/Ctrl+Shift+S`.
4. Confirm the status line reports either a saved screenshot or a precise missing-backend note.
5. In the workspace, inspect `Runtime Diagnostics` and `Recent Captures` for:
   - capture backend labels,
   - active-window metadata,
   - OCR state,
   - screenshot preview thumbnails.

## Upgrade, uninstall, reset

Upgrade in place:

```bash
sudo dpkg -i artifacts/desktop-helper/v0.1.0/x86_64-linux/starlog-desktop-helper-v0.1.0-x86_64-linux-starlog-desktop-helper_0.1.0_amd64.deb
```

Preferred reset path before uninstall or device handoff:

1. Open the helper workspace.
2. Click `Reset Local State`.
3. Close the helper.

Remove the package:

```bash
sudo apt remove starlog-desktop-helper
```

If you need to clear the secure token after the app has already been removed, remove the OS keyring entry for:

- service: `starlog.desktop-helper`
- account: `api-token`

## Evidence from this pass

- QA screenshots:
  - `artifacts/desktop-helper/qa/2026-03-15T18-58-51-736Z/desktop-helper-workspace-config.png`
  - `artifacts/desktop-helper/qa/2026-03-15T18-58-51-736Z/desktop-helper-quick-popup.png`
  - `artifacts/desktop-helper/qa/2026-03-15T18-58-51-736Z/desktop-helper-workspace-diagnostics.png`
  - `artifacts/desktop-helper/qa/2026-03-15T18-58-51-736Z/screenshots.json`
- Package smoke:
  - `dpkg-deb -I` confirmed package `starlog-desktop-helper`, version `0.1.0`, architecture `amd64`
  - `dpkg-deb -x` confirmed payload includes `/usr/bin/starlog_desktop_helper` and the desktop launcher file
  - `ldd` confirmed the staged binary links against GTK/WebKit libraries on this host
  - `dpkg --dry-run -i` still warns on `/var/log/dpkg.log` without privilege in this environment, but the unpack plan is otherwise valid
