# Desktop Helper Main-Laptop Setup Pack

Last updated: 2026-04-08

This guide is the daily-use setup handoff for the Linux desktop helper on this host.
The helper is a capture-first Starlog companion: its primary job is to grab clipboard and
screenshots quickly, show recent captures, and hand those captures into `Assistant` or `Library`.

## Current package generation

The old committed desktop-helper RC artifacts were removed from the repo. Generate a fresh package
before installing on this laptop:

```bash
cd tools/desktop-helper
./scripts/build_release_artifacts.sh
```

The generated package, binary fallback, checksums, manifest, and build info are written under
`artifacts/desktop-helper/v<version>/<arch-os>/`.

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

Install the freshly generated `.deb` from `artifacts/desktop-helper/v<version>/<arch-os>/`.

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

Current-master local proof status:

- helper browser-fallback smoke passed against a fresh local API on `http://127.0.0.1:8010`
- bridge auth + local STT smoke passed against `http://127.0.0.1:8091` and `http://127.0.0.1:8171`
- the only remaining Linux-host blocker is installing native clipboard/screenshot/OCR packages from an interactive `sudo` session

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
export STARLOG_BRIDGE_CONTEXT_JSON='{"app_name":"Codex","window_title":"Desktop Helper Smoke","platform":"linux"}'
PYTHONPATH=services/ai-runtime uv run --project services/ai-runtime uvicorn bridge.server:app --host 127.0.0.1 --port 8091
```

4. Generate a short local smoke WAV, then smoke it:

```bash
python3 scripts/write_debug_wav.py \
  --output-path artifacts/desktop-helper/rc-evidence/<timestamp>/voice-runtime/smoke.wav \
  --seconds 1.2
```

```bash
STARLOG_LOCAL_BRIDGE_AUTH_TOKEN='bridge-secret' \
STARLOG_LOCAL_VOICE_SMOKE_AUDIO_PATH=artifacts/desktop-helper/rc-evidence/<timestamp>/voice-runtime/smoke.wav \
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
5. Use the recent capture actions to verify:
   - `Open in Library` opens the capture in the main Starlog workspace.
   - `Ask Assistant about this capture` hands the capture into the primary thread flow.
6. Trigger `Cmd/Ctrl+Shift+S`.
7. Confirm the status line reports either a saved screenshot or a precise missing-backend note.
8. In the workspace, inspect `Runtime Diagnostics` and `Recent Captures` for:
   - capture backend labels,
   - active-window metadata,
   - OCR state,
   - screenshot preview thumbnails.

## Upgrade, uninstall, reset

Upgrade in place:

Install the newly generated `.deb` from `artifacts/desktop-helper/v<version>/<arch-os>/`.

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

## Evidence

Old committed RC evidence was removed from the repo. Regenerate current evidence with the daily-use
smoke above or the unified proof runner in [docs/CROSS_SURFACE_PROOF.md](/home/ubuntu/starlog/docs/CROSS_SURFACE_PROOF.md).

Host blocker that still applies:

- native Linux clipboard, screenshot, and OCR binaries are not installed here yet
- installing them from this shell still requires interactive `sudo`
- native screenshot/OCR validation remains blocked on host setup rather than helper code
