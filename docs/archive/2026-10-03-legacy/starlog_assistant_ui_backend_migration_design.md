# Starlog Migration Design: Replacing the Current Chat UI with assistant-ui and Upgrading the Backend Contract

## Purpose

This document explains, in repo-specific terms, what must change in Starlog if the existing chat UI is replaced with **assistant-ui** and the backend is upgraded so the agent can understand UI state and drive structured UI in the thread.

This is not a generic frontend library comparison. It is a migration design for the current repo.

The goal is to answer four questions thoroughly:

1. What Starlog looks like today at the conversation/backend-contract level.
2. Why that model is not sufficient for an assistant-ui-first, tool-UI-heavy thread.
3. What exact contract, storage, API, orchestration, and runtime changes are needed.
4. How to stage the migration without breaking the rest of Starlog.

---

# 1. Executive conclusion

## Recommendation

If Starlog adopts assistant-ui, it should use **assistant-ui ExternalStoreRuntime / custom backend mode** and keep the **server as the system of record** for:

- threads
- messages
- run state
- tool calls
- human-interrupt state
- surface events
- durable assistant metadata

That is the right fit because Starlog already has server-owned conversation persistence, session state, typed cards, and tool traces. The frontend should not become the source of truth for the Assistant thread.

## Core architectural shift

The biggest change is this:

**Today**
- the backend stores a message as mostly:
  - `role`
  - `content` string
  - `cards[]`
  - `metadata`
- tools are stored separately as traces
- the UI is projected after the fact through cards

**Target**
- the backend must store and stream a richer **assistant thread protocol**
- the assistant must be able to emit:
  - text parts
  - tool calls
  - tool results
  - interrupt / requires-action states
  - structured UI requests
  - lightweight surface-event projections
- the frontend renders those protocol objects through assistant-ui

In other words: **UI-bearing message parts and tool lifecycle become first-class backend objects** instead of post-hoc card decoration.

## What should not happen

The backend should **not** try to send arbitrary React components or arbitrary HTML to the frontend.

Instead, the backend should send **stable tool names, typed payloads, and typed interrupt descriptors**, and the client should map those to registered assistant-ui tool UIs.

That keeps Starlog:
- secure
- debuggable
- testable
- consistent across desktop web, mobile, and helper surfaces

---

# 2. Current repo: what exists today

This section is intentionally concrete because the migration should start from the actual repo shape.

## 2.1 Product model

The repo already defines Starlog as:

- one persistent `Assistant` thread
- `Library`, `Planner`, and `Review` as support surfaces
- server-backed conversation storage
- inline typed cards
- diagnostics visually secondary to the transcript

That is a strong base for assistant-ui. The migration should preserve this product model, not replace it.

## 2.2 Current contracts

`packages/contracts/src/assistant.ts` currently models the assistant around:

- `AssistantCard`
- `AssistantCardAction`
- `AssistantConversationMessage`
- `AssistantConversationToolTrace`

The current message model is still fundamentally a **string-first chat model** with cards attached after the fact.

That is useful for today’s UI, but it is too weak for:
- in-thread interactive tool UIs
- resumable human-in-the-loop actions
- assistant-driven structured panels
- explicit run states
- tool call/result lifecycle that the frontend can render directly

## 2.3 Current conversation API

`services/api/app/api/routes/conversations.py` currently exposes the primary thread as:

- `GET /v1/conversations/primary`
- `POST /v1/conversations/primary/messages`
- `POST /v1/conversations/primary/session/reset`
- `POST /v1/conversations/primary/chat`
- `POST /v1/conversations/primary/preview`

Important observation:
- `POST /primary/chat` either:
  - routes to deterministic command execution via `agent_command_service.run_conversation_command`, or
  - builds a preview/context payload, calls `ai_service.execute_chat_turn`, then persists a user message, assistant message, one runtime trace, and projected cards.

This is fundamentally **request/response turn execution**, not a general-purpose run protocol.

## 2.4 Current storage model

`services/api/app/db/storage.py` defines:

- `conversation_threads`
- `conversation_messages`
- `conversation_session_state`
- `conversation_tool_traces`
- `conversation_memory_entries`

The key limitation is the shape of `conversation_messages`:

- `id`
- `thread_id`
- `role`
- `content`
- `cards_json`
- `metadata_json`
- `created_at`

That means message structure is coarse. There is no first-class storage for:
- message parts
- run status
- partial assistant output
- tool call lifecycle
- interrupt state
- resumable UI-required actions
- surface-event projections tied to messages

## 2.5 Current orchestration split

The current stack is:

- `services/api`
  - system of record
  - route handlers
  - tool execution
  - persistence
- `services/ai-runtime`
  - prompt rendering
  - preview/execute workflows

`conversation_service.build_chat_preview_request()` currently passes:
- recent messages
- recent tool traces
- session state
- request metadata
- memory context
- assistant memory suggestions

But it does **not** pass any durable UI state contract such as:
- current surface
- available UI actions
- visible entity context
- interrupt capabilities
- registered panel types
- current selection / focus / active artifact / active task

So the AI runtime currently reasons about content and memory, but not about UI affordances as first-class controllable objects.

## 2.6 Current UI projection layer

