# Codex Agent Provider Feasibility

Last reviewed: 2026-04-27

## Recommendation

Do not run Codex SDK or OpenAI API-key authenticated agent work directly from the PWA or mobile app.
Route mobile and PWA requests through the Starlog API, then use one of these server-controlled paths:

- existing queued worker jobs with `provider_hint=desktop_bridge_codex` or `mobile_bridge_codex`
- the experimental server-side `codex_bridge` provider when explicitly configured
- existing API/local fallback providers when bridge execution is unavailable

This keeps OpenAI/Codex credentials out of browser and app bundles while preserving Starlog's fallback policy.

## Official Source Findings

- OpenAI API authentication docs state that API keys are secrets and must not be exposed in client-side code such as browsers or apps. They should be loaded from environment variables or server-side secret management.
- OpenAI Codex SDK docs describe the TypeScript SDK as server-side and requiring Node.js 18 or later. The Python SDK is experimental and controls a local Codex app server.
- OpenAI Agents SDK docs recommend SDK usage when the application owns orchestration, tool execution, approvals, and state. That maps to Starlog's API/AI-runtime boundary, not direct PWA/mobile provider calls.
- OpenAI code-generation docs distinguish Codex as an agent surface from direct model API usage. Starlog can still use regular OpenAI API providers as the stable fallback path.

Consulted sources:

- https://developers.openai.com/codex/sdk
- https://developers.openai.com/api/reference/overview#authentication
- https://developers.openai.com/api/docs/guides/agents
- https://developers.openai.com/api/docs/guides/code-generation

## In-Repo State

Starlog already has three relevant pieces:

- `scripts/local_ai_worker.py` can process queued LLM jobs through local `codex exec`.
- `services/api/app/services/integrations_service.py` defines an experimental `codex_bridge` provider contract with explicit opt-in via `config.experimental_enabled=true`.
- `services/api/app/services/ai_service.py` preserves API/runtime fallback for LLM capabilities.

Starlog's default LLM model is `gpt-5.4-mini`. This pass wires the smallest safe synchronous path:
when LLM execution policy reaches `desktop_bridge`, the API tries the configured `codex_bridge`
server-side. If the bridge is missing, disabled, not opted in, misconfigured, or request execution
fails, routing continues to the API/runtime fallback.

## Security Constraints

- PWA and mobile clients must not receive OpenAI API keys, Codex tokens, or bridge credentials.
- Codex SDK usage belongs in a server process, trusted desktop helper, or paired worker, not browser JavaScript or a mobile bundle.
- The bridge remains experimental and disabled unless configured with `enabled=true` and `config.experimental_enabled=true`.
- OCR remains on-device only; the bridge supports LLM capabilities only.
- Major writes still require existing confirmation policy enforcement.

## Next Steps

1. Keep PWA/mobile calls pointed at Starlog API endpoints.
2. If the user wants subscription-backed local Codex behavior, prefer the paired worker path using `scripts/local_ai_worker.py`.
3. If the user wants a hosted bridge, configure `codex_bridge` with an OpenAI-compatible endpoint and server-side credential storage.
4. Evaluate a Node sidecar using `@openai/codex-sdk` only after deciding where it runs, how it authenticates, and how Starlog constrains workspace/filesystem access.
5. Add end-to-end evidence with a mocked bridge first, then a manually configured local/hosted bridge; no test should require production credentials.
