# AI Validation Smoke Matrix

This document turns the active voice-native PR stack into concrete validation surfaces for `WI-562` and `WI-563`.

## Scope

- Keep golden fixtures reviewable under `services/ai-runtime/evals/`.
- Keep live smoke checks lightweight enough to run in CI or on a feature branch without custom local setup beyond `.env`.
- Treat PRs `#57`, `#58`, `#59`, and `#60` as the current parallel validation targets.

## Golden fixtures

- `services/ai-runtime/evals/briefing_memory_context_golden.json`
  - Source surface: [PR #57](https://github.com/LiquidGunay/starlog/pull/57)
  - Goal: validate that briefings include recent memory context, recommendation hints, and source references.
- `services/ai-runtime/evals/research_digest_pipeline_golden.json`
  - Source surface: [PR #58](https://github.com/LiquidGunay/starlog/pull/58)
  - Goal: validate ranking, provenance, and deeper-summary follow-up expectations for research ingest.
- `services/ai-runtime/evals/voice_native_surface_golden.json`
  - Source surface: [PR #59](https://github.com/LiquidGunay/starlog/pull/59)
  - Goal: validate the chat-first, voice-native interaction and palette guidance reflected in the design package.
- `services/ai-runtime/evals/runtime_conversation_preview_golden.json`
  - Source surface: [PR #60](https://github.com/LiquidGunay/starlog/pull/60)
  - Goal: validate persistent-thread language, short-term session reset scope, and visible tool traces.

## Branch matrix

| PR | Branch | Primary surface | Branch validation | Live smoke |
| --- | --- | --- | --- | --- |
| `#57` | `codex/briefing-memory-pr` | briefing + memory context | `cd services/api && uv run --project . --extra dev pytest -s tests/test_briefing_memory.py tests/test_api_flows.py -k briefing` | `set -a && source .env && set +a && STARLOG_OPENAI_SMOKE_WORKFLOW=briefing STARLOG_OPENAI_SMOKE_TITLE='PR57 briefing memory context' STARLOG_OPENAI_SMOKE_TEXT='Generate a daily briefing with recent memory context and source references.' STARLOG_OPENAI_SMOKE_CONTEXT='{\"date\":\"2026-03-22\",\"memory_summary\":\"Protect the first deep-work block.\",\"sources\":[\"calendar\",\"tasks\",\"conversation_memory\"]}' python3 services/ai-runtime/scripts/openai_smoke.py` |
| `#58` | `codex/research-recommendation-track` | research adapters + digest generation | `cd services/api && uv run --project . --extra dev pytest -s tests/test_research.py` | `set -a && source .env && set +a && STARLOG_OPENAI_SMOKE_WORKFLOW=research_digest STARLOG_OPENAI_SMOKE_TITLE='PR58 research digest pipeline' STARLOG_OPENAI_SMOKE_TEXT='Rank and summarize today\\'s ingested papers with provenance and a deeper-summary option.' STARLOG_OPENAI_SMOKE_CONTEXT='{\"sources\":[\"arxiv\",\"manual_url\",\"manual_pdf\"],\"limit\":10}' python3 services/ai-runtime/scripts/openai_smoke.py` |
| `#59` | `codex/frontend-moodboard` | voice-native design package | `gh pr checkout 59 && test -f docs/design/VOICE_NATIVE_MOODBOARD.md && test -f docs/design/VOICE_NATIVE_TOKENS.md && test -f docs/design/VOICE_NATIVE_SURFACE_SPEC.md` | `set -a && source .env && set +a && STARLOG_OPENAI_SMOKE_WORKFLOW=chat_turn STARLOG_OPENAI_SMOKE_TITLE='PR59 voice-native surface guidance' STARLOG_OPENAI_SMOKE_TEXT='Describe the frontend as chat-first with short spoken replies and a teal/amber-led palette.' STARLOG_OPENAI_SMOKE_CONTEXT='{\"surfaces\":[\"Command Center\",\"Artifact Nexus\",\"Neural Sync\",\"Chronos Matrix\"],\"spoken_reply_style\":\"short\"}' python3 services/ai-runtime/scripts/openai_smoke.py` |
| `#60` | `codex/runtime-boundary-track-atlas` | runtime preview + persistent conversation | `cd services/api && uv run --project . --extra dev pytest -s tests/test_conversations.py && cd ../ai-runtime && uv run --project . --extra dev pytest -s tests/test_workflows.py` | `set -a && source .env && set +a && STARLOG_OPENAI_SMOKE_WORKFLOW=chat_turn STARLOG_OPENAI_SMOKE_TITLE='PR60 runtime conversation preview' STARLOG_OPENAI_SMOKE_TEXT='Reset session state while preserving the persistent thread, cards, and tool traces.' STARLOG_OPENAI_SMOKE_CONTEXT='{\"thread_slug\":\"primary\",\"mode\":\"voice_native\",\"tool_trace_visibility\":true}' python3 services/ai-runtime/scripts/openai_smoke.py` |

## CI-friendly gate

Run these checks before approving the stacked PR set:

```bash
services/ai-runtime/.venv/bin/pytest -s services/ai-runtime/tests/test_eval_fixtures.py
```

```bash
set -a && source .env && set +a && python3 services/ai-runtime/scripts/openai_smoke.py
```

Use the branch-specific smoke commands above when validating a specific PR surface. The live smoke is intentionally lightweight: it only verifies that the configured model can answer the scenario prompt with a structured response.
