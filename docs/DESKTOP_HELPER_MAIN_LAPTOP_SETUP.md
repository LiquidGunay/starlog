# Desktop Helper Main-Laptop Setup Pack

Last updated: 2026-03-22

This guide is the daily-use setup handoff for the Linux desktop helper on this host.

## Selected artifact

- Package: `artifacts/desktop-helper/v0.1.0/x86_64-linux/starlog-desktop-helper-v0.1.0-x86_64-linux-starlog-desktop-helper_0.1.0_amd64.deb`
- Binary fallback: `artifacts/desktop-helper/v0.1.0/x86_64-linux/starlog-desktop-helper-v0.1.0-x86_64-linux-starlog_desktop_helper`
- Checksums:
  - `.deb`: `2c022ceb315cb214f5da09a81db4a933c02b4720d75a1aa8764546792171cead`
  - binary: `bcb87e6989c1ee940b602448bf64fa5dfb5c7b6c46ce5d69ee97ddb8b3318efc`

## Production API target

- Verified production API health: `https://starlog-api-production.up.railway.app/v1/health`
- Use this API base in the helper for the current hosted setup:
  - `https://starlog-api-production.up.railway.app`

## Linux prerequisites on this host

The latest runtime probe on this host still reports:

- `clipboard`: missing
- `screenshot`: missing
- `active_window`: degraded
- `ocr`: degraded

Generate the exact package list for this host:

```bash
tools/desktop-helper/scripts/bootstrap_linux_runtime_deps.sh \
  --output-json artifacts/desktop-helper/rc-evidence/<timestamp>/voice-runtime/linux-bootstrap.json
```

Current install command for this Linux setup:

```bash
sudo apt-get update
sudo apt-get install -y wl-clipboard grim slurp xclip scrot xdotool gnome-screenshot imagemagick tesseract-ocr ffmpeg
```

Notes:

- `wl-clipboard` and `xclip` cover the Wayland/X11 clipboard backends surfaced by the helper.
- `grim` + `slurp`, `gnome-screenshot`, `scrot`, and ImageMagick `import` cover the Linux screenshot backends surfaced by the helper.
- `xdotool` restores richer active-window metadata on X11-class sessions.
- `tesseract-ocr` enables local screenshot OCR.
- `ffmpeg` keeps local voice processing flexible when audio is not already WAV.

Exact blocker on this host:

- package installation still requires interactive `sudo`, so the generated `apt-get` command must be run manually on the Linux side.

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

Optional local voice runtime for this laptop:

1. Start the rootless local STT server from the repo. This path works on this host without `sudo`:

```bash
STARLOG_LOCAL_STT_MODEL='tiny.en' \
STARLOG_LOCAL_STT_DEVICE='auto' \
uv run --project services/ai-runtime --extra local-voice python scripts/local_stt_server.py
```

Notes:

- On this host, auto mode initially sees the NVIDIA GPU but falls back to CPU because `libcublas.so.12` is not present in WSL.
- If you already have a resident `whisper.cpp` server, you can keep using `scripts/run_whisper_cpp_server.sh` instead.

2. TTS is still optional on this host. If you already have a working local TTS command, start the wrapper:

```bash
export STARLOG_LOCAL_TTS_PROVIDER_NAME='vibevoice_community_fallback'
export STARLOG_LOCAL_TTS_GPU_MODE='gpu'
export STARLOG_LOCAL_TTS_COMMAND='piper --model /ABS/PATH/en_US-lessac-medium.onnx --output_file {output_path}'
PYTHONPATH=services/ai-runtime uv run --project services/ai-runtime python scripts/local_tts_server.py
```

3. Start the bridge with server-backed STT env:

```bash
export STARLOG_BRIDGE_AUTH_TOKEN='bridge-secret'
export STARLOG_BRIDGE_STT_SERVER_URL='http://127.0.0.1:8171/inference'
export STARLOG_BRIDGE_CONTEXT_JSON='{"app_name":"Codex","window_title":"WI-585 Voice Smoke","platform":"linux"}'
PYTHONPATH=services/ai-runtime uv run --project services/ai-runtime uvicorn bridge.server:app --host 127.0.0.1 --port 8091
```

4. Smoke it:

