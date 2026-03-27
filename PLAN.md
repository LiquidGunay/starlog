# Starlog Plan: Voice-Native Starlog

`PLAN.md` is the only forward-looking product and architecture spec for Starlog.
Other markdown files may describe current implementation status, operational runbooks, or
historical plans, but they must not compete with this document.

## Summary

- Starlog is a voice-native personal system with one persistent chat thread as the primary interface.
- The PWA remains the canonical synced workspace, but chat and voice are the canonical interaction model.
- Native mobile stays in scope for voice capture, alarms, offline playback, and quick triage/review.
- Desktop-local AI capability is exposed through a localhost Python bridge daemon for screen context,
  clipping, and local STT/TTS.
- All AI orchestration lives in a separate in-repo Python service. OpenAI `gpt-5.4-nano` is the
  primary hosted LLM for v1; local voice runtimes are first choice for STT/TTS.

## Product Model

### Canonical interaction model

- One long-lived chat thread exists for the single Starlog user.
- Long-term memory is derived from Starlog data and chat summaries.
- Short-term session state is clearable without deleting domain data or long-term memory.
- The chat can surface notes, tasks, artifacts, cards, research digests, and briefing cards inline.
- Full editing and deep inspection remain available in dedicated workspace surfaces.

### Autonomy and behavior

- The assistant may read, search, capture, draft, summarize, rank, and suggest without confirmation.
- The assistant must confirm before destructive changes, costly workflows, or external side effects.
- Proactive behavior is limited to preparing suggestions. It does not silently commit major changes.

### Voice UX

- v1 voice input is hold-to-talk.
- v1 voice output defaults to short spoken replies plus visible transcripts/cards.
- v1 explicitly does not target full-duplex live conversation.

## Client and Runtime Split

### PWA

- Canonical synced client and primary chat workspace.
- Deep editing, inspectable knowledge views, planner/calendar views, and full history remain here.

### Native mobile companion

- Voice capture, quick capture/share, alarms, offline briefing playback, quick review, and quick triage.
- Uses the same server-backed conversation thread as the PWA.

### Desktop localhost bridge daemon

- Python daemon reachable over localhost from the PWA.
- Provides assistive clipping, screen/url/window context, local STT/TTS, and future guarded desktop actions.
- Uses existing Starlog capture/tooling rather than inventing a separate storage path.
- v1 is assistive clipping only, not open-ended autonomous computer use.

## System Boundaries

### `services/api`

- System of record for auth, sync, CRUD, queues, tools, calendar, tasks, artifacts, review, and export.
- Owns canonical domain schemas, persistence, and tool execution.

### `services/ai-runtime`

- Separate Python service for prompts, orchestration, provider adapters, recommendation logic, and evals.
- Owns chat-turn assembly, memory assembly, research ranking, briefing generation, and OpenAI calls.
- Prompts must be file-based and reviewable.

## Required Data and Interface Changes

- Server-backed conversation storage:
  - conversation thread
  - messages/turns
  - session-state reset
  - tool-execution traces
  - structured in-chat card payloads
- Memory and recommendation primitives:
  - long-term memory summaries/facts
  - session-state snapshots
  - recommendation events/signals
- Research primitives:
  - source adapters
  - research items
  - digest packages
  - manual URL/PDF ingest
  - arXiv ingest

## First-Wave AI Workflows

### Unified chat turn

- Assemble short-term session state, selected long-term memory, and relevant Starlog retrieval.
- Call OpenAI with strict structured tool schemas.
- Execute approved tools through the Starlog tool catalog.
- Persist resulting assistant output, traces, and surfaced cards into the canonical conversation thread.

### Unified briefing

- Build one daily package combining schedule, tasks, review cues, and research digest.
- Use linked cards for deeper paper/task/note follow-up.

### Research pipeline

- Start with arXiv plus manual URL/PDF ingest.
- Normalize research items into artifacts with provenance.
- Use batch/background processing for daily ranking and summaries.
- Support optional deeper follow-up summaries.

## Documentation Rules

- `PLAN.md` is canonical for future direction.
- Superseded forward-looking plan docs should be removed rather than retained as alternate planning sources.
- `README.md` and `docs/IMPLEMENTATION_STATUS.md` describe what exists now, not future architecture.
- `AGENTS.md` records locked preferences, repo process, and markdown-map authority, but should point to this
  file for product direction.

## Validation Requirements

- Contract tests for conversation APIs, session reset, tool traces, and in-chat cards.
- Integration tests for AI runtime prompt loading and provider adapters.
- Env-gated smoke scripts for:
  - OpenAI chat/tool orchestration with `gpt-5.4-nano`
  - research batch/background flows
  - briefing generation
  - local desktop bridge STT/TTS/clipping
- End-to-end checks for:
  - PWA chat flow
  - mobile hold-to-talk plus offline briefing playback
  - desktop assistive clipping into artifacts

## Defaults and Constraints

- PWA remains the canonical synced client.
- Native mobile remains required because browser-only voice, alarms, and offline playback are weaker than native.
- Research recommendation is the first adaptive loop. SRS resurfacing stays mostly deterministic for now.
- Existing task/calendar/artifact/SRS APIs remain and are consumed through the tool layer.