`conversation_card_service.py` is the current bridge from backend semantics to UI.

It:
- normalizes cards
- adds default actions
- projects step-level cards from tool results
- creates summary, capture, task, review, briefing, and memory cards

This is good product logic, but it is too **presentation-coupled** for an assistant-ui migration.

Why?
Because assistant-ui works best when the runtime emits:
- message parts
- tool lifecycle
- interrupts / requires-action states

and the frontend renders those directly.

The current `conversation_card_service` is effectively compensating for the missing run/message-part protocol.

## 2.7 Current deterministic command path

`agent_command_service.py` already has strong Starlog-specific domain behavior:

- deterministic command parsing
- tool planning
- tool execution
- confirmation policy preparation
- persistence back into the thread
- projection into cards and traces

This is valuable and should not be thrown away.

But it needs to be **reframed as a tool-call backend**, not as a separate side-path from chat.

The target is:

- normal chat orchestration
- deterministic command execution
- AI-assisted planning
- human-interrupt workflows

all use one shared backend run model.

---

# 3. Why the current model is not sufficient for assistant-ui

assistant-ui is not just a prettier thread renderer. Its strongest value appears when the backend can express richer conversation state.

## 3.1 assistant-ui’s real backend expectations

assistant-ui can work with a simple local runtime, but for Starlog the correct fit is the custom backend / external store model.

That model assumes:
- you own message state
- you own thread state
- you own persistence
- you can provide custom message formats
- you can expose multi-thread behavior
- you can expose tool UI state and run status

assistant-ui also has a tool UI model where tool calls can render custom interactive UI, can expose status such as:
- running
- complete
- incomplete
- requires_action

and can pause execution for human input, then resume.

That is exactly the shape Starlog needs for dynamic panels and inline structured interactions.

## 3.2 The mismatch with today’s Starlog backend

Today Starlog’s backend produces:
- one assistant text string
- optional cards
- one or more tool traces
- metadata blobs

What assistant-ui-style generative UI wants is closer to:
- assistant message part stream
- explicit tool call part(s)
- tool result part(s)
- interrupt descriptor when human input is needed
- resumable run state

So the missing capability is not “prettier cards.”
The missing capability is **backend-native interaction protocol**.

## 3.3 Why cards alone are not enough

Cards are still useful, but they are too static to represent the full interaction cycle.

Cards are good for:
- summaries
- previews
- navigation affordances
- compact result snapshots

Cards are weak for:
- progressive tool execution
- partial results
- human approval mid-run
- structured input collection
- resumable actions
- action status transitions

assistant-ui’s tool UIs are better for those cases.

Therefore the migration should not delete cards; it should **downgrade cards from “main UI mechanism” to “one projection type among several.”**

---

# 4. Target architecture

## 4.1 High-level target

Use assistant-ui as the frontend runtime/rendering layer, but keep Starlog’s backend as the source of truth.

### Recommended model

- **Frontend**
  - assistant-ui
  - ExternalStoreRuntime (or equivalent custom backend runtime)
  - registered tool UIs for Starlog-specific interactions
  - thin adapter translating Starlog thread payloads into assistant-ui message format

- **API**
  - canonical thread store
  - run lifecycle endpoints
  - surface-event ingestion
  - interrupt resume endpoints
  - thread list endpoints
  - stream/poll endpoints for run updates

- **AI runtime**
  - prompt assembly + orchestration
  - receives UI capability manifest and current UI context
  - can choose domain tools and UI-requesting tools
  - returns structured response plan, not only `response_text + cards`

- **Domain services**
  - remain in `services/api`
  - continue to own task/note/capture/planner/review mutations

## 4.2 The key design principle

The backend should not tell the frontend *how to render arbitrary UI*.
The backend should tell the frontend:

- what the assistant is saying
- what tool is being called
- what structured input is needed
- what data shape is required
- what state the tool/run is in

The frontend then chooses the React component for that tool or interrupt.

This creates a stable boundary:
- backend owns semantics
- frontend owns presentation

---

# 5. Recommended backend contract redesign

This is the most important section in the document.

## 5.1 Replace the current “message + cards + metadata” contract with a message-part protocol

### Current problem

The current `ConversationMessage` schema stores only:
- `content: str`
- `cards[]`
- `metadata`

That makes every UI innovation leak into cards or metadata.

### Target

Introduce a first-class **message part union**.

Recommended new contract shape:

```ts
export type AssistantMessagePart =
  | { type: "text"; text: string }
  | { type: "reasoning_summary"; text: string }
  | { type: "tool_call"; toolCallId: string; toolName: string; args: Record<string, unknown>; status: "queued" | "running" | "requires_action" | "complete" | "error"; metadata?: Record<string, unknown> }
  | { type: "tool_result"; toolCallId: string; result: Record<string, unknown> | Array<Record<string, unknown>>; isError?: boolean; metadata?: Record<string, unknown> }
  | { type: "card"; card: AssistantCard }
  | { type: "ambient_update"; update: AssistantAmbientUpdate }
  | { type: "attachment"; attachment: AssistantAttachment }
  | { type: "quote"; text: string; source?: string }
```

Then:

