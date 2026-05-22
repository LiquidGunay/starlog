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
4. Open a browser path for your surface:
   - Laptop browser: `http://localhost:3000/assistant`
   - Phone browser on LAN: `http://<LAN_IP>:3000/assistant`
   - Hosted fallback: `https://starlog-web-production.up.railway.app/login`
5. For browser access, choose `Set Up Starlog` on a new instance and create a passphrase.
6. Sign in with the same passphrase and return to `/assistant`.

## PWA Access And Login

The desktop web app is the primary browser client. For local laptop use, open
`http://localhost:3000`. For phone browser fallback on the same network, start the stack with
`./scripts/dev_stack.sh --lan`, then open `http://<LAN_IP>:3000`.

On a new local instance, choose `Set Up Starlog` and create a Starlog passphrase. On an existing
instance, choose `Sign In` and enter that same passphrase. Keep the passphrase and bearer token out
of docs, commits, screenshots, and chat transcripts.

The PWA should only receive the Starlog API base and Starlog session/token information from the
login/session controls. Do not put OpenAI, Codex, Railway, or local worker credentials into the PWA
or native mobile app.

Hosted access currently uses:

- `https://starlog-web-production.up.railway.app/login`
- API base `https://starlog-api-production.up.railway.app`

Hosted login flow for verification smoke and operator checks:

- Open the hosted login URL.
- On first use for a device/user, choose `Set Up Starlog` and set the passphrase.
- On return visits, choose `Sign In` and enter the same passphrase.
- After sign-in, copy the session token from the in-app login/session controls only when required for
  scripted checks, then clear it from temporary notes/screenshots after use.

Current access status:

- Public hosted `/login`, `/assistant`, and API health reachability status is tracked in
  `docs/CURRENT_STATE.md`; current hosted proof should be regenerated into the latest ignored
  `.localdata` evidence lane before release decisions.
- Authenticated hosted passphrase login was last proven on 2026-05-15. The current docs do not include
  the hosted passphrase or bearer token.
- Hosted full-flow smoke and release-gate checks are still re-prove items before treating Railway as
  release-ready.
- Native app remains primary on phone; the browser PWA path is fallback-only.

## Daily Use

Start in `Assistant`.

Useful commands:

```text
generate briefing for today
render briefing audio for today
create task Review project notes due tomorrow priority 2
summarize latest artifact
make cards from the last capture
list artifacts
capture Article note: save this for later
plan time blocks for today from 9 to 17
create event Deep Work from 2026-05-25 09:00 to 2026-05-25 10:00
show due cards
```

The Assistant records the command in the persistent thread and returns cards or follow-up actions
when a support surface needs attention. Deterministic command coverage currently includes Library
capture/list/inspect/search commands, Planner task/internal-calendar/time-block/briefing/alarm commands,
and Review due-card loading plus explicit review-grade confirmation paths. Unsupported actions such as
Library bulk deletion, Google Calendar connection/sync or conflict resolution from chat, Review bulk or
auto-grading, and live provider-selected panels return clear limitation responses instead of fake success.
You can also ask what it can control or where its current limits are; the capability answer covers
Assistant, Library, Planner, and Review while calling out unproven live STT, live provider-chosen panels,
production parity, and full all-surface mutation coverage.

## Surfaces

- `Assistant`: commands, follow-up questions, confirmations, cards, and returned results.
- `Library`: captures, artifacts, notes, source layers, provenance, and generated outputs.
- `Planner`: tasks, schedule, time blocks, briefing state, and alarm setup.
- `Review`: recall, understanding, application, synthesis, and judgment practice.

## Phone

The native mobile app is the primary phone client. Use the mobile PWA only as a fallback when
the installable app is unavailable or you need a quick browser check.

Use the native app for:

- quick capture
- Assistant commands
- voice input
- review on the go
- morning briefing cache/playback
- morning alarm setup

For local phone setup, use [PHONE_SETUP.md](/home/ubuntu/starlog/docs/PHONE_SETUP.md).

Interview-loop note:

- Native `Assistant` is partially migrated to the RN assistant-ui dynamic UI path for the interview-prep
  flow (`read` -> `unlock` -> `question` -> review grade) and due-date task creation. Current evidence
  includes assistant-ui shell/thread/composer markers, dynamic-panel host metadata, Assistant-hosted
  due-date/review-grade controls, and Planner cache-first alarm scheduling. Unsupported Starlog panel
  shapes still use compatibility fallback screens; those fallbacks are not the target runtime.
- Current native Android evidence is local/physical-device evidence from the fresh-local SRS validation
  harness. Latest proof:
  `.localdata/android-local-validation/builds/20260521T173754Z/latest.json`. It proves the bounded
  interview-prep loop, due-date dynamic UI task creation, Assistant-hosted review-grade dynamic UI, and
  Planner briefing/alarm path, not broad production-hosted Android parity or full server-owned native
  runtime migration.

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

Starlog's default hosted/API LLM model is `gpt-5.4-mini`. The local Codex worker also defaults to
passing `gpt-5.4-mini` to `codex exec`. If your Codex CLI is authenticated with a ChatGPT account that
does not expose `gpt-5.4-mini`, run the worker with:

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
