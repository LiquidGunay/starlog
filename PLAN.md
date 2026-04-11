# Starlog Plan: Assistant-First Product

`PLAN.md` is the only forward-looking product and architecture spec for Starlog.
Other markdown files may describe current implementation status, operational runbooks, or
historical plans, but they must not compete with this document.

## Summary

- Starlog is a voice-native personal system organized around one persistent `Assistant` thread.
- The web app is a desktop-first workspace. The mobile PWA remains functional as a fallback, but
  polish effort belongs on the native mobile app.
- The native mobile app is the first-class mobile client with four user-facing surfaces:
  `Assistant`, `Library`, `Planner`, and `Review`.
- `Library`, `Planner`, and `Review` are support views for deeper work, but they are not equal
  first-entry destinations with the assistant thread.
- The desktop helper is a capture-first companion for clipboard/screenshot intake and handoff into
  the Assistant and Library.
- All user-facing copy should read like a professional product. Keep `Starlog` as the product
  brand, but stop using observatory-themed feature names as default vocabulary.
- All AI orchestration lives in a separate in-repo Python service. OpenAI `gpt-5.4-nano` is the
  primary hosted LLM for v1; local voice runtimes are first choice for STT/TTS.

## Product Model

### Canonical interaction model

- One long-lived chat thread exists for the single Starlog user.
- Long-term memory is derived from Starlog data and chat summaries.
- Short-term session state is clearable without deleting domain data or long-term memory.
- The assistant can surface notes, tasks, artifacts, research digests, review cards, capture cards,
  and briefings inline.
- Full editing and deep inspection remain available in dedicated support surfaces.

### Surface model

- `Assistant`
  - Primary thread for commands, confirmations, tool results, and dynamic cards.
- `Library`
  - Notes, captures, saved sources, search, and artifact history.
- `Planner`
  - Tasks, calendar, time blocks, and briefings.
- `Review`
  - Flashcards, recall sessions, and spaced-review follow-up.

### Autonomy and behavior

- The assistant may read, search, capture, draft, summarize, rank, and suggest without confirmation.
- The assistant must confirm before destructive changes, costly workflows, or external side effects.
- Proactive behavior is limited to preparing suggestions. It does not silently commit major changes.

### Voice UX

- v1 voice input is hold-to-talk.
- v1 voice output defaults to short spoken replies plus visible transcripts/cards.
- v1 explicitly does not target full-duplex live conversation.

## Client and Runtime Split

### Desktop web

- Canonical desktop workspace and primary polished web experience.
- Hosts the persistent `Assistant` conversation surface.
- Hosts the full `Library`, `Planner`, and `Review` workspaces.
- Keeps operator/debug lanes available but visually secondary to the transcript.

### Native mobile

- First-class mobile client.
- Shares the same server-backed assistant thread as the web app.
- Owns mobile-first voice capture, quick capture/share, alarms, offline briefing playback, quick
  triage, and quick review.

### Mobile PWA fallback

- Must stay functional for fallback access and testing.
- Does not receive dedicated redesign or polish effort beyond maintaining a working fallback path.

### Desktop helper companion

- Fastest path for clipboard and screenshot capture from laptop workflows.
- Surfaces recent captures and handoff actions into `Assistant` and `Library`.
- Diagnostics remain available but are secondary to capture workflows.
- Uses existing Starlog capture/tooling rather than inventing a separate storage path.

## System Boundaries

### `services/api`

- System of record for auth, sync, CRUD, queues, tools, calendar, tasks, artifacts, review, and export.
- Owns canonical domain schemas, persistence, and tool execution.
- Owns the canonical conversation thread, messages, tool traces, and structured assistant cards.

### `services/ai-runtime`

- Separate Python service for prompts, orchestration, provider adapters, recommendation logic, and evals.
- Owns chat-turn assembly, memory assembly, research ranking, briefing generation, and OpenAI calls.
- Prompts must be file-based and reviewable.

### `@starlog/contracts`

- Shared home for cross-surface Assistant types and durable product copy constants.
- Defines the assistant card contract consumed by API, web, mobile, and helper surfaces.

## Required Data and Interface Changes

- Server-backed conversation storage:
  - conversation thread
  - messages/turns
  - session-state reset
  - tool-execution traces
  - structured in-chat card payloads with typed actions
- Shared assistant card contract:
  - typed `kind`
  - optional `entity_ref`
  - typed `actions[]`
  - compatibility adaptation for legacy stored cards without actions
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

## First-Wave Assistant Workflows

### Unified assistant turn

- Keep `/v1/conversations/primary/chat` as the canonical execution path for desktop web and native mobile.
- Route action-oriented requests through the same planner/tool catalog used by command execution so
  normal chat can produce real tool traces and structured cards.
- Persist resulting assistant output, traces, and surfaced cards into the canonical conversation thread.

### Assistant card projection

- Project typed cards server-side from tool results and domain entities.
- Primary card kinds for this pass:
  - `review_queue`
  - `knowledge_note`
  - `task_list`
  - `briefing`
  - `capture_item`
  - fallback `assistant_summary`
- `thread_context` and `tool_step` remain available as collapsed diagnostic details, not primary
  cards in the main user flow.

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
- Superseded forward-looking plan docs should be replaced rather than kept as competing sources.
- `README.md` and `docs/IMPLEMENTATION_STATUS.md` describe what exists now, not future architecture.
- `AGENTS.md` records locked preferences, repo process, and markdown-map authority, but should point
  to this file for product direction.

## Validation Requirements

- Contract tests for conversation APIs, session reset, tool traces, card projection, legacy-card
  backfill, and in-chat card actions.
- Integration tests for AI runtime prompt loading and provider adapters.
- End-to-end checks for:
  - desktop web assistant flow
  - desktop web inline card actions and collapsed diagnostics panes
  - native mobile Assistant, Library, Planner, and Review tabs
  - desktop helper capture, recent items, and Assistant/Library handoff
- Env-gated smoke scripts for:
  - OpenAI chat/tool orchestration with `gpt-5.4-nano`
  - research batch/background flows
  - briefing generation
  - local desktop bridge STT/TTS/clipping

## Defaults and Constraints

- `Assistant / Library / Planner / Review` is the approved user-facing taxonomy.
- Desktop web and native mobile are both primary products, but only desktop web gets the polished PWA redesign.
- The mobile PWA remains fallback-only.
- Support views remain necessary for deep editing and inspection; the design is chat-first, not chat-only.
- The desktop helper remains a capture companion, not a second full assistant client.
- Existing task/calendar/artifact/review APIs remain and are consumed through the tool layer.