```ts
export type AssistantThreadMessage = {
  id: string;
  thread_id: string;
  role: "system" | "user" | "assistant" | "tool";
  parts: AssistantMessagePart[];
  status?: "in_progress" | "complete" | "cancelled" | "error";
  metadata: Record<string, unknown>;
  created_at: string;
  updated_at?: string;
  parent_id?: string | null;
  run_id?: string | null;
};
```

### Why this is necessary

Because assistant-ui naturally works with structured message content and tool lifecycle.
If Starlog keeps `content: str` as the main primitive, every advanced interaction will become a special-case adapter.

### What to keep from the old model

Keep `AssistantCard`, but treat it as a message part:
- `type: "card"`
instead of a top-level side channel.

---

## 5.2 Introduce a first-class run model

### Current problem

Today a turn is mostly persisted as:
- user message
- assistant message
- one trace
- session state patch

That is too coarse for:
- progressive updates
- multiple tool calls
- mid-run interrupts
- resume after user action
- cancellation
- better assistant-ui status rendering

### Target

Add a `conversation_runs` table and `conversation_run_steps` (or `conversation_tool_calls`) table.

Recommended logical model:

```ts
type AssistantRun = {
  id: string;
  thread_id: string;
  triggered_by_message_id: string;
  status: "queued" | "running" | "requires_action" | "complete" | "error" | "cancelled";
  orchestrator: "deterministic" | "llm_runtime" | "hybrid";
  model?: string | null;
  provider_used?: string | null;
  current_interrupt_id?: string | null;
  metadata: Record<string, unknown>;
  created_at: string;
  updated_at: string;
  finished_at?: string | null;
};
```

```ts
type AssistantRunStep = {
  id: string;
  run_id: string;
  message_id?: string | null;
  tool_call_id: string;
  tool_name: string;
  kind: "domain_tool" | "ui_tool" | "system_tool";
  args: Record<string, unknown>;
  status: "queued" | "running" | "requires_action" | "complete" | "error" | "cancelled";
  result?: Record<string, unknown> | Array<Record<string, unknown>> | null;
  error_text?: string | null;
  metadata: Record<string, unknown>;
  created_at: string;
  updated_at: string;
};
```

### Why this is necessary

This is the backbone that lets assistant-ui render:
- loading states
- in-progress tool calls
- requires-action tool UIs
- final tool results

It also gives Starlog better introspection and replay than the current `conversation_tool_traces` model.

### What to do with `conversation_tool_traces`

Do not delete them immediately.
Instead:
- either replace them with run steps long-term
- or keep them as a diagnostic materialized view derived from runs

Recommendation: replace them over time, because run steps are the more useful primitive.

---

## 5.3 Introduce a first-class interrupt / human-input model

### Current problem

Today confirmation state is mostly represented indirectly through:
- tool metadata
- `requires_confirmation`
- card actions

That is not enough for assistant-ui’s human-in-the-loop pattern.

### Target

Add a durable interrupt table.

```ts
type AssistantInterrupt = {
  id: string;
  run_id: string;
  tool_call_id: string;
  interrupt_type: "confirmation" | "form" | "choice" | "date_time" | "entity_picker";
  payload: Record<string, unknown>;
  status: "open" | "submitted" | "dismissed" | "expired" | "cancelled";
  submitted_payload?: Record<string, unknown> | null;
  created_at: string;
  resolved_at?: string | null;
};
```

### Why this is necessary

assistant-ui’s tool model can pause and request human input. For Starlog, this is the correct backend representation of:
- due date pickers
- scheduling conflict choices
- capture triage
- focused review choices
- destructive confirmations

Without a durable interrupt model:
- browser refresh kills pending UI state
- mobile/web/helper cannot share the same pending action
- the agent cannot resume correctly after user input

---

## 5.4 Add a first-class surface-event model tied to the thread

### Current problem

Starlog already has `domain_events`, but they are generic and not currently modeled as thread-aware assistant context.

### Target

Add a thread-aware surface-event contract and persistence model.

```ts
type AssistantSurfaceEvent = {
  id: string;
  thread_id: string;
  source_surface: "assistant" | "library" | "planner" | "review" | "desktop_helper" | "system";
  kind: string;
  entity_ref?: AssistantEntityRef | null;
  payload: Record<string, unknown>;
  visibility: "internal" | "ambient" | "assistant_message";
  created_at: string;
};
```

### Storage recommendation

Either:
- add a dedicated `conversation_surface_events` table, or
- extend `domain_events` with thread/surface metadata

Recommended choice: **dedicated table**.

Why:
- assistant-related events and replay should not depend on a global generic event table
- thread-scoped retrieval should be cheap
- the semantics are different from generic webhook/event plumbing

### Why this is necessary

This is what lets Starlog’s thread know:
- a capture was created
- a task was completed
- a planner conflict was detected
- a review answer was graded
- a briefing was played

without the user narrating it manually.

It is the backbone for ambient updates and proactive follow-up.

---

## 5.5 Add UI capability and UI state to the AI-runtime contract

### Current problem

`conversation_service.build_chat_preview_request()` already includes memory, recent messages, recent traces, and request metadata.
But it does not include a structured description of:
- current UI surface
- current selected entity
- available UI tools
- allowed panel types
- current pending interrupt state
- available support views / navigation affordances

