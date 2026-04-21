# Starlog assistant-ui Migration: Repo Execution Checklist

This document turns the earlier design and contract blueprints into an execution-ordered, repo-specific implementation plan.

It is intentionally practical:
- what to change
- in which order
- in which files
- why that order is correct
- what should still work after each phase
- what to defer until later

It assumes:
- Starlog will replace the current chat UI with an assistant-ui based thread UI
- the backend will become the canonical source of truth for threads, runs, interrupts, surface events, and UI-capable tool execution
- the current repo should remain usable during migration rather than being replaced in one large rewrite

---

# 0. Guiding implementation principles

## Principle 1: Preserve domain logic, replace the conversation protocol
Do not rewrite task/calendar/capture/review business logic first.
Rewrite the assistant conversation protocol around those domain services.

Why:
- the current repo already has meaningful domain APIs
- the current weakness is not task creation or artifact storage
- the weakness is that the assistant backend cannot describe UI-bearing agent state cleanly enough for assistant-ui

Implication:
- preserve `tasks_service`, `artifacts_service`, `planning`, `review`, etc.
- replace the conversation message/run/interrupt contract around them

## Principle 2: Add a new assistant stack instead of mutating the old conversation stack in place
Do not immediately mutate `services/api/app/api/routes/conversations.py` into the new protocol.
Introduce a parallel `assistant` route family and an adapter layer.

Why:
- you need the old app to keep working while the new frontend is built
- the new protocol is structurally different enough that in-place mutation will create fragile mixed semantics
- the current `conversations` route is “one request in, one response out”; the new system is thread + run + interrupt oriented

Implication:
- add `/v1/assistant/...`
- leave `/v1/conversations/primary/chat` in place initially
- later make `/v1/conversations/primary/chat` delegate to the new assistant service internally

## Principle 3: The backend sends semantic UI instructions, not arbitrary UI trees
The backend should never send JSX-like payloads or arbitrary component descriptions.
It should send:
- message parts
- tool calls
- interrupts
- surface events
- ambient updates
- stable tool names and stable typed payloads

Why:
- assistant-ui works best when the client maps known tool/message types to React components
- this keeps the UI secure, versionable, testable, and resilient
- it avoids coupling model output to frontend implementation details

Implication:
- `resolve_planner_conflict` is a tool/interrupt type
- the frontend decides how that becomes a panel or sheet

## Principle 4: Cards remain, but become projections, not the core control plane
Cards are still useful for compact summaries and suggestions.
They should no longer carry most of the interaction burden.

Why:
- cards are good summaries
- tool UIs and interrupts are better for structured interaction
- reducing card overuse will reduce the “nested blocks” problem

Implication:
- preserve card projection as a compatibility and summary layer
- move interactive flows into tool UIs and interrupts

---

# 1. The target architecture in one sentence

Starlog should move from:

`message.content + cards + metadata + separate traces`

to:

`thread + messages composed of typed parts + runs + run steps + interrupts + surface events + projected summaries`

---

# 2. What to keep, what to replace

## Keep mostly intact
These are not the main problem:

- `services/api/app/services/tasks_service.py`
- `services/api/app/services/artifacts_service.py`
- `services/api/app/services/notes_service.py`
- `services/api/app/services/planning_*`
- `services/api/app/services/memory_*`
- `services/api/app/services/research_*`
- the existing domain tables in `storage.py`

## Replace or heavily refactor
These are at the center of the migration:

- `packages/contracts/src/assistant.ts`
- `packages/contracts/src/index.ts`
- `services/api/app/api/routes/conversations.py`
- `services/api/app/schemas/conversations.py`
- `services/api/app/services/conversation_service.py`
- `services/api/app/services/conversation_card_service.py`
- `services/api/app/services/agent_command_service.py`
- `services/api/app/services/ai_service.py`
- `services/api/app/services/ai_runtime_service.py`
- `services/ai-runtime/runtime_app/workflows.py`
- `apps/web/app/assistant/page.tsx`
- `apps/web/app/components/main-room-thread.tsx`

These files currently encode the old thread model directly.

---

# 3. Migration phases

