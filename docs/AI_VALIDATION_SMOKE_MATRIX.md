# AI Validation Smoke Matrix

Run this before opening a PR that touches the voice-native runtime, API, web shell, or local bridge.

This is the fast PR gate. It is intentionally smaller than the heavier release runbooks.

## Single command

```bash
./scripts/ci_smoke_matrix.sh
```

## What the default matrix runs

1. Runtime smoke pytest

```bash
cd services/ai-runtime && uv run --project . --extra dev pytest -s tests/test_openai_smoke.py tests/test_eval_fixtures.py bridge/tests/test_server.py
```

2. API conversation smoke

```bash
cd services/api && uv run --project . --extra dev pytest -s tests/test_conversations.py
```

3. Web shell typecheck

```bash
cd apps/web && ./node_modules/.bin/tsc --noEmit
```

4. Desktop helper local-bridge smoke

```bash
./node_modules/.bin/playwright test tools/desktop-helper/tests/helper.spec.ts --grep 'configured local bridge with bridge auth|discover a reachable localhost bridge'
```

If any default step fails, the PR smoke matrix fails.

## Artifacts

- Logs: `artifacts/ai-validation-smoke/smoke-<timestamp>.log`

## Optional lanes

### Watch lanes

```bash
./scripts/ci_smoke_matrix.sh --include-watch
```

These are useful, but they are not the default PR gate today because current `master` still has known drift:

- `services/api/tests/test_voice_native_regression.py`
  - currently red on `master`
  - latest observed failure: stale `"Calendar blocks:"` expectation versus current `"Schedule blocks:"` briefing output
- assistant Playwright lanes under `apps/web/tests/assistant-*.spec.ts`
  - still under recovery with `WI-522` / `WI-523`
  - do not make them required again until the chat-surface recovery branch lands cleanly

### Live provider lane

```bash
./scripts/ci_smoke_matrix.sh --include-openai-live
```

Use this only when the required environment is available, for example:

- `.env` exposes the OpenAI key
- the branch intentionally touches hosted-runtime wiring

## PR guidance

- Run the default smoke matrix before opening a PR that touches runtime, API, web, or helper surfaces.
- If you touched only docs, you can skip the runtime commands, but call that out in the PR body.
- If you touched web release behavior, also run the heavier release gate:

```bash
./scripts/pwa_release_gate.sh
```

- If you touched Android phone flows, also follow [docs/ANDROID_DEV_BUILD.md](docs/ANDROID_DEV_BUILD.md) and the phone runbook in [AGENTS.md](../AGENTS.md).

## Why this split exists

The repo currently needs a practical green PR gate, not an aspirational one.

- The default matrix is the set of commands verified as current and useful on `master`.
- The watch lanes stay visible so regressions do not disappear into tribal knowledge.
- Release-specific gates remain separate from the faster PR-opening path.