So the model cannot reason properly about which UI affordance is possible.

### Target

Every orchestration request should include a `ui_context` object and a `ui_capabilities` manifest.

Recommended shape:

```ts
type AssistantUIContext = {
  active_surface: "assistant" | "library" | "planner" | "review";
  selected_entities: AssistantEntityRef[];
  pending_interrupts: Array<{ interrupt_id: string; type: string; tool_name: string }>;
  composer_state?: {
    has_draft: boolean;
    draft_length: number;
    input_mode: "text" | "voice";
  };
  device_target: string;
};
```

```ts
type AssistantUICapabilities = {
  navigable_surfaces: Array<{ id: string; href: string; label: string }>;
  ui_tools: Array<{
    name: string;
    description: string;
    interrupt_type: string;
    parameters_schema: Record<string, unknown>;
  }>;
  domain_tools: Array<{
    name: string;
    description: string;
    parameters_schema: Record<string, unknown>;
    confirmation_policy?: {
      mode: "never" | "always" | "conditional";
      reason?: string;
    };
  }>;
};
```

### Why this is necessary

If you want the agent to “know the UI” and “control the UI,” you must not rely on undocumented prompt magic.
You must pass the model a stable manifest of what UI interactions exist.

That is the difference between:
- fragile chat hacks
- reliable agent-driven product behavior

---

# 6. Recommended API redesign

This section describes the API layer that best fits assistant-ui.

## 6.1 Keep server-owned threads and expose a real thread list

### Current problem

Today the product is hard-coded around `/conversations/primary`.
That fits the current product vision, but assistant-ui’s runtime model assumes explicit thread objects.

Even if Starlog still has only one canonical user thread at the product level, the backend contract should become thread-native.

### Target

Introduce a thread API:

- `GET /v1/assistant/threads`
- `POST /v1/assistant/threads`
- `GET /v1/assistant/threads/:thread_id`
- `PATCH /v1/assistant/threads/:thread_id`
- `DELETE /v1/assistant/threads/:thread_id` or archive route
- optional `POST /v1/assistant/threads/:thread_id/switch`

### Why

Even if Starlog still defaults to one thread, thread-native endpoints make assistant-ui integration much cleaner and future-proof:
- archived threads
- diagnostics/dev threads
- research threads
- temporary side investigations
- multi-device continuity

### Recommendation

Keep `primary` as the default product thread, but stop baking thread identity into route design.

---

## 6.2 Replace `/primary/chat` with explicit run endpoints

### Current problem

`POST /primary/chat` tries to do everything synchronously and returns a full turn response.

### Target

Introduce:

- `POST /v1/assistant/threads/:thread_id/messages`
  - append a user message and start a run
- `GET /v1/assistant/threads/:thread_id/runs/:run_id`
  - fetch current run state
- `POST /v1/assistant/runs/:run_id/cancel`
- `POST /v1/assistant/interrupts/:interrupt_id/submit`
- `POST /v1/assistant/interrupts/:interrupt_id/dismiss`

Optional:
- `GET /v1/assistant/threads/:thread_id/stream`
  - SSE or streaming updates for new messages, run-step transitions, and interrupt state

### Why this is necessary

assistant-ui is much easier to integrate when the backend exposes:
- durable messages
- durable run status
- resumable interrupts

instead of only “submit message, get full response.”

### Strong recommendation

Use **SSE or streaming incremental updates** if possible.
If not, use polling with a run/version cursor.
But do not keep the backend purely synchronous if the goal is rich tool UIs.

---

## 6.3 Add a surface-event ingestion API

### Target

Add:

- `POST /v1/assistant/threads/:thread_id/events`

Request example:

```json
{
  "source_surface": "planner",
  "kind": "planner.conflict.detected",
  "entity_ref": {
    "entity_type": "time_block",
    "entity_id": "tb_123"
  },
  "payload": {
    "candidate_title": "Deep Work",
    "candidate_start": "2026-04-21T10:00:00Z",
    "candidate_end": "2026-04-21T11:00:00Z",
    "conflicts": [
      {
        "title": "Team Sync",
        "start": "2026-04-21T10:00:00Z",
        "end": "2026-04-21T10:30:00Z"
      }
    ]
  },
  "visibility": "assistant_message"
}
```

### Why this is necessary

This is how Planner, Library, Review, and the helper become assistant-aware without manually faking chat turns.

---

## 6.4 Introduce thread snapshot and delta endpoints suitable for ExternalStoreRuntime

### Recommended endpoints

- `GET /v1/assistant/threads/:thread_id`
  - thread metadata, latest messages, pending interrupts
- `GET /v1/assistant/threads/:thread_id/messages?before=...&limit=...`
- `GET /v1/assistant/threads/:thread_id/updates?cursor=...`
  - delta feed
- `POST /v1/assistant/threads/:thread_id/messages`
- `POST /v1/assistant/interrupts/:interrupt_id/submit`

### Why

assistant-ui ExternalStoreRuntime wants the app to own state, thread switching, persistence, and updates.
These endpoints provide the right shape for that.

---

# 7. Changes required inside services/api