## Phase A — Contracts first
Goal:
Create the new protocol in `@starlog/contracts` before touching storage or API.

Why this must be first:
- both backend and frontend need a shared vocabulary
- the run/interrupt/message-part model should drive everything else
- without the contracts, every later change is guesswork

## Phase B — Storage and backend scaffolding
Goal:
Add the new tables and services without changing existing routes yet.

Why second:
- the new routes need persistence primitives
- storage is lower-risk than UI and can be added alongside current behavior
- this makes it possible to dual-write or bridge later

## Phase C — New `/v1/assistant` routes
Goal:
Expose the new thread/run/interrupt/event API while leaving the old conversation API untouched.

Why third:
- the new frontend needs an isolated stable target
- the old frontend should not break during backend development

## Phase D — Legacy adapter
Goal:
Make old `/v1/conversations/primary/chat` and related routes delegate to the new assistant core.

Why fourth:
- once the new assistant backend exists, there should be one execution core
- this prevents duplicated behavior and divergent bugs

## Phase E — assistant-ui frontend
Goal:
Build the new Assistant thread on top of the new backend protocol.

Why fifth:
- the frontend should target a stable backend
- otherwise you will end up designing frontend workarounds for backend gaps

## Phase F — Cleanup and removal
Goal:
Remove old conversation-specific abstractions once the assistant-ui thread is the canonical client.

---

# 4. Exact contract work

## 4.1 Replace `packages/contracts/src/assistant.ts`
This file should stop being “cards and message metadata” only.

### Current weakness
It currently centers:
- `AssistantCard`
- `AssistantConversationMessage`
- `AssistantConversationToolTrace`

That implies UI is a sidecar on a message.
For assistant-ui, UI-relevant state must be part of the message/run protocol.

### New target
Replace with a richer protocol that includes:

- thread
- message
- message parts
- run
- run step
- interrupt
- surface event
- ambient update
- card projection
- tool UI descriptors

### Suggested file split
Instead of a single `assistant.ts`, create:

- `packages/contracts/src/assistant-thread.ts`
- `packages/contracts/src/assistant-message.ts`
- `packages/contracts/src/assistant-run.ts`
- `packages/contracts/src/assistant-interrupt.ts`
- `packages/contracts/src/assistant-events.ts`
- `packages/contracts/src/assistant-card.ts`
- `packages/contracts/src/assistant-tool-ui.ts`

Then re-export from `index.ts`.

### Why split?
Because the current file is already trying to do too much with too few concepts.
The new protocol is big enough that one file will become unmaintainable.

## 4.2 Introduce message parts
Add a discriminated union like:

- `text`
- `card`
- `ambient_update`
- `tool_call`
- `tool_result`
- `interrupt_request`
- `interrupt_resolution`
- `status`

### Why message parts are necessary
Because assistant-ui naturally renders messages as richer structured units.
If Starlog stays with “content string + cards[]”, every richer behavior becomes metadata abuse.

## 4.3 Introduce run contracts
Add:
- `AssistantRun`
- `AssistantRunStep`

### Why runs are necessary
Because a single user action may:
- start model reasoning
- invoke several tools
- pause for user input
- resume
- end later

That lifecycle cannot be represented cleanly as one assistant message plus one trace.

## 4.4 Introduce interrupt contracts
Add:
- `AssistantInterrupt`
- `AssistantInterruptResolution`

### Why interrupts are necessary
The current repo uses confirmation flags and cards, but not a durable pause-and-resume protocol.
Dynamic panels need something stronger:
- an object with a stable ID
- a reason
- a tool name
- required fields or choices
- status
- resolution history

This is the core object behind:
- due date prompt
- planner conflict resolution
- capture triage
- review grading from thread

## 4.5 Introduce surface event contracts
Add:
- `AssistantSurfaceEvent`
- `AssistantAmbientUpdate`

### Why this matters
The current generic domain events are not thread-aware and not typed for assistant orchestration.
Starlog needs assistant-facing event ingestion from:
- Library
- Planner
- Review
- Desktop helper
- system routines like briefings

## 4.6 Keep card contracts, but narrow their role
Retain:
- card kind
- entity ref
- card actions

