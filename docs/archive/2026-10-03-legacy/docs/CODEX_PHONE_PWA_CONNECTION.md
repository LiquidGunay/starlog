# Connecting Codex to Phone and PWA

Last reviewed: 2026-04-29

## Short Answer

Starlog does not currently have a phone/PWA OAuth2 flow that logs the client directly into Codex.

The intended v1 pattern is:

```text
Phone or PWA
  -> Starlog API
  -> queued AI job or assistant command
  -> local laptop worker or server-side bridge
  -> Codex/OpenAI/local provider
  -> result stored back through Starlog API
  -> Phone or PWA updates from API state
```

Codex credentials must stay out of browser JavaScript and mobile app bundles. If Codex is used, the credentials live where the worker or server-side bridge runs.

## What Exists Today

Starlog has these relevant paths:

- `scripts/local_ai_worker.py`
  - Processes queued AI jobs from the Starlog API.
  - Can run `codex exec` for `llm_summary`, `llm_cards`, `llm_tasks`, and `llm_agent_plan` jobs.
  - Also handles local voice jobs when configured.
- `scripts/codex_queue_runner.py`
  - Smaller runner for Codex jobs only.
- `services/api/app/services/integrations_service.py`
  - Defines an experimental server-side `codex_bridge` provider.
  - The bridge is opt-in and should remain disabled unless explicitly configured.
- `services/api/app/services/ai_service.py`
  - Keeps fallback routing available when bridge execution is unavailable.

Related docs:

- [LOCAL_AI_WORKER.md](LOCAL_AI_WORKER.md)
- [CODEX_AGENT_PROVIDER_FEASIBILITY.md](CODEX_AGENT_PROVIDER_FEASIBILITY.md)

## Credentials Model

Phone/PWA authentication and Codex authentication are separate.

Phone/PWA:

- Authenticates to Starlog.
- Sends captures, commands, voice jobs, and assistant interactions to the Starlog API.
- Does not receive Codex tokens, OpenAI API keys, or bridge secrets.

Codex worker or bridge:

- Runs on a trusted machine, usually the laptop for the low-cost v1 setup.
- Uses whatever Codex CLI login or server-side credential configuration is available on that machine.
- Pulls queued jobs from the Starlog API and writes results back.

There is no committed client-side Codex OAuth2 integration for v1. If OAuth2 is added later, it should terminate server-side or through a trusted helper, not expose provider credentials to PWA/mobile runtime code.

## Local Laptop Worker Flow

Use this when the phone/PWA talks to a local or hosted Starlog API and your laptop performs Codex work.

1. Install and sign in to the Codex CLI on the laptop.
2. Smoke-test Codex auth:

```bash
python scripts/codex_auth_smoke.py
```

By default this checks `gpt-5.4-mini`, which is Starlog's default hosted/API LLM model. If the Codex
CLI is authenticated with a ChatGPT account that does not expose `gpt-5.4-mini`, the smoke will reach
OpenAI but fail with a model-support error. In that case either use API-key/project auth that can use
`gpt-5.4-mini`, or verify the local account path with:

```bash
python scripts/codex_auth_smoke.py --use-cli-default
```

To prove Starlog can queue from the app layer and launch Codex through the local worker path:

```bash
uv run --project services/api --extra dev python scripts/codex_app_launch_smoke.py
```

3. Start the Starlog API, either locally or on Railway.
4. Set a Starlog API bearer token for the worker:

```bash
export STARLOG_TOKEN=YOUR_BEARER_TOKEN
```

5. Run the full local AI worker against a local API:

```bash
PYTHONPATH=services/api uv run --project services/api \
  python scripts/local_ai_worker.py \
  --api-base http://localhost:8000 \
  --token "$STARLOG_TOKEN"
```

The worker defaults to `gpt-5.4-mini` for `codex exec`. If your current Codex CLI auth mode rejects
that model, use the CLI's configured/default model until auth is changed:

```bash
PYTHONPATH=services/api uv run --project services/api \
  python scripts/local_ai_worker.py \
  --api-base http://localhost:8000 \
  --token "$STARLOG_TOKEN" \
  --codex-use-cli-default
```

6. Or run only the narrow Codex-local queue runner:

```bash
PYTHONPATH=services/api uv run --project services/api \
  python scripts/codex_queue_runner.py \
  --api-base http://localhost:8000 \
  --token "$STARLOG_TOKEN"
```

`scripts/codex_queue_runner.py` is intentionally narrow: it processes `codex_local` jobs. Use the full `local_ai_worker.py` command above when phone/PWA jobs may be queued with bridge-scoped hints such as `desktop_bridge_codex` or `mobile_bridge_codex`.

7. Point the phone/PWA at the same Starlog API.
8. Use the Assistant, capture, summarization, card, task, or voice-command flows normally.

The phone/PWA does not know Codex is the executor. It sees Starlog API state and completed assistant/job results.

## Hosted API With Laptop Worker

For the low-cost Railway model:

```bash
PYTHONPATH=services/api uv run --project services/api \
  python scripts/local_ai_worker.py \
  --api-base https://YOUR-STARLOG-API.up.railway.app \
  --token "$STARLOG_TOKEN"
```

This lets the phone/PWA use the hosted API all day while the laptop worker only needs to run when you want queued AI jobs processed.

## Provider Hints

The local worker recognizes Codex-related hints such as:

```text
codex_local
desktop_bridge_codex
mobile_bridge_codex
```

The Codex-only runner handles `codex_local`; the full local AI worker handles both local and bridge-scoped Codex hints.

For assistant command planning, the relevant job capability is usually:

```text
llm_agent_plan
```

For generated outputs:

```text
llm_summary
llm_cards
llm_tasks
```

## Experimental Server-Side Codex Bridge

The `codex_bridge` path is server-side and experimental.

Use it only when:

- the bridge runs in a trusted process,
- credentials are stored server-side,
- `enabled=true`,
- `config.experimental_enabled=true`,
- fallback providers remain configured.

Do not treat this as client-side Codex support.

## What This Does Not Yet Prove

Current UI functional tests do not prove that a live Codex agent can control every surface through natural-language commands.

What exists:

- mocked assistant protocol fixtures,
- dynamic-panel rendering,
- interrupt submission tests,
- backend tests for selected interrupt submit paths,
- queued worker paths for Codex-local jobs.

What still needs end-to-end coverage:

```text
User command in phone/PWA
  -> Starlog Assistant run
  -> Codex/local/API planner emits tool call or interrupt
  -> dynamic panel appears in chat
  -> user resolves by voice/text or panel
  -> backend mutation completes
  -> resulting card/ambient event appears
```

That should be tested first with a deterministic mocked model or mocked Codex bridge, then with a manually configured real worker.

## Security Rule

Do not put OpenAI API keys, Codex tokens, or bridge credentials in:

- `apps/web`,
- `apps/mobile`,
- checked-in config files,
- PWA local storage,
- mobile secure storage for direct provider calls.

For v1, phone and PWA should use Starlog authentication only. Provider credentials belong to the API, local worker, desktop helper, or explicitly configured server-side bridge.