## 7.1 Replace `conversation_service.record_chat_turn()` with a run-oriented service

### Current function

Today `record_chat_turn()`:
- appends user message
- appends assistant message
- records one runtime trace
- merges session state

### Problem

This forces assistant output to appear as an already-finished turn.

### Target service split

Introduce something like:

- `assistant_thread_service`
- `assistant_run_service`
- `assistant_interrupt_service`
- `assistant_event_service`
- `assistant_projection_service`

### Recommended responsibilities

#### `assistant_thread_service`
Owns:
- thread CRUD
- message append/fetch/pagination
- thread metadata
- thread state snapshot

#### `assistant_run_service`
Owns:
- start run
- orchestrate run
- append assistant message parts
- record tool calls/results
- open interrupts
- resume interrupted runs
- finalize run status

#### `assistant_interrupt_service`
Owns:
- create interrupt
- fetch open interrupts
- submit/dismiss interrupt
- persist submission
- resume run

#### `assistant_event_service`
Owns:
- ingest surface events
- decide whether to project:
  - internal-only
  - ambient update
  - assistant-triggered follow-up

#### `assistant_projection_service`
Owns:
- converting backend run state into assistant-ui-friendly message structures
- materialized cards where useful
- lightweight ambient update rows

### Why this split matters

Right now a lot of concerns are collapsed into `conversation_service` and `conversation_card_service`.
That made sense for a simpler thread.
It will become brittle once the assistant can drive UI interrupts and tool UIs.

---

## 7.2 Refactor `conversation_card_service` into a broader projection layer

### Current role

`conversation_card_service`:
- normalizes cards
- attaches default actions
- converts tool outputs into cards

### Target role

Refactor it into something like `assistant_projection_service` with three output types:

1. **message parts**
2. **cards**
3. **ambient updates**

### Why

Cards should no longer be the only “rich response” mechanism.

Examples:
- task created successfully -> maybe card
- planner conflict -> tool call + interrupt payload + maybe compact card
- review session misses -> ambient update + review card
- capture saved -> ambient update + optional capture card

### Recommendation

Keep all the existing Starlog-specific card projection knowledge, but move it behind a broader projection interface.

---

## 7.3 Unify deterministic command execution and chat orchestration

### Current problem

There are effectively two paths:

1. deterministic assistant command path (`agent_command_service.run_conversation_command`)
2. AI runtime `execute_chat_turn` path

This split is okay today, but it becomes awkward once both paths must produce the same assistant-ui protocol.

### Target

Define one orchestration model:

- every user message starts a run
- the orchestrator decides:
  - deterministic tool call(s)
  - LLM-assisted tool plan
  - direct text response
  - UI interrupt tool
  - hybrid sequence

### Why

The frontend should not need to care whether a turn was:
- deterministic
- LLM-generated
- mixed

It should just see:
- messages
- tool calls
- results
- interrupts
- final state

### Recommendation

Keep the deterministic parser and tool planner logic from `agent_command_service`, but expose it as an orchestration strategy inside a unified run service.

---

## 7.4 Introduce explicit UI tools alongside domain tools

This is one of the most important conceptual changes.

### Current tool worldview

Today tools are mostly domain mutation/search operations:
- create task
- update task
- capture artifact
- run artifact action
- generate briefing
- etc.

### Target tool taxonomy

Introduce three classes of tools:

#### A. Domain tools
These directly change or query Starlog data.

Examples:
- `create_task`
- `update_task`
- `search_starlog`
- `create_note`
- `list_due_cards`
- `generate_time_blocks`

#### B. UI tools
These do not directly mutate the domain.
They request structured user interaction.

Examples:
- `request_due_date`
- `resolve_planner_conflict`
- `triage_capture`
- `grade_review_recall`
- `choose_morning_focus`

These tools open interrupts and wait for user input.

#### C. System tools
These manage orchestration or UI-side state projection.

Examples:
- `emit_ambient_update`
- `navigate_surface`
- `load_entity_context`
- `suggest_follow_up`

### Why this split matters

If you do not explicitly model UI tools, the assistant will keep faking UI control through:
- vague assistant text
- cards with generic buttons
- overloaded metadata

UI tools are the clean backend abstraction for dynamic panels.

---

# 8. Changes required inside services/ai-runtime

## 8.1 The AI runtime must stop thinking in terms of only `response_text + cards`

### Current problem

`services/ai-runtime/runtime_app/workflows.py` currently returns chat execution payloads like:
- `response_text`
- `cards`
- `session_state`
- metadata

That is too coarse for assistant-ui generative UI.

### Target

The AI runtime should return a structured orchestration response such as:

```ts
type AssistantTurnPlan = {
  workflow: "chat_turn";
  provider_used: string;
  model: string;
  assistant_parts: AssistantMessagePart[];
  tool_calls: Array<{
    tool_name: string;
    kind: "domain_tool" | "ui_tool" | "system_tool";
    arguments: Record<string, unknown>;
    rationale?: string;
  }>;
  session_state_patch: Record<string, unknown>;
  metadata: Record<string, unknown>;
};
```

### Why

This lets the API layer:
- persist structured assistant output
- execute tool calls
- create interrupts if needed
- stream partial updates to the client