But explicitly describe cards as:
- summaries
- secondary follow-up affordances
- compatibility fallback for clients without rich tool UIs

### Why this matters
It prevents cards from continuing to absorb all interaction complexity.

---

# 5. Storage changes

## 5.1 Add new tables in `services/api/app/db/storage.py`

### New table: `conversation_runs`
Purpose:
one durable execution record per assistant turn / agent cycle

Fields:
- `id`
- `thread_id`
- `origin_message_id`
- `status` (`queued`, `running`, `interrupted`, `completed`, `failed`, `cancelled`)
- `planner`
- `model`
- `provider`
- `metadata_json`
- `created_at`
- `updated_at`
- `finished_at`

### Why needed
Today there is no durable object for “the assistant is in the middle of doing something”.

### New table: `conversation_run_steps`
Purpose:
store per-tool/per-phase execution units inside a run

Fields:
- `id`
- `run_id`
- `thread_id`
- `message_id`
- `step_type` (`model`, `tool_call`, `tool_result`, `interrupt`, `projection`)
- `tool_name`
- `status`
- `input_json`
- `output_json`
- `metadata_json`
- `started_at`
- `finished_at`

### Why needed
Current `conversation_tool_traces` are too flat and too backend-centric.
You need ordered run steps that can map cleanly into assistant-ui tool rendering.

### New table: `conversation_interrupts`
Purpose:
store assistant pauses waiting for user or UI resolution

Fields:
- `id`
- `thread_id`
- `run_id`
- `message_id`
- `tool_name`
- `interrupt_kind`
- `status` (`open`, `resolved`, `dismissed`, `expired`)
- `title`
- `body`
- `request_json`
- `resolution_json`
- `created_at`
- `resolved_at`
- `expires_at`

### Why needed
This is the persistence layer for dynamic UI panels.

### New table: `conversation_surface_events`
Purpose:
store assistant-facing events from product surfaces

Fields:
- `id`
- `thread_id`
- `source_surface`
- `event_kind`
- `entity_type`
- `entity_id`
- `payload_json`
- `visibility`
- `created_at`

### Why needed
The current `domain_events` table is global and generic.
The assistant needs a thread-aware stream.

### New table: `conversation_message_parts`
Purpose:
optional normalization table for message parts if you do not want to store everything in one JSON blob

Fields:
- `id`
- `message_id`
- `part_index`
- `part_kind`
- `payload_json`
- `created_at`

### Should you use this?
Recommended: **yes**, if you expect multiple clients, pagination, replay, or fine-grained updates.
If you want faster early delivery, you can initially keep `parts_json` on `conversation_messages` and add this later.

## 5.2 Extend existing `conversation_messages`
Add:
- `parts_json`
- optionally `run_id`
- optionally `source_surface`

### Why this is needed
The current `content` string should remain, but it should become a derived summary/fallback field, not the only payload.

## 5.3 Keep existing `conversation_tool_traces` during migration
Do not delete immediately.

### Why
They are useful for backward compatibility and debugging.
Later they can be derived from `conversation_run_steps` or retired.

---

# 6. Backend service refactor

## 6.1 Create a new assistant service package
Add a new directory:

`services/api/app/services/assistant/`

With these modules:

- `thread_service.py`
- `message_service.py`
- `run_service.py`
- `interrupt_service.py`
- `surface_event_service.py`
- `projection_service.py`
- `legacy_adapter_service.py`

### Why a new package?
Because the current logic is spread across:
- `conversation_service`
- `conversation_card_service`
- `agent_command_service`
- `ai_service`

Those files mix persistence, planning, execution, and projection too tightly.

## 6.2 `thread_service.py`
Responsibilities:
- create/get threads
- paginate messages
- fetch thread snapshot
- fetch thread state suitable for assistant-ui runtime

Why:
- thread lifecycle should be separate from run lifecycle

## 6.3 `message_service.py`
Responsibilities:
- append user/system/assistant messages
- append message parts
- normalize message payloads
- support message updates when runs progress

Why:
- assistant-ui expects message state to evolve over time
- current append-only string message logic is too limited

