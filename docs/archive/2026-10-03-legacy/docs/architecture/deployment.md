# Deployment Architecture

Starlog v1 favors a low-cost hosted core with local-first voice and capture helpers.

## Hosted Core

- Railway is the preferred hobby-footprint host for web/API deployment.
- `services/api` is the hosted system of record for authenticated Starlog data and assistant runtime
  persistence.
- `apps/web` is the desktop web and installable PWA/fallback mobile web surface.
- Hosted services keep OpenAI and fallback provider credentials server-side.

## Local And Device Runtimes

- Native mobile is the primary phone client for capture, alarm, offline briefing playback, and quick
  review.
- Local STT/TTS and OCR run on-device or host-local first. OCR is strict on-device only.
- The desktop helper is a capture-first companion that can send clipboard/screenshot context to the
  API and hand off to the Assistant.
- Browser clipper captures web sources into the artifact graph.

## Secret Boundary

Provider credentials must not live in PWA or mobile clients. Agent work routes through the API,
AI runtime, desktop helper, or paired local worker with server-side or worker-local secret handling.

## Sync And Availability

- Google Calendar sync is two-way, but Starlog keeps an internal calendar model.
- Daily briefings combine schedule/task guidance with research digest output when relevant.
- Local/offline phone playback supports morning alarm and spoken briefing continuity.
- Fallback providers/local alternatives stay available for LLM orchestration resilience.

See [diagrams/deployment-topology.mmd](diagrams/deployment-topology.mmd).