### Important implementation note

The AI runtime should not directly decide final React rendering.
It should choose:
- text
- tools
- optional cards
- optional ambient updates
- optional UI tool requests

The API layer then validates and executes that plan.

---

## 8.2 Add UI context and capability manifest to prompt assembly

### Current issue

The current context builder includes memory and prior messages but not UI affordances.

### Target additions

Every chat-turn context should include:
- `ui_context`
- `ui_capabilities`
- `open_interrupts`
- `latest_surface_events`
- optionally `active_entity_snapshots`

### Why

If the agent is supposed to “understand the UI,” the UI must be passed explicitly, not implied.

### Recommended prompt guidance

The prompt should teach the model:
- use domain tools when data can be mutated immediately and safely
- use UI tools when structured user input is required
- prefer one small interrupt over asking a vague freeform question
- emit ambient updates sparingly
- keep deep editing in support surfaces

---

## 8.3 Add orchestration policies around UI tools

The runtime needs explicit policy rules such as:

- If required field missing for a domain mutation:
  - prefer UI tool interrupt over open-ended clarification
- If destructive action:
  - require confirmation interrupt
- If planner conflict:
  - prefer conflict resolution UI tool
- If repeated review misses:
  - prefer review-focused card, not immediate interrupt unless user is already in Review context
- If event is informational only:
  - prefer ambient update

### Why

Without explicit policy, the agent will overuse or underuse interactive UI.

---

# 9. Recommended database changes

This section gives the concrete persistence changes I would make.

## 9.1 Keep existing tables during migration, but add new ones

Do not do a big-bang replacement immediately.

### Add

#### `conversation_runs`
Fields:
- `id`
- `thread_id`
- `triggered_by_message_id`
- `status`
- `orchestrator`
- `provider_used`
- `model`
- `current_interrupt_id`
- `metadata_json`
- `created_at`
- `updated_at`
- `finished_at`

#### `conversation_message_parts`
Fields:
- `id`
- `message_id`
- `part_index`
- `part_type`
- `payload_json`
- `created_at`
- `updated_at`

This is the cleanest way to support structured parts without bloating `conversation_messages`.

#### `conversation_run_steps`
Fields:
- `id`
- `run_id`
- `message_id`
- `tool_call_id`
- `tool_name`
- `tool_kind`
- `arguments_json`
- `status`
- `result_json`
- `error_text`
- `metadata_json`
- `created_at`
- `updated_at`

#### `conversation_interrupts`
Fields:
- `id`
- `run_id`
- `tool_call_id`
- `interrupt_type`
- `payload_json`
- `status`
- `submitted_payload_json`
- `created_at`
- `resolved_at`

#### `conversation_surface_events`
Fields:
- `id`
- `thread_id`
- `source_surface`
- `kind`
- `entity_ref_json`
- `payload_json`
- `visibility`
- `created_at`

### Optional later additions

#### `conversation_thread_views`
If you want:
- per-device last-read positions
- unread counters
- last-seen message ids

#### `conversation_attachments`
If assistant-ui attachment handling becomes richer than today’s artifact/media plumbing.

## 9.2 Minimal invasive path

If you want the least disruptive migration:
- keep `conversation_messages`
- add `parts_json` and `status`
- add `run_id`, `parent_id`, `updated_at`
- add the new tables for runs and interrupts

That is acceptable for phase 1.

### Why I still prefer `conversation_message_parts`

Because long-term:
- querying by part type
- partial updates
- structured validation
- tool/result indexing

all work better with a separate parts table.

---

# 10. Detailed contract changes in @starlog/contracts

This package should become the stable cross-surface assistant protocol.

## 10.1 Keep current card contract, but demote it into the richer protocol

Keep:
- `AssistantCard`
- `AssistantCardAction`
- `AssistantEntityRef`

But add:
- `AssistantMessagePart`
- `AssistantRun`
- `AssistantRunStep`
- `AssistantInterrupt`
- `AssistantSurfaceEvent`
- `AssistantAmbientUpdate`
- `AssistantThreadSummary`
- `AssistantThreadDelta`

## 10.2 Add a tool-call-facing protocol

Recommended types:

```ts
export type AssistantToolKind = "domain_tool" | "ui_tool" | "system_tool";

export type AssistantToolCallPart = {
  type: "tool_call";
  toolCallId: string;
  toolName: string;
  toolKind: AssistantToolKind;
  args: Record<string, unknown>;
  status: "queued" | "running" | "requires_action" | "complete" | "error" | "cancelled";
  metadata?: Record<string, unknown>;
};

export type AssistantToolResultPart = {
  type: "tool_result";
  toolCallId: string;
  result: unknown;
  isError?: boolean;
  metadata?: Record<string, unknown>;
};
```

## 10.3 Add interrupt/panel descriptors

Do **not** send rendered UI trees through contracts.
Send panel semantics.

```ts
export type AssistantInterruptPayload =
  | {
      interrupt_type: "confirmation";
      title: string;
      body?: string;
      confirm_label?: string;
      cancel_label?: string;
      details?: Record<string, unknown>;
    }
  | {
      interrupt_type: "choice";
      title: string;
      body?: string;
      options: Array<{ id: string; label: string; value: string; description?: string }>;
      primary_label: string;
    }
  | {
      interrupt_type: "form";
      title: string;
      body?: string;
      fields: AssistantPanelField[];
      primary_label: string;
    };
```

