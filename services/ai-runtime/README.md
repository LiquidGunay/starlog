# Starlog AI Runtime

This service is the dedicated home for Starlog AI orchestration.

It exists to keep prompts, workflow assembly, provider adapters, and evaluation tooling out of the
main CRUD/sync API. The current repository still uses parts of the legacy API-side AI path, but the
prompt files and runtime scaffolding now live here.

## Responsibilities

- file-based markdown prompt templates
- chat-turn workflow assembly
- briefing and research-digest workflow assembly
- provider adapter boundaries
- smoke/eval tooling
- future localhost bridge helpers for desktop-local AI flows

## Current endpoints

- `GET /health`
- `POST /v1/chat/preview`
- `POST /v1/briefings/preview`
- `POST /v1/research/digests/preview`

These preview endpoints currently render workflow inputs from the canonical prompt files. They are
intended as the migration target for future OpenAI-backed execution.

## Prompt editing rule

Assistant and agent behavior prompts should live in `services/ai-runtime/prompts/*.md`.
Treat those markdown files as the canonical user-editable behavior layer and avoid burying the
primary prompt text in code literals.
