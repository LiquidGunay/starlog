# Morning Briefing And Voice

This is the current working path for a spoken morning briefing on phone.

## What Works Now

- API briefing generation through `/v1/briefings/generate`.
- Assistant command wrappers:
  - `generate briefing for today`
  - `render briefing audio for today`
  - `schedule alarm for today at 07:00`
- Queued TTS job creation through `/v1/briefings/{briefing_id}/audio/render`.
- Laptop-local worker completion for `tts` jobs.
- Native phone cache/playback of briefing packages.
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

Start the worker:

```bash
PYTHONPATH=services/api uv run --project services/api \
  python scripts/local_ai_worker.py \
  --api-base http://<LAN_IP>:8000 \
  --token "$STARLOG_TOKEN" \
  --codex-use-cli-default
```

Use `--codex-use-cli-default` only if your local Codex auth mode does not support `gpt-5-mini`.
Briefing audio itself only needs the TTS runtime.

## Generate And Render From Assistant

In `/assistant` on PWA or phone, send:

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
3. Open `Planner`.
4. In the briefing/alarm area:
   - refresh or generate the briefing package
   - queue audio render if needed
   - wait for the worker to complete the job
   - cache the briefing
   - play cached briefing
   - schedule the daily alarm

If no rendered audio is available, the phone falls back to speaking the briefing text with on-device
speech output.

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