### Why

This lets web, mobile, and any future client render the same interrupt semantics differently while sharing the same backend contract.

---

# 11. How assistant-ui should fit into Starlog specifically

## 11.1 Use ExternalStoreRuntime, not LocalRuntime

### Why

Starlog already has:
- persistent server-backed thread state
- explicit session state
- domain APIs
- multi-surface product behavior
- desire for shared thread across devices

LocalRuntime would duplicate too much state in the frontend and make synchronization harder.

### Starlog-specific implication

The frontend runtime adapter should:
- read thread snapshot from Starlog API
- convert Starlog messages into assistant-ui message format
- listen for streaming/delta updates
- submit new messages through Starlog API
- submit interrupt responses through Starlog API

The frontend should not own canonical thread state.

---

## 11.2 Use assistant-ui tool UIs for Starlog dynamic panels

This is where the frontend replacement becomes powerful.

### Example mapping

#### Tool: `request_due_date`
Client UI:
- inline due-date/priority mini-form
- submit -> POST interrupt resolution
- run resumes
- final tool result appears inline

#### Tool: `resolve_planner_conflict`
Client UI:
- compact choice selector
- options generated by backend
- user picks one
- run resumes and applies mutation

#### Tool: `triage_capture`
Client UI:
- radio choice + next-step selector
- submit
- backend records triage and optionally starts follow-up tool

### Why this fits Starlog better than cards alone

Because these are not just “cards with buttons.”
They are **live tool-state-driven UI**.

That is the right level of interactivity for Starlog.

---

## 11.3 Keep cards for summaries and snapshots

Do not discard cards.
Use them for:

- task snapshot
- briefing snapshot
- note preview
- review queue preview
- capture preview
- memory suggestion

### But do not use cards as the only interactive mechanism

That is the key design correction.

---

# 12. Recommended migration by subsystem

This section is practical.

## 12.1 `packages/contracts`

### Actions
- add new assistant thread protocol types
- keep legacy card types for coexistence
- add migration adapters from legacy `ConversationMessage` to `AssistantThreadMessage`

### Why first
Because everything else should code against the new protocol.

---

## 12.2 `services/api/app/db/storage.py`

### Actions
- add new tables:
  - `conversation_runs`
  - `conversation_run_steps`
  - `conversation_interrupts`
  - `conversation_surface_events`
  - optional `conversation_message_parts`
- add forward-compatible migrations / runtime column guards

### Why second
Because API and orchestration changes need persistence first.

---

## 12.3 `services/api/app/services/conversation_service.py`

### Actions
- stop centering the service on “record full turn immediately”
- split into thread/run/interrupt/event/projection services
- move current `build_chat_preview_request()` toward a richer `build_orchestration_context()`

### Why
This is the seam between persistence and orchestration.

---

## 12.4 `services/api/app/services/conversation_card_service.py`

### Actions
- rename/refactor into `assistant_projection_service.py`
- keep existing projection logic
- add:
  - ambient update projection
  - message part projection
  - interrupt summary projection
- stop assuming every rich output must be a card

### Why
This preserves Starlog-specific UX intelligence while modernizing the protocol.

---

## 12.5 `services/api/app/services/agent_command_service.py`

### Actions
- keep deterministic planning logic
- stop treating it as a separate conversation mode
- refactor it into orchestration strategies or tool planner helpers
- have it emit run steps/tool calls rather than immediately projecting final response-only shape

### Why
Starlog’s deterministic command language is an asset.
It should become a first-class orchestration strategy.

---

## 12.6 `services/api/app/services/ai_service.py` and `ai_runtime_service.py`

### Actions
- evolve from `execute_chat_turn() -> response_text/cards`
- to `plan_assistant_turn() -> structured tool/message plan`
- continue to support previews, but previews should also reflect UI/tool planning context

### Why
This is where the backend becomes assistant-ui-compatible rather than card-only.

---

## 12.7 `services/ai-runtime/runtime_app/workflows.py`

### Actions
- introduce richer orchestration output schemas
- add UI capability manifest to prompts
- add decision rules around domain tools vs UI tools
- stop collapsing everything into summary text plus fallback cards

### Why
This is where the “agent understands and can control the UI” capability actually enters the system.

---

# 13. Concrete Starlog UI tools I would introduce first

To keep this migration grounded, here is the first wave I would implement.

## 13.1 `request_due_date`
Use when:
- user asks to create task
- title is known
- due date or scheduling info is missing

Interrupt payload:
- suggested task title
- optional default due date
- optional priority suggestion
- optional “create time block” toggle

## 13.2 `resolve_planner_conflict`
Use when:
- new event/block overlaps existing schedule

Interrupt payload:
- proposed block
- conflict list
- candidate resolutions

## 13.3 `triage_capture`
Use when:
- new capture created
- classification or next action matters

Interrupt payload:
- capture preview
- artifact type choices
- next-step choices