## 6.4 `run_service.py`
Responsibilities:
- create runs
- append run steps
- transition run status
- resume runs after interrupts
- final projection into assistant messages

Why:
- this becomes the new orchestration spine

## 6.5 `interrupt_service.py`
Responsibilities:
- open interrupt
- validate interrupt submission
- resolve interrupt
- dismiss interrupt
- convert resolution into tool input for run continuation

Why:
- dynamic UI panels are not just UI; they are backend execution pauses

## 6.6 `surface_event_service.py`
Responsibilities:
- ingest events from Library/Planner/Review/helper
- store them
- decide projection mode (`internal`, `ambient`, `assistant_message`)
- optionally trigger new runs

Why:
- Starlog needs the assistant to notice surface activity without requiring chat narration

## 6.7 `projection_service.py`
Responsibilities:
- build cards from domain objects
- build ambient updates
- build tool result parts
- create compatibility fallback payloads for older clients

Why:
- projection should become explicit and reusable, not hidden inside `conversation_card_service`

## 6.8 `legacy_adapter_service.py`
Responsibilities:
- translate old conversation API calls into new run protocol
- translate new thread snapshot into old `ConversationTurnResponse` shape where needed

Why:
- this is how you keep the old frontend alive while migrating

---

# 7. API route changes

## 7.1 Add new route file
Create:

`services/api/app/api/routes/assistant.py`

Register it in:
`services/api/app/api/router.py`

### Why new routes instead of reusing `conversations.py`
Because the semantics are different enough to justify a new namespace.

## 7.2 New endpoint family
Add endpoints like:

### Threads
- `GET /v1/assistant/threads/primary`
- `GET /v1/assistant/threads/{thread_id}`
- `GET /v1/assistant/threads/{thread_id}/messages`
- `POST /v1/assistant/threads/{thread_id}/messages`

### Runs
- `POST /v1/assistant/threads/{thread_id}/runs`
- `GET /v1/assistant/threads/{thread_id}/runs/{run_id}`
- `POST /v1/assistant/threads/{thread_id}/runs/{run_id}/resume`
- `POST /v1/assistant/threads/{thread_id}/runs/{run_id}/cancel`

### Interrupts
- `GET /v1/assistant/threads/{thread_id}/interrupts`
- `POST /v1/assistant/threads/{thread_id}/interrupts/{interrupt_id}/resolve`
- `POST /v1/assistant/threads/{thread_id}/interrupts/{interrupt_id}/dismiss`

### Surface events
- `POST /v1/assistant/threads/{thread_id}/events`
- `GET /v1/assistant/threads/{thread_id}/events`

### Session and projections
- `POST /v1/assistant/threads/{thread_id}/session/reset`
- `GET /v1/assistant/threads/{thread_id}/snapshot`

## 7.3 Keep old route file temporarily
Keep:
`services/api/app/api/routes/conversations.py`

But later reduce it to:
- compatibility endpoints only
- thin wrappers over the new assistant service

---

# 8. AI runtime changes

## 8.1 Stop returning only `response_text + cards`
Current runtime outputs are too weak for UI-aware control.

Change the runtime contract so it can return:
- assistant text
- proposed tool calls
- proposed interrupts
- requested UI-capability hints
- ambient updates
- session state patch
- run metadata

## 8.2 Add a “UI capability context” to prompts
Today the runtime sees thread messages, traces, session state, and memory context.
It also needs to know:
- what tool UIs exist
- which interrupts are supported
- what surfaces are available
- what entity selection or clarification flows the frontend can actually render

Add to runtime context:
- `tool_ui_catalog`
- `interrupt_catalog`
- `surface_capabilities`
- `client_capabilities`

### Why
Otherwise the model cannot plan with awareness of what the UI can support.

## 8.3 Add explicit interrupt planning support
The runtime should be able to say:
- do not invent prose asking for a due date
- instead request `interrupt_kind = "request_due_date"`

### Why
If the model keeps communicating missing fields only through text, you will never fully benefit from assistant-ui tool UIs.

## 8.4 Preserve deterministic command routing as a fast path
Current deterministic command parsing is useful and should stay.

