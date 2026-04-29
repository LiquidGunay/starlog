# Starlog User Guide

Starlog is organized around one persistent Assistant thread. Use `Assistant` for commands and
decisions, then open `Library`, `Planner`, or `Review` only when you need a deeper surface.

## First Run

1. Start the local stack:

```bash
./scripts/dev_stack.sh
```

For phone testing on the same network:

```bash
./scripts/dev_stack.sh --lan
```

2. Open the web app.
3. Set the API base if the app asks for it:
   - local laptop: `http://localhost:8000`
   - phone over LAN: `http://<LAN_IP>:8000`
4. Choose `Set Up Starlog` on a new instance and create a passphrase.
5. Sign in with the same passphrase.
6. Open `/assistant`.

## Daily Use

Start in `Assistant`.

Useful commands:

```text
generate briefing for today
render briefing audio for today
create task Review project notes due tomorrow priority 2
summarize latest artifact
make cards from the last capture
plan time blocks for today from 9 to 17
show due cards
```

The Assistant records the command in the persistent thread and returns cards or follow-up actions
when a support surface needs attention.

## Surfaces

- `Assistant`: commands, follow-up questions, confirmations, cards, and returned results.
- `Library`: captures, artifacts, notes, source layers, provenance, and generated outputs.
- `Planner`: tasks, schedule, time blocks, briefing state, and alarm setup.
- `Review`: recall, understanding, application, synthesis, and judgment practice.

## Phone

The native mobile app is the primary phone client. Use it for:

- quick capture
- Assistant commands
- voice input
- review on the go
- morning briefing cache/playback
- morning alarm setup

For local phone setup, use [PHONE_SETUP.md](/home/ubuntu/starlog/docs/PHONE_SETUP.md).

## Codex And Local AI

The phone and PWA authenticate to Starlog, not directly to Codex. Codex/OpenAI credentials stay on
the laptop worker, API process, desktop helper, or another trusted bridge.

Typical local worker command:

```bash
export STARLOG_TOKEN=YOUR_STARLOG_BEARER_TOKEN

PYTHONPATH=services/api uv run --project services/api \
  python scripts/local_ai_worker.py \
  --api-base http://localhost:8000 \
  --token "$STARLOG_TOKEN"
```

Starlog's default hosted/API LLM model is `gpt-5-mini`. The local Codex worker also defaults to
passing `gpt-5-mini` to `codex exec`. If your Codex CLI is authenticated with a ChatGPT account that
does not expose `gpt-5-mini`, run the worker with:

```bash
PYTHONPATH=services/api uv run --project services/api \
  python scripts/local_ai_worker.py \
  --api-base http://localhost:8000 \
  --token "$STARLOG_TOKEN" \
  --codex-use-cli-default
```

## Smoke Test The User Flow

After signing in and getting a bearer token, run:

```bash
python scripts/starlog_user_flow_smoke.py \
  --api-base http://localhost:8000 \
  --token "$STARLOG_TOKEN"
```

To also queue a Codex-assisted command-planning job:

```bash
python scripts/starlog_user_flow_smoke.py \
  --api-base http://localhost:8000 \
  --token "$STARLOG_TOKEN" \
  --queue-codex
```

The Codex job is completed by `scripts/local_ai_worker.py`.