## 13.4 `grade_review_recall`
Use when:
- a review item is initiated from Assistant
- or assistant asks for compact grading

Interrupt payload:
- card prompt/answer summary
- grading options

## 13.5 `choose_morning_focus`
Use when:
- briefing is generated
- one high-leverage next action should be selected quickly

Interrupt payload:
- candidate first actions
- optional duration estimates

### Why these first

They are:
- highly Starlog-specific
- small and structured
- clearly better as interactive tool UIs than as plain cards

---

# 14. Recommended streaming/update model

## Recommendation

Use **SSE** first, websockets only if later required.

### Why SSE first
- simpler backend
- fits “assistant run update stream” well
- enough for:
  - new messages
  - part deltas
  - run-step status changes
  - interrupt openings/resolutions
  - ambient updates

### Suggested events
- `thread.snapshot`
- `message.created`
- `message.updated`
- `run.updated`
- `run.step.updated`
- `interrupt.opened`
- `interrupt.resolved`
- `surface_event.created`

### Why this matters for assistant-ui

assistant-ui feels much better when the UI can react to:
- run starts
- tool loading
- interrupt opening
- result completion

without waiting for a fully completed turn payload.

---

# 15. Backward compatibility and migration strategy

## 15.1 Do not break the existing product all at once

Recommended staged migration:

### Phase 0 — protocol design
- add new contracts
- add DB tables
- keep existing UI and endpoints working

### Phase 1 — run model alongside legacy turn model
- introduce run service
- legacy `/primary/chat` internally uses the new run machinery
- still returns old `ConversationTurnResponse` for current UI

### Phase 2 — assistant-ui frontend prototype
- build a new assistant-ui-based thread against the new endpoints
- use only web desktop first
- keep old assistant page available behind a flag

### Phase 3 — move dynamic panels to tool UIs
- implement first three UI tools
- keep legacy card fallbacks for safety

### Phase 4 — deprecate legacy message contract
- stop using `cards_json` as the main richness channel
- cards become one message part type among others

### Phase 5 — multi-surface convergence
- web, native mobile, and helper all emit surface events
- all clients consume the same thread protocol

---

# 16. What should be thrown out vs preserved

## Throw out / replace

### `apps/web/app/assistant/page.tsx` current UI orchestration assumptions
Replace:
- manual transcript composition
- manual pending-turn placeholders
- ad hoc voice queue presentation in the main UI
- UI logic tightly coupled to current REST turn response

### “cards as the only rich response mechanism”
Replace with:
- message parts
- tool UIs
- interrupts
- ambient updates
- cards where appropriate

### synchronous turn-only backend assumption
Replace with:
- durable runs
- interrupt resume
- delta/stream updates

## Preserve

### domain services
Keep:
- tasks
- notes
- artifacts
- search
- review
- planner
- briefings

### deterministic command intelligence
Keep and refactor:
- parsing logic
- command planning
- tool mapping
- confirmation policy logic

### projection knowledge
Keep and refactor:
- how Starlog turns results into task/review/capture/briefing summaries

### product model
Keep:
- thread first
- support surfaces remain support surfaces
- assistant is the orchestrator, not just a chat box

---

# 17. Risks and mitigation

## Risk 1: too much UI logic leaks into prompts
### Mitigation
Keep UI semantics in typed capability manifests and UI tool schemas, not in vague prompt text.

## Risk 2: backend becomes overly complicated
### Mitigation
Introduce run/interrupt/event services cleanly instead of growing `conversation_service` further.

## Risk 3: assistant-ui integration fights Starlog product assumptions
### Mitigation
Use ExternalStoreRuntime and custom tool UIs. Do not force Starlog into a generic hosted-chat mental model.

## Risk 4: cards and tool UIs create duplicate representations
### Mitigation
Define a clear rule:
- use tool UIs for live interaction
- use cards for summary/snapshot after interaction resolves

## Risk 5: migration stalls under compatibility burden
### Mitigation
Route legacy `/primary/chat` through the new run layer early, so old and new UIs share backend evolution.

---

# 18. Final recommendation

If Starlog is serious about replacing the current chat UI with assistant-ui, the backend should be upgraded around these principles:

1. **Server-owned thread state**
2. **Message-part protocol instead of string+cards only**
3. **Run/step/interrupt model instead of one-shot turn responses**
4. **Surface-event ingestion so the rest of the product can feed the thread**
5. **Explicit UI tools so the agent can request structured interaction**
6. **assistant-ui tool UIs on the client, not arbitrary backend-rendered UI**
7. **Cards preserved as summaries, not as the only interactivity primitive**

The current repo already has a strong domain model and useful assistant semantics.
What it lacks is not product intelligence.
What it lacks is the **interaction protocol** required for a modern, assistant-ui-driven thread.

That is the exact layer this migration should build.

---

# 19. Practical next step

The next concrete deliverable after this document should be:

1. a **new `@starlog/contracts` assistant protocol draft**
2. a **DB migration plan**
3. a **new API spec for threads/runs/interrupts/events**
4. a **frontend adapter plan for assistant-ui ExternalStoreRuntime**
5. a **first-wave UI tool list with payload schemas**

That would turn this architecture document into an implementation blueprint.