But change its output target from:
- assistant summary + cards + traces

to:
- run
- run steps
- optional interrupt
- projected summary parts/cards

### Why
Even deterministic commands should run through the new protocol so there is only one UI model.

---

# 9. Frontend replacement order

## 9.1 Do not start with a visual rebuild
Start by building a thin assistant-ui shell against fake/new backend data.

Why:
- you need to validate message parts and tool UI mapping first
- visual polish can come after semantics work

## 9.2 Replace these current files first
Most likely replace entirely:

- `apps/web/app/assistant/page.tsx`
- `apps/web/app/components/main-room-thread.tsx`

Keep temporarily:
- layout shell
- route structure
- auth/session wrappers

## 9.3 Build a Starlog-specific assistant-ui runtime adapter
New frontend files:
- `apps/web/app/assistant/runtime/starlog-thread-runtime.ts`
- `apps/web/app/assistant/runtime/starlog-message-mapper.ts`
- `apps/web/app/assistant/runtime/starlog-tool-ui-registry.tsx`
- `apps/web/app/assistant/runtime/starlog-interrupt-resolver.ts`

### Why
This becomes the boundary between your backend protocol and assistant-ui.

## 9.4 First tool UIs to build
Build these first:
- `request_due_date`
- `resolve_planner_conflict`
- `triage_capture`

Why:
- they are the clearest proof that the new architecture is working
- they map directly to the product direction we discussed
- they force the backend interrupt model to become real

---

# 10. File-by-file implementation order

## Step 1 — Contracts
### Change
- split `packages/contracts/src/assistant.ts`
- update `packages/contracts/src/index.ts`

### Deliverable
A compiling contracts package with the new assistant protocol types.

### Why first
Everything else depends on these types.

## Step 2 — Storage
### Change
- update `services/api/app/db/storage.py`
- add new tables and columns
- keep migration logic backward compatible

### Deliverable
Local database initializes with both old and new assistant storage.

### Why second
Routes and services need persistence before they can be tested.

## Step 3 — Backend assistant schemas
### Add
- `services/api/app/schemas/assistant.py`

### Deliverable
Pydantic models matching the new TS contracts.

### Why third
You need explicit backend schemas before adding services and routes.

## Step 4 — New assistant service package
### Add
- `services/api/app/services/assistant/thread_service.py`
- `services/api/app/services/assistant/message_service.py`
- `services/api/app/services/assistant/run_service.py`
- `services/api/app/services/assistant/interrupt_service.py`
- `services/api/app/services/assistant/surface_event_service.py`
- `services/api/app/services/assistant/projection_service.py`

### Deliverable
Core backend orchestration package exists independently of old conversation service.

### Why fourth
This is the real backend core.

## Step 5 — New assistant routes
### Add
- `services/api/app/api/routes/assistant.py`

### Modify
- `services/api/app/api/router.py`

### Deliverable
You can create thread messages, start runs, resolve interrupts, and ingest surface events through `/v1/assistant/...`.

### Why fifth
Now the new protocol is externally usable.

## Step 6 — AI runtime contract extension
### Modify
- `services/api/app/services/ai_service.py`
- `services/api/app/services/ai_runtime_service.py`
- `services/ai-runtime/runtime_app/workflows.py`

### Deliverable
Runtime can return tool calls and interrupts, not just text and cards.

### Why sixth
Now the backend can actually generate UI-bearing execution states.

## Step 7 — Deterministic command migration
### Modify
- `services/api/app/services/agent_command_service.py`

### Goal
Make deterministic command flows create runs/interrupts/message parts instead of directly writing only summary+cards+traces.

### Deliverable
Commands like create task / planner conflict / capture triage work through the new assistant run protocol.

### Why seventh
This is where current product behavior is preserved while changing architecture.

## Step 8 — Legacy adapter
### Modify
- `services/api/app/services/conversation_service.py`
- `services/api/app/api/routes/conversations.py`

### Goal
Adapt the old conversation endpoints to call the new assistant backend internally.

### Deliverable
Old clients still work, but only one backend execution model exists.

### Why eighth
This is the point where duplication starts shrinking.