```bash
STARLOG_LOCAL_BRIDGE_AUTH_TOKEN='bridge-secret' \
STARLOG_LOCAL_VOICE_SMOKE_AUDIO_PATH=artifacts/desktop-helper/rc-evidence/<timestamp>/voice-runtime/jfk.wav \
STARLOG_LOCAL_VOICE_SMOKE_TEXT_HINT='and so my fellow Americans' \
STARLOG_LOCAL_VOICE_SMOKE_SKIP_TTS=1 \
PYTHONPATH=services/ai-runtime \
uv run --project services/ai-runtime python scripts/local_voice_runtime_smoke.py
```

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

1. If you are validating against a local API instead of Railway, start it on an open port. The 2026-03-22 RC pass used `127.0.0.1:8010` because `127.0.0.1:8000` was already occupied on this host.
2. Run the browser-fallback RC smoke when you need a deterministic local proof of bridge discovery plus one real clipboard upload:

```bash
STARLOG_DESKTOP_HELPER_RC_API_BASE='http://127.0.0.1:8010' \
STARLOG_DESKTOP_HELPER_RC_BEARER_TOKEN='<token>' \
STARLOG_DESKTOP_HELPER_RC_BRIDGE_TOKEN='bridge-secret' \
node tools/desktop-helper/scripts/capture_rc_smoke.mjs artifacts/desktop-helper/rc-evidence/<timestamp>
```

3. For an installed native helper check, trigger `Cmd/Ctrl+Shift+C`.
4. Confirm the status line reports a saved clip and `Recent Captures` shows the new artifact id.
5. Trigger `Cmd/Ctrl+Shift+S`.
6. Confirm the status line reports either a saved screenshot or a precise missing-backend note.
7. In the workspace, inspect `Runtime Diagnostics` and `Recent Captures` for:
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

- RC screenshots and smoke summary:
  - `artifacts/desktop-helper/rc-evidence/2026-03-22T14-06-24Z/desktop-helper-rc-config.png`
  - `artifacts/desktop-helper/rc-evidence/2026-03-22T14-06-24Z/desktop-helper-rc-quick-popup.png`
  - `artifacts/desktop-helper/rc-evidence/2026-03-22T14-06-24Z/desktop-helper-rc-diagnostics.png`
  - `artifacts/desktop-helper/rc-evidence/2026-03-22T14-06-24Z/rc-smoke.json`
- Runtime bootstrap + dependency probe:
  - `artifacts/desktop-helper/rc-evidence/2026-03-22T15-00-00Z/voice-runtime/linux-bootstrap.json`
  - `artifacts/desktop-helper/rc-evidence/2026-03-22T15-00-00Z/voice-runtime/runtime-dependency-probe.json`
- Real local voice smoke:
  - `artifacts/desktop-helper/rc-evidence/2026-03-22T15-00-00Z/voice-runtime/jfk.wav`
  - `artifacts/desktop-helper/rc-evidence/2026-03-22T15-00-00Z/voice-runtime/local-voice-smoke.json`
  - `artifacts/desktop-helper/rc-evidence/2026-03-22T15-00-00Z/voice-runtime/local-stt-direct.json`
  - bridge auth passed, the rootless local STT server returned `and so my fellow Americans ask not what your country can do for you...`, and the direct STT response recorded `device=cpu` / `compute_type=int8`
- Real local capture:
  - local API on `http://127.0.0.1:8010`
  - helper uploaded artifact `art_b40fadfafc55444897413ec4bdc59593`
  - `GET /v1/artifacts?limit=5` confirmed the stored capture content and helper metadata
- Package smoke:
  - `dpkg-deb -I` confirmed package `starlog-desktop-helper`, version `0.1.0`, architecture `amd64`
  - `dpkg-deb -x` confirmed payload includes `/usr/bin/starlog_desktop_helper` and the desktop launcher file
  - `ldd` confirmed the staged binary links against GTK/WebKit libraries on this host
  - `./node_modules/.bin/playwright test tools/desktop-helper/tests/helper.spec.ts --grep 'configured local bridge with bridge auth|discover a reachable localhost bridge|window shortcut clips clipboard text'` passed after the RC smoke server was no longer bound on `127.0.0.1:4173`
- Host blocker that still applies:
  - native Linux clipboard, screenshot, and OCR binaries are not installed here yet, and installing them from this shell still requires interactive `sudo`, so native screenshot/OCR validation remains blocked on host setup rather than helper code
