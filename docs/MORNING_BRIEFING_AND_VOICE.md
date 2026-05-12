# Morning Briefing And Voice

This is the native-first phone path for a spoken morning briefing.
Use the phone PWA only as a fallback when the native app is unavailable.

## What Works Now

- API briefing generation through `/v1/briefings/generate`.
- Assistant command wrappers:
  - `generate briefing for today`
  - `render briefing audio for today`
  - `schedule alarm for today at 07:00`
- Queued TTS job creation through `/v1/briefings/{briefing_id}/audio/render`.
- Laptop-local worker completion for `tts` jobs.
- Native phone cache/playback of briefing packages.
- Host-side synthesis + native playback contract (phone remains the consumer boundary for briefing audio).
- Native phone alarm scheduling that opens the cached briefing path.

## Setup

Start Starlog:

```bash
./scripts/dev_stack.sh --lan
```

Export your Starlog bearer token:

```bash
export STARLOG_TOKEN=YOUR_STARLOG_BEARER_TOKEN
```

Configure one local TTS runtime. A command-template provider is the most portable path:

```bash
export STARLOG_TTS_COMMAND='piper --model /ABS/PATH/en_US-lessac-medium.onnx --output_file {output_path}'
```

For a smaller neural local TTS runtime, the Starlog local TTS server can also use KittenTTS when
the Python packages are installed in the local voice environment:

```bash
uv pip install 'soundfile>=0.12' \
  'https://github.com/KittenML/KittenTTS/releases/download/0.8.1/kittentts-0.8.1-py3-none-any.whl'
export STARLOG_LOCAL_TTS_BACKEND='kitten'
export STARLOG_LOCAL_TTS_PROVIDER_NAME='kitten_tts'
export STARLOG_LOCAL_TTS_MODEL_NAME='KittenML/kitten-tts-nano-0.8'
PYTHONPATH=services/ai-runtime uv run --project services/ai-runtime \
  python scripts/local_tts_server.py
```

V1 split: synthesis runs through the host-side worker, while the native app still consumes cached audio files.
In-app bundled KittenTTS should plug into that same `briefing-{date}.wav` path only after Android-native ONNX proofing.

That means:
- the command and render queue are host-driven today,
- the cached `briefing-{date}.wav` contract remains unchanged on phone,
- `expo-speech` remains the fallback output when host rendering is unavailable.

Start the worker:

```bash
PYTHONPATH=services/api uv run --project services/api \
  python scripts/local_ai_worker.py \
  --api-base http://<LAN_IP>:8000 \
  --token "$STARLOG_TOKEN" \
  --codex-use-cli-default
```

Use `--codex-use-cli-default` only if your local Codex auth mode does not support `gpt-5.4-mini`.
Briefing audio itself only needs the TTS runtime.

## Generate And Render From Assistant

In `/assistant` on native app or PWA fallback, send:

```text
generate briefing for today
```

Then:

```text
render briefing audio for today
```

The second command queues a TTS job. Keep the worker running until the job completes.

## Use It On Native Phone

1. Open the native app.
2. Set API base and bearer token.
3. Open `Assistant` for generate/render commands and `Planner` for alarm setup.
4. In the briefing/alarm area:
   - refresh or generate the briefing package
   - queue audio render if needed
   - wait for the worker to complete the job
   - cache the briefing
   - play cached briefing
   - schedule the daily alarm

If no rendered audio is available, the phone falls back to speaking the briefing text with on-device
speech output.

## Kitten TTS Native Bundle Path

Kitten TTS is a plausible native-app bundle candidate, but it should enter Starlog through a native
runtime seam rather than as a Python package inside the React Native app.

Current upstream facts checked on 2026-05-12:

- KittenTTS is an ONNX-based Python library in developer preview, with 15M to 80M parameter models.
- `kitten-tts-nano-0.8-int8` is the smallest target, about 25 MB, Apache-2.0, and produces 24 kHz
  audio.
- The upstream roadmap still lists a mobile SDK as future work.
- ONNX Runtime has a React Native package, but using it still requires a native build path and model
  assets packaged with the app.

Implications for Starlog:

- Expo Go is not enough for this path. Keep using native Android preview/production builds for local
  voice work.
- Do not commit model binaries until the exact model version, license file, APK size impact, and
  runtime backend are pinned.
- Package the model and voice data under native app assets once selected; do not ship those assets to
  the PWA.
- Keep `expo-speech` as the on-device fallback until a native Kitten runtime can synthesize to a local
  audio file and return a playable URI.
- `EXPO_PUBLIC_STARLOG_KITTEN_TTS_STATUS` may describe packaged assets, but it must not switch playback
  away from `expo-speech` until a native adapter is registered in the app.
- The first runtime PR should wire Android assets plus an ONNX/native module, register that native
  adapter, then validate `Play Briefing` and scheduled alarm playback on the physical phone.

## Smoke Test

Run the API-level smoke:

```bash
python scripts/starlog_user_flow_smoke.py \
  --api-base http://localhost:8000 \
  --token "$STARLOG_TOKEN"
```

Expected result:

- briefing command executes
- briefing audio command queues a `briefing_audio` job
- task command is planned without writing unless `--write-task` is used

To prove the queued audio job actually completes, keep the worker running and inspect `/ai-jobs` in
the PWA or refresh the phone's briefing cache after the worker finishes.