## Step 9 — Frontend runtime adapter
### Add
- assistant-ui integration files under `apps/web/app/assistant/runtime/`

### Deliverable
assistant-ui can load Starlog thread state and render it.

### Why ninth
Now the frontend has a stable backend to target.

## Step 10 — Tool UIs and new assistant page
### Replace
- `apps/web/app/assistant/page.tsx`
- `apps/web/app/components/main-room-thread.tsx`

### Deliverable
New assistant-ui based thread surface with Starlog tool UIs.

### Why tenth
This is the visible payoff phase.

## Step 11 — Surface event emitters
### Modify
Where relevant in web/mobile/helper flows:
- capture actions
- planner edits
- review grading
- briefing playback

### Deliverable
Assistant becomes aware of user activity across surfaces.

### Why eleventh
The thread-first life OS behavior emerges only once surfaces emit assistant-facing events.

## Step 12 — Remove obsolete conversation-specific UI logic
### Remove/refactor
- UI state patterns that assume cards are the only interaction primitive
- old pane logic that existed mainly for traces and command history

### Deliverable
Cleaner assistant surface with fewer nested blocks and less legacy behavior.

---

# 11. What to test after each phase

## After contracts
- TS build passes
- no consumer imports are broken unexpectedly

## After storage
- local DB boots on fresh install
- old routes still run
- new tables exist

## After assistant routes
- create message
- create run
- interrupt resolution round trip
- thread snapshot returns structured message parts

## After runtime extension
- runtime can return an interrupt request
- deterministic command path can open an interrupt instead of only replying with text

## After legacy adapter
- old `/v1/conversations/primary/chat` still works
- output stays backward compatible for old UI

## After assistant-ui frontend
- send text message
- render tool call
- open interrupt UI
- resolve interrupt
- thread updates correctly
- no duplicate messages
- no stale local-only state

---

# 12. The first vertical slice to build

Do not attempt every scenario at once.

Build this first vertical slice:

## Scenario
User types:
`Create a task to review the diffusion notes`

## Backend behavior
1. user message stored
2. run created
3. deterministic planner sees missing due date
4. interrupt opened: `request_due_date`
5. assistant message includes text + interrupt request part
6. frontend renders due-date tool UI
7. user submits due date and priority
8. interrupt resolved
9. run resumes
10. task created
11. assistant result message includes task summary + compact task card

## Why this is the best first slice
It touches:
- message parts
- run model
- interrupt model
- deterministic execution
- assistant-ui tool UI
- card projection fallback
- thread update lifecycle

If this slice works, the whole architecture is probably sound.

---

# 13. What not to do yet

Do not do these in the first pass:

- free-form model-defined UI schemas
- multiple simultaneous active interrupts per run
- complex multi-user thread models
- branching assistant conversations
- replacing every old card immediately
- streaming token-by-token fancy rendering before run semantics are stable
- trying to make all support surfaces assistant-native at once

Why:
You need protocol stability first.
Starlog’s biggest risk is architectural sprawl, not missing frontend cleverness.

---

# 14. Recommended PR breakdown

## PR 1
Contracts package split and new assistant protocol types

## PR 2
DB tables + backend schemas for runs/interrupts/events

## PR 3
New assistant service package + `/v1/assistant` routes

## PR 4
AI runtime contract extension + deterministic command integration

## PR 5
Legacy adapter for old conversation routes

## PR 6
assistant-ui runtime adapter + minimal new assistant page

## PR 7
First tool UIs: due date, planner conflict, capture triage

## PR 8
Surface event emission from helper/planner/review/library

## PR 9
Cleanup, removal of obsolete thread UI logic, visual polish

---

# 15. Final recommendation

If you want the cleanest implementation path:

1. **Do not begin with styling.**
2. **Do not rewrite domain services.**
3. **Start with contracts and storage.**
4. **Create a new assistant execution core beside the old conversation stack.**
5. **Prove one interrupt-based flow end to end.**
6. **Only then replace the entire frontend thread with assistant-ui.**

That order is the lowest-risk path to a real architectural upgrade rather than a prettier but brittle chat rewrite.
