# Starlog → assistant-ui Migration Blueprint
## Exact contracts, endpoint schemas, and backend changes
## With decision-making walkthrough

This document is the **implementation-oriented follow-up** to the earlier migration design.

Its job is narrower and more concrete:

1. define the **exact assistant protocol** Starlog should adopt in `@starlog/contracts`
2. define the **exact API shapes** for threads, messages, runs, interrupts, events, and deltas
3. define the **exact storage additions** required in `services/api`
4. define the **exact service-layer refactor** required in the current repo
5. explain the **decision process** behind each major design choice

This is written specifically against the current Starlog repo shape:
- `packages/contracts/src/assistant.ts`
- `services/api/app/api/routes/conversations.py`
- `services/api/app/services/conversation_service.py`
- `services/api/app/services/agent_command_service.py`
- `services/api/app/services/conversation_card_service.py`
- `services/api/app/services/ai_service.py`
- `services/api/app/services/ai_runtime_service.py`
- `services/ai-runtime/runtime_app/workflows.py`
- `services/api/app/db/storage.py`

---

# 1. Decision process: how I arrived at this design

This section is intentionally explicit, because you asked not only for the output, but also for the reasoning path.

## 1.1 What I optimized for

I optimized for these Starlog-specific goals:

1. **Assistant-first product model stays intact**
   - one persistent thread remains the center
   - `Library`, `Planner`, and `Review` remain support surfaces
   - the backend remains authoritative

2. **assistant-ui should replace the current chat UI cleanly**
   - not just be wrapped around today’s `content + cards` model
   - not force you into a frontend-owned state model

3. **The agent must be able to understand and influence UI state**
   - but without the backend sending arbitrary React trees
   - and without turning the prompt into a pile of ad hoc UI rules

4. **The migration should be staged**
   - current endpoints and storage cannot all disappear at once
   - the current deterministic command logic is valuable and should be preserved

## 1.2 Options I considered

### Option A — keep current message contract and just map it into assistant-ui
This would preserve:
- `content`
- `cards`
- `tool_traces`
- `metadata`

and add a thin UI adapter.

### Why I rejected it
Because it would make assistant-ui a cosmetic replacement only.

Starlog would still be missing the crucial protocol features for:
- tool lifecycle
- run status
- interrupts / human-in-the-loop
- resumable structured UI requests
- incremental updates

That path would create an integration that “works” but still feels like the old architecture wearing a new UI shell.

---

### Option B — let the backend send arbitrary UI descriptions or HTML-like trees
This would let the model “control the UI” very directly.

### Why I rejected it
Because it would create the worst of both worlds:
- fragile backend/frontend coupling
- unsafe UI semantics
- poor validation
- difficult mobile parity
- difficult long-term maintenance

This is the wrong boundary.

The backend should send **semantic instructions**:
- tool names
- interrupt descriptors
- card payloads
- ambient updates
- surface navigation intentions

The frontend should decide how those are rendered.

---

### Option C — assistant-ui ExternalStoreRuntime with server-owned protocol
This means:
- Starlog remains the system of record
- assistant-ui becomes the rendering/runtime layer
- Starlog exposes threads, runs, interrupts, deltas
- the client renders registered Tool UIs for named tool calls

### Why I chose it
Because it matches both sides:
- **assistant-ui** explicitly supports bringing your own state, persistence, thread model, and message format
- **Starlog** already has a strong server-backed thread model and domain APIs

This is the cleanest fit.

## 1.3 The most important architectural decision

The most important choice is this:

> **Make UI-bearing interaction state first-class in the backend protocol.**

That means:
- a user turn starts a **run**
- a run contains **steps**
- steps may create **interrupts**
- messages contain **parts**
- surface activity enters through **surface events**
- cards become one projection type among several, not the only richness mechanism

Everything else follows from that.

---

# 2. What changes from the current repo

## 2.1 Current state in one sentence

Today, Starlog’s assistant protocol is fundamentally:

- user message string
- assistant string
- optional cards
- optional tool traces
- optional session-state patch

That is too coarse for assistant-ui.

## 2.2 Target state in one sentence

Starlog should move to:

- threads
- messages with typed parts
- runs
- run steps
- interrupts
- surface events
- deltas / stream updates
- cards as message parts or projections

---

# 3. Exact contract changes for `@starlog/contracts`

## 3.1 Guiding rule for contracts

The contract package should become the **single shared assistant protocol** for:
- API
- web
- mobile
- helper
- future streaming/delta adapters

It should stop being “just cards + traces”.

## 3.2 Recommended file split

Keep `packages/contracts/src/assistant.ts`, but expand it or split it into:

- `assistant-core.ts`
- `assistant-message-parts.ts`
- `assistant-runs.ts`
- `assistant-interrupts.ts`
- `assistant-events.ts`
- `assistant-legacy-adapters.ts`

If you prefer minimal churn, one file is acceptable initially, but conceptually these are separate layers.

## 3.3 Exact TypeScript contracts

### 3.3.1 Core assistant entity references

```ts
export type AssistantEntityRef = {
  entity_type: string;
  entity_id: string;
  href?: string | null;
  title?: string | null;
};
```

Keep essentially as-is.

---

### 3.3.2 Cards

Keep cards, but make them one part type rather than the top-level “richness channel”.

```ts
export const ASSISTANT_CARD_ACTION_KINDS = [
  "navigate",
  "mutation",
  "composer",
  "interrupt",
] as const;

export type AssistantCardActionKind =
  (typeof ASSISTANT_CARD_ACTION_KINDS)[number];

export type AssistantCardActionStyle =
  | "primary"
  | "secondary"
  | "ghost"
  | "danger";

export type AssistantCardAction = {
  id: string;
  label: string;
  kind: AssistantCardActionKind;
  payload?: Record<string, unknown>;
  style?: AssistantCardActionStyle;
  requires_confirmation?: boolean;
};

export type AssistantCard = {
  kind: string;
  version: number;
  title?: string | null;
  body?: string | null;
  entity_ref?: AssistantEntityRef | null;
  actions: AssistantCardAction[];
  metadata: Record<string, unknown>;
};
```

### Why add `interrupt` as a card action kind?
Because some compact cards will want to open a structured interrupt/panel rather than:
- navigate
- mutate directly
- or prefill the composer

That gives you a clean bridge between summary cards and live interactive tool UIs.

---

### 3.3.3 Attachments

You need a first-class attachment part instead of forcing everything through cards.

```ts
export type AssistantAttachment = {
  id: string;
  kind: "artifact" | "image" | "audio" | "file" | "citation";
  label: string;
  url?: string | null;
  mime_type?: string | null;
  entity_ref?: AssistantEntityRef | null;
  metadata: Record<string, unknown>;
};
```

### Why
Because assistant-ui threads often want a separate visual treatment for attachments versus cards.

---

### 3.3.4 Ambient updates

```ts
export type AssistantAmbientUpdate = {
  id: string;
  event_id: string;
  label: string;
  body?: string | null;
  entity_ref?: AssistantEntityRef | null;
  actions?: AssistantCardAction[];
  metadata: Record<string, unknown>;
  created_at: string;
};
```

### Why
This is the clean primitive for:
- `Desktop helper imported 1 screenshot`
- `Planner found a conflict`
- `Review session: 3 misses in diffusion foundations`

It is lighter than a full assistant message.

---

### 3.3.5 Tool kinds and tool status

```ts
export type AssistantToolKind =
  | "domain_tool"
  | "ui_tool"
  | "system_tool";

export type AssistantToolStatus =
  | "queued"
  | "running"
  | "requires_action"
  | "complete"
  | "error"
  | "cancelled";
```

### Why
You need a backend-native distinction between:
- real domain mutations
- user-interaction tools
- orchestration/system tools

That distinction will matter in:
- prompts
- validation
- rendering
- analytics
- migration discipline

---

### 3.3.6 Message parts

This is the single biggest contract change.

```ts
export type AssistantMessagePart =
  | {
      type: "text";
      text: string;
    }
  | {
      type: "reasoning_summary";
      text: string;
      metadata?: Record<string, unknown>;
    }
  | {
      type: "tool_call";
      toolCallId: string;
      toolName: string;
      toolKind: AssistantToolKind;
      args: Record<string, unknown>;
      status: AssistantToolStatus;
      metadata?: Record<string, unknown>;
    }
  | {
      type: "tool_result";
      toolCallId: string;
      result: unknown;
      isError?: boolean;
      metadata?: Record<string, unknown>;
    }
  | {
      type: "card";
      card: AssistantCard;
    }
  | {
      type: "ambient_update";
      update: AssistantAmbientUpdate;
    }
  | {
      type: "attachment";
      attachment: AssistantAttachment;
    }
  | {
      type: "quote";
      text: string;
      source?: string | null;
      metadata?: Record<string, unknown>;
    };
```

### Why this exact shape
I chose a **part union** instead of a bigger monolithic message object because:

- assistant-ui works naturally with structured message content
- the frontend can render different parts differently
- the backend can incrementally append or stream parts
- cards stop being overloaded
- tool lifecycle becomes explicit

### Why not add a `"panel"` part?
Because live panels should be represented as **interrupts/tool UI state**, not as raw UI payloads inside messages.
A message may summarize an interrupt, but the interrupt itself should be a separate durable object.

---

### 3.3.7 Thread messages

```ts
export type AssistantThreadMessage = {
  id: string;
  thread_id: string;
  role: "system" | "user" | "assistant" | "tool";
  parts: AssistantMessagePart[];
  status?: "in_progress" | "complete" | "cancelled" | "error";
  metadata: Record<string, unknown>;
  created_at: string;
  updated_at?: string | null;
  parent_id?: string | null;
  run_id?: string | null;
};
```

### Why add `run_id`
Because a message should be attributable to a run, especially if:
- the user refreshes
- a run is resumed
- multiple background updates land

### Why add `status`
Because assistant-ui can show:
- running
- complete
- cancelled
without special-case hacks.

---

### 3.3.8 Runs

```ts
export type AssistantRun = {
  id: string;
  thread_id: string;
  triggered_by_message_id: string;
  status:
    | "queued"
    | "running"
    | "requires_action"
    | "complete"
    | "error"
    | "cancelled";
  orchestrator: "deterministic" | "llm_runtime" | "hybrid";
  provider_used?: string | null;
  model?: string | null;
  current_interrupt_id?: string | null;
  metadata: Record<string, unknown>;
  created_at: string;
  updated_at: string;
  finished_at?: string | null;
};
```

### Why `orchestrator`
This is how you preserve Starlog’s current strengths while unifying the runtime:
- deterministic command path
- LLM chat path
- hybrid path

The frontend should not care much, but the backend and diagnostics absolutely should.

---

### 3.3.9 Run steps

```ts
export type AssistantRunStep = {
  id: string;
  run_id: string;
  message_id?: string | null;
  tool_call_id: string;
  tool_name: string;
  tool_kind: AssistantToolKind;
  arguments: Record<string, unknown>;
  status: AssistantToolStatus;
  result?: unknown;
  error_text?: string | null;
  backing_endpoint?: string | null;
  requires_confirmation?: boolean;
  confirmation_state?: "not_required" | "required" | "confirmed";
  metadata: Record<string, unknown>;
  created_at: string;
  updated_at: string;
};
```

### Why this shape
It preserves the useful parts of the current `AgentCommandStep` and `ConversationToolTrace`, while upgrading them into a first-class run-step object.

---

### 3.3.10 Interrupt field schema

```ts
export type AssistantPanelField =
  | {
      id: string;
      kind: "text";
      label: string;
      value?: string;
      placeholder?: string;
      required?: boolean;
    }
  | {
      id: string;
      kind: "textarea";
      label: string;
      value?: string;
      placeholder?: string;
      required?: boolean;
    }
  | {
      id: string;
      kind: "date";
      label: string;
      value?: string;
      required?: boolean;
    }
  | {
      id: string;
      kind: "time";
      label: string;
      value?: string;
      required?: boolean;
    }
  | {
      id: string;
      kind: "datetime";
      label: string;
      value?: string;
      required?: boolean;
    }
  | {
      id: string;
      kind: "toggle";
      label: string;
      value?: boolean;
    }
  | {
      id: string;
      kind: "select";
      label: string;
      value?: string;
      required?: boolean;
      options: Array<{
        id: string;
        label: string;
        value: string;
        description?: string;
      }>;
    }
  | {
      id: string;
      kind: "priority";
      label: string;
      value?: number;
      min?: number;
      max?: number;
    };
```

### Why define fields here
Because the payloads for interactive panels should be:
- typed
- validated
- shared across web/mobile/helper
- owned by contracts, not hidden in frontend-only components

---

### 3.3.11 Interrupt payloads

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
      secondary_label?: string;
    };
```

### Why only three interrupt categories initially
Because they cover almost all of Starlog’s first-wave needs:
- confirmation
- planner conflict choice
- task/capture/detail forms

You can add more later if the product proves it needs them.

---

### 3.3.12 Interrupts

```ts
export type AssistantInterrupt = {
  id: string;
  run_id: string;
  tool_call_id: string;
  tool_name: string;
  payload: AssistantInterruptPayload;
  status: "open" | "submitted" | "dismissed" | "expired" | "cancelled";
  submitted_payload?: Record<string, unknown> | null;
  metadata: Record<string, unknown>;
  created_at: string;
  resolved_at?: string | null;
};
```

### Why include `tool_name`
So the client can map the interrupt to the right assistant-ui Tool UI even if it does not inspect every inner payload detail.

---

### 3.3.13 Surface events

```ts
export type AssistantSurfaceEvent = {
  id: string;
  thread_id: string;
  source_surface:
    | "assistant"
    | "library"
    | "planner"
    | "review"
    | "desktop_helper"
    | "system";
  kind: string;
  entity_ref?: AssistantEntityRef | null;
  payload: Record<string, unknown>;
  visibility: "internal" | "ambient" | "assistant_message";
  created_at: string;
};
```

---

### 3.3.14 Thread summaries

```ts
export type AssistantThreadSummary = {
  id: string;
  slug?: string | null;
  title: string;
  mode: string;
  latest_message_preview?: string | null;
  last_updated_at: string;
  archived?: boolean;
  metadata: Record<string, unknown>;
};
```

### Why
assistant-ui has a thread-list runtime and Starlog should meet it with a proper thread list contract rather than only `/primary`.

---

### 3.3.15 Thread snapshot

```ts
export type AssistantThreadSnapshot = {
  thread: AssistantThreadSummary;
  messages: AssistantThreadMessage[];
  runs: AssistantRun[];
  open_interrupts: AssistantInterrupt[];
  cursor?: string | null;
  session_state: Record<string, unknown>;
};
```

### Why
This is the natural external-store hydration object.

---

### 3.3.16 Deltas / update feed

```ts
export type AssistantThreadDeltaEvent =
  | { type: "message.created"; message: AssistantThreadMessage }
  | { type: "message.updated"; message: AssistantThreadMessage }
  | { type: "run.created"; run: AssistantRun }
  | { type: "run.updated"; run: AssistantRun }
  | { type: "run.step.created"; step: AssistantRunStep }
  | { type: "run.step.updated"; step: AssistantRunStep }
  | { type: "interrupt.opened"; interrupt: AssistantInterrupt }
  | { type: "interrupt.resolved"; interrupt: AssistantInterrupt }
  | { type: "surface_event.created"; event: AssistantSurfaceEvent };

export type AssistantThreadDelta = {
  thread_id: string;
  cursor: string;
  events: AssistantThreadDeltaEvent[];
};
```

### Why
This gives you one coherent polling or streaming contract.

---

# 4. Exact database changes in `services/api/app/db/storage.py`

## 4.1 Design choice: additive migration, not destructive migration

I strongly recommend:
- **add new tables**
- keep old tables during the migration
- slowly route old APIs through new run machinery

That is lower risk and easier to debug.

## 4.2 Exact new tables

### 4.2.1 `conversation_runs`

```sql
CREATE TABLE IF NOT EXISTS conversation_runs (
  id TEXT PRIMARY KEY,
  thread_id TEXT NOT NULL,
  triggered_by_message_id TEXT NOT NULL,
  status TEXT NOT NULL,
  orchestrator TEXT NOT NULL,
  provider_used TEXT,
  model TEXT,
  current_interrupt_id TEXT,
  metadata_json TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  finished_at TEXT,
  FOREIGN KEY (thread_id) REFERENCES conversation_threads(id),
  FOREIGN KEY (triggered_by_message_id) REFERENCES conversation_messages(id)
);
CREATE INDEX IF NOT EXISTS idx_conversation_runs_thread_updated
  ON conversation_runs(thread_id, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_conversation_runs_status_created
  ON conversation_runs(status, created_at DESC);
```

### Why this exact table
Because `conversation_tool_traces` is not enough to represent the lifecycle of a whole turn.

---

### 4.2.2 `conversation_message_parts`

```sql
CREATE TABLE IF NOT EXISTS conversation_message_parts (
  id TEXT PRIMARY KEY,
  message_id TEXT NOT NULL,
  part_index INTEGER NOT NULL,
  part_type TEXT NOT NULL,
  payload_json TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (message_id) REFERENCES conversation_messages(id),
  UNIQUE(message_id, part_index)
);
CREATE INDEX IF NOT EXISTS idx_conversation_message_parts_message
  ON conversation_message_parts(message_id, part_index ASC);
CREATE INDEX IF NOT EXISTS idx_conversation_message_parts_type
  ON conversation_message_parts(part_type, created_at DESC);
```

### Why a separate table instead of `parts_json`
Because long-term you will want:
- partial updates
- debugging
- querying by part type
- cleaner message editing
- cleaner delta emission

### If you want a cheaper phase-1 path
You can add:
- `parts_json`
- `status`
- `run_id`
- `updated_at`
to `conversation_messages`

But I would still plan to move to `conversation_message_parts`.

---

### 4.2.3 `conversation_run_steps`

```sql
CREATE TABLE IF NOT EXISTS conversation_run_steps (
  id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL,
  message_id TEXT,
  tool_call_id TEXT NOT NULL,
  tool_name TEXT NOT NULL,
  tool_kind TEXT NOT NULL,
  arguments_json TEXT NOT NULL,
  status TEXT NOT NULL,
  result_json TEXT,
  error_text TEXT,
  backing_endpoint TEXT,
  requires_confirmation INTEGER NOT NULL DEFAULT 0,
  confirmation_state TEXT NOT NULL DEFAULT 'not_required',
  metadata_json TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (run_id) REFERENCES conversation_runs(id),
  FOREIGN KEY (message_id) REFERENCES conversation_messages(id)
);
CREATE INDEX IF NOT EXISTS idx_conversation_run_steps_run
  ON conversation_run_steps(run_id, created_at ASC);
CREATE INDEX IF NOT EXISTS idx_conversation_run_steps_tool_call
  ON conversation_run_steps(tool_call_id);
CREATE INDEX IF NOT EXISTS idx_conversation_run_steps_status
  ON conversation_run_steps(status, updated_at DESC);
```

### Why preserve confirmation fields here
Because the current deterministic planner already encodes confirmation semantics in useful ways.

---

### 4.2.4 `conversation_interrupts`

```sql
CREATE TABLE IF NOT EXISTS conversation_interrupts (
  id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL,
  tool_call_id TEXT NOT NULL,
  tool_name TEXT NOT NULL,
  payload_json TEXT NOT NULL,
  status TEXT NOT NULL,
  submitted_payload_json TEXT,
  metadata_json TEXT NOT NULL,
  created_at TEXT NOT NULL,
  resolved_at TEXT,
  FOREIGN KEY (run_id) REFERENCES conversation_runs(id)
);
CREATE INDEX IF NOT EXISTS idx_conversation_interrupts_run_status
  ON conversation_interrupts(run_id, status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_conversation_interrupts_status
  ON conversation_interrupts(status, created_at DESC);
```

### Why this exact table
Because a panel/interrupt is durable state, not transient frontend state.

---

### 4.2.5 `conversation_surface_events`

```sql
CREATE TABLE IF NOT EXISTS conversation_surface_events (
  id TEXT PRIMARY KEY,
  thread_id TEXT NOT NULL,
  source_surface TEXT NOT NULL,
  kind TEXT NOT NULL,
  entity_ref_json TEXT,
  payload_json TEXT NOT NULL,
  visibility TEXT NOT NULL,
  created_at TEXT NOT NULL,
  FOREIGN KEY (thread_id) REFERENCES conversation_threads(id)
);
CREATE INDEX IF NOT EXISTS idx_conversation_surface_events_thread_created
  ON conversation_surface_events(thread_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_conversation_surface_events_visibility
  ON conversation_surface_events(visibility, created_at DESC);
```

### Why not reuse `domain_events`
Because thread-aware UI/event logic is a different concern than generic system event emission.

---

## 4.3 Exact changes to existing tables

### 4.3.1 `conversation_messages`
Add:
- `status TEXT NOT NULL DEFAULT 'complete'`
- `run_id TEXT`
- `parent_id TEXT`
- `updated_at TEXT`

```sql
ALTER TABLE conversation_messages ADD COLUMN status TEXT NOT NULL DEFAULT 'complete';
ALTER TABLE conversation_messages ADD COLUMN run_id TEXT;
ALTER TABLE conversation_messages ADD COLUMN parent_id TEXT;
ALTER TABLE conversation_messages ADD COLUMN updated_at TEXT;
```

### Why
Even if parts move to their own table, the message itself still needs lifecycle and linkage.

---

# 5. Exact API redesign

## 5.1 Naming decision

I recommend a new namespace:

- `/v1/assistant/...`

not:
- extending only `/v1/conversations/...`

### Why
Because the new protocol is bigger than the current conversation API:
- threads
- runs
- interrupts
- events
- deltas
- streaming

A new namespace makes it easier to migrate cleanly and keep legacy routes stable for a while.

---

## 5.2 Exact endpoints

## 5.2.1 Threads

### `GET /v1/assistant/threads`

Response:
```ts
type ListAssistantThreadsResponse = {
  threads: AssistantThreadSummary[];
  main_thread_id?: string | null;
};
```

Example:
```json
{
  "threads": [
    {
      "id": "thr_primary",
      "slug": "primary",
      "title": "Primary Starlog Thread",
      "mode": "voice_native",
      "latest_message_preview": "I can add that now. I only need when you want it due.",
      "last_updated_at": "2026-04-20T12:20:00Z",
      "archived": false,
      "metadata": {}
    }
  ],
  "main_thread_id": "thr_primary"
}
```

### Why
assistant-ui has thread-list runtime concepts. Give it a real thread list even if Starlog defaults to one.

---

### `POST /v1/assistant/threads`

Request:
```ts
type CreateAssistantThreadRequest = {
  title?: string;
  mode?: string;
  metadata?: Record<string, unknown>;
};
```

Response:
```ts
type CreateAssistantThreadResponse = {
  thread: AssistantThreadSummary;
};
```

---

### `GET /v1/assistant/threads/:thread_id`

Response:
```ts
type GetAssistantThreadResponse = AssistantThreadSnapshot;
```

### Why
This is the hydration object for assistant-ui ExternalStoreRuntime.

---

### `PATCH /v1/assistant/threads/:thread_id`

Request:
```ts
type UpdateAssistantThreadRequest = {
  title?: string;
  archived?: boolean;
  metadata?: Record<string, unknown>;
};
```

---

## 5.2.2 Messages and starting runs

### `POST /v1/assistant/threads/:thread_id/messages`

This is the new primary “send user message” endpoint.

Request:
```ts
type CreateAssistantMessageRequest = {
  content: string;
  input_mode?: "text" | "voice";
  device_target?: string;
  metadata?: Record<string, unknown>;
  ui_context?: {
    active_surface?: "assistant" | "library" | "planner" | "review";
    selected_entities?: AssistantEntityRef[];
    composer_state?: {
      has_draft?: boolean;
      draft_length?: number;
      input_mode?: "text" | "voice";
    };
  };
};
```

Response:
```ts
type CreateAssistantMessageResponse = {
  user_message: AssistantThreadMessage;
  run: AssistantRun;
  assistant_placeholder_message?: AssistantThreadMessage | null;
};
```

Example:
```json
{
  "user_message": {
    "id": "msg_user_1",
    "thread_id": "thr_primary",
    "role": "user",
    "parts": [
      {
        "type": "text",
        "text": "Create a task to review the diffusion paper notes."
      }
    ],
    "status": "complete",
    "metadata": {
      "input_mode": "text",
      "device_target": "web-desktop"
    },
    "created_at": "2026-04-20T12:30:00Z",
    "updated_at": "2026-04-20T12:30:00Z",
    "run_id": null,
    "parent_id": null
  },
  "run": {
    "id": "run_1",
    "thread_id": "thr_primary",
    "triggered_by_message_id": "msg_user_1",
    "status": "running",
    "orchestrator": "hybrid",
    "provider_used": null,
    "model": null,
    "current_interrupt_id": null,
    "metadata": {},
    "created_at": "2026-04-20T12:30:00Z",
    "updated_at": "2026-04-20T12:30:00Z",
    "finished_at": null
  },
  "assistant_placeholder_message": {
    "id": "msg_asst_1",
    "thread_id": "thr_primary",
    "role": "assistant",
    "parts": [],
    "status": "in_progress",
    "metadata": {},
    "created_at": "2026-04-20T12:30:00Z",
    "updated_at": "2026-04-20T12:30:00Z",
    "run_id": "run_1",
    "parent_id": "msg_user_1"
  }
}
```

### Why create a placeholder assistant message
Because assistant-ui naturally handles “in progress” assistant messages and progressive updates.

---

## 5.2.3 Runs

### `GET /v1/assistant/threads/:thread_id/runs/:run_id`

Response:
```ts
type GetAssistantRunResponse = {
  run: AssistantRun;
  steps: AssistantRunStep[];
  open_interrupt?: AssistantInterrupt | null;
};
```

---

### `POST /v1/assistant/runs/:run_id/cancel`

Response:
```ts
type CancelAssistantRunResponse = {
  run: AssistantRun;
};
```

### Why
assistant-ui exposes cancel behavior when the runtime supports it.

---

## 5.2.4 Interrupts

### `POST /v1/assistant/interrupts/:interrupt_id/submit`

Request:
```ts
type SubmitAssistantInterruptRequest = {
  values: Record<string, unknown>;
  metadata?: Record<string, unknown>;
};
```

Response:
```ts
type SubmitAssistantInterruptResponse = {
  interrupt: AssistantInterrupt;
  resumed_run: AssistantRun;
};
```

Example for task due date:
```json
{
  "values": {
    "due_date": "2026-04-21",
    "priority": 3,
    "create_time_block": true
  }
}
```

---

### `POST /v1/assistant/interrupts/:interrupt_id/dismiss`

Response:
```ts
type DismissAssistantInterruptResponse = {
  interrupt: AssistantInterrupt;
  run: AssistantRun;
};
```

### Why
Some interactive prompts should be deferrable, not only submissible.

---

## 5.2.5 Surface events

### `POST /v1/assistant/threads/:thread_id/events`

Request:
```ts
type CreateAssistantSurfaceEventRequest = {
  source_surface:
    | "assistant"
    | "library"
    | "planner"
    | "review"
    | "desktop_helper"
    | "system";
  kind: string;
  entity_ref?: AssistantEntityRef | null;
  payload: Record<string, unknown>;
  visibility?: "internal" | "ambient" | "assistant_message";
};
```

Response:
```ts
type CreateAssistantSurfaceEventResponse = {
  event: AssistantSurfaceEvent;
  projected_message?: AssistantThreadMessage | null;
};
```

### Why allow `projected_message`
Because some events may immediately create:
- an ambient thread row
- or a full assistant response

without waiting for the next user message.

---

## 5.2.6 Updates feed

### `GET /v1/assistant/threads/:thread_id/updates?cursor=...`

Response:
```ts
type GetAssistantThreadUpdatesResponse = AssistantThreadDelta;
```

### Why
This is the clean polling fallback even if you later add SSE.

---

## 5.2.7 Streaming endpoint

### `GET /v1/assistant/threads/:thread_id/stream`

SSE event types:
- `message.created`
- `message.updated`
- `run.created`
- `run.updated`
- `run.step.created`
- `run.step.updated`
- `interrupt.opened`
- `interrupt.resolved`
- `surface_event.created`

### Why choose SSE first
Because for Starlog this is simpler and enough for:
- run lifecycle
- tool lifecycle
- interrupts
- assistant message updates

---

# 6. Exact service-layer refactor

## 6.1 New service map

I recommend introducing these modules:

- `assistant_thread_service.py`
- `assistant_run_service.py`
- `assistant_interrupt_service.py`
- `assistant_event_service.py`
- `assistant_projection_service.py`
- `assistant_delta_service.py`

## 6.2 What each does

### `assistant_thread_service.py`
Responsibilities:
- thread CRUD
- thread snapshot building
- message append
- message part append/update
- message pagination

### Why separate from run service
Because thread storage and run orchestration are different concerns.

---

### `assistant_run_service.py`
Responsibilities:
- start run
- choose orchestrator strategy
- create placeholder assistant message
- execute tool plan
- append/update assistant message parts
- update run and step status
- open interrupts
- finalize/cancel run

### Why this becomes the new center
Because `conversation_service.record_chat_turn()` is too coarse for the target architecture.

---

### `assistant_interrupt_service.py`
Responsibilities:
- create interrupt
- validate submission payload
- persist submission
- dismiss/expire interrupt
- resume run after submission

### Why separate
Because interrupts are not just “part of tool execution”; they are shared, durable UX state.

---

### `assistant_event_service.py`
Responsibilities:
- ingest surface events
- persist surface events
- decide projection mode:
  - internal-only
  - ambient update
  - immediate assistant response

### Why
Because surface events will become a cross-product primitive, not just a conversation hack.

---

### `assistant_projection_service.py`
Responsibilities:
- project domain results into:
  - cards
  - ambient updates
  - attachments
  - text parts
- convert run state into assistant-ui-friendly message parts

### Why refactor from `conversation_card_service.py`
Because card projection is still useful, but no longer sufficient on its own.

---

### `assistant_delta_service.py`
Responsibilities:
- collect state changes since cursor
- format `AssistantThreadDelta`
- feed polling/SSE

### Why
Without a delta service, streaming will sprawl into route handlers.

---

## 6.3 What to do with existing services

### `conversation_service.py`
Short-term:
- keep it
- delegate new work internally to the new services

Long-term:
- shrink it into compatibility helpers and legacy adapters

### `conversation_card_service.py`
Short-term:
- rename later
- start moving logic into `assistant_projection_service.py`

Long-term:
- keep its Starlog-specific domain projection logic, but broaden the outputs

### `agent_command_service.py`
Short-term:
- keep deterministic parsing/planning logic
- expose it as an orchestration strategy

Long-term:
- stop treating it as a special conversation path
- make it feed the unified run model

---

# 7. Exact orchestration redesign

## 7.1 Current state

Today:
- deterministic command execution is special
- LLM chat execution is special
- both produce slightly different storage behavior

## 7.2 Target state

Every new user message should do this:

1. append user message
2. create run
3. append placeholder assistant message
4. build orchestration context
5. choose strategy:
   - deterministic
   - llm_runtime
   - hybrid
6. execute steps
7. open interrupt if needed
8. append result parts/cards/updates
9. finalize run

## 7.3 Exact orchestrator interface

```py
class AssistantOrchestratorResult(TypedDict):
    assistant_parts: list[dict]
    tool_calls: list[dict]
    session_state_patch: dict[str, Any]
    metadata: dict[str, Any]

class AssistantOrchestrator(Protocol):
    def plan_turn(
        self,
        *,
        thread_id: str,
        message_id: str,
        content: str,
        context: dict[str, Any],
    ) -> AssistantOrchestratorResult: ...
```

### Why this shape
Because the planner should not directly mutate storage. It should return a validated plan.

---

## 7.4 Strategies

### Deterministic strategy
Use when:
- `agent_command_service` strongly matches a command pattern

Output:
- tool calls
- optional summary part
- optional fallback card

### LLM strategy
Use when:
- no deterministic match
- general assistant reasoning needed

Output:
- text parts
- optional tool calls
- optional UI tool calls

### Hybrid strategy
Use when:
- deterministic path finds a plausible domain action
- but missing structured input or ambiguity remains

Example:
- “create task review diffusion notes”
- title deterministic
- due date missing
- open `request_due_date` UI tool

### Why hybrid is important
Because it lets Starlog preserve its deterministic strengths while still benefiting from a more flexible orchestrator.

---

# 8. Exact AI runtime contract changes

## 8.1 Current issue

`services/ai-runtime/runtime_app/workflows.py` returns:
- `response_text`
- `cards`
- `session_state`
- metadata

That is too narrow.

## 8.2 New runtime response shape

Replace the chat-turn execution response with something like:

```ts
type RuntimeToolPlan = {
  tool_name: string;
  tool_kind: "domain_tool" | "ui_tool" | "system_tool";
  arguments: Record<string, unknown>;
  rationale?: string;
};

type RuntimeAssistantTurnPlan = {
  workflow: "chat_turn";
  provider_used: string;
  model: string;
  assistant_parts: Array<
    | { type: "text"; text: string }
    | { type: "reasoning_summary"; text: string }
    | { type: "card"; card: AssistantCard }
    | { type: "ambient_update"; update: AssistantAmbientUpdate }
  >;
  tool_calls: RuntimeToolPlan[];
  session_state_patch: Record<string, unknown>;
  metadata: Record<string, unknown>;
};
```

### Why not return `tool_result` parts from runtime
Because the runtime is planning, not executing.
Tool results should come from backend execution.

---

## 8.3 Exact orchestration context passed into runtime

`build_chat_preview_request()` should become a richer builder, e.g. `build_orchestration_context()`.

Recommended context additions:

```ts
type AssistantOrchestrationContext = {
  thread: {
    id: string;
    slug?: string | null;
    mode: string;
    title: string;
  };
  session_state: Record<string, unknown>;
  recent_messages: AssistantThreadMessage[];
  recent_run_steps: AssistantRunStep[];
  open_interrupts: AssistantInterrupt[];
  recent_surface_events: AssistantSurfaceEvent[];
  memory_context: Record<string, unknown>;
  assistant_memory_suggestions: unknown[];
  ui_context: {
    active_surface: "assistant" | "library" | "planner" | "review";
    selected_entities: AssistantEntityRef[];
    device_target: string;
    composer_state?: {
      has_draft: boolean;
      draft_length: number;
      input_mode: "text" | "voice";
    };
  };
  ui_capabilities: {
    navigable_surfaces: Array<{ id: string; label: string; href: string }>;
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
};
```

### Why this exact context
Because the model can only make good UI decisions if it knows:
- what UI tools exist
- what support views exist
- what the user is currently looking at
- whether an interrupt is already open
- what entity is in focus

---

## 8.4 Exact first-wave UI tools

I recommend adding these named tools to the runtime capability manifest immediately:

```ts
type StarlogUIToolName =
  | "request_due_date"
  | "resolve_planner_conflict"
  | "triage_capture"
  | "grade_review_recall"
  | "choose_morning_focus";
```

### Why these first
Because they are:
- small
- structured
- recurring
- clearly better as tool UIs than as plain text

---

# 9. Exact backend tool taxonomy

## 9.1 Domain tools

Keep and formalize:
- `create_task`
- `update_task`
- `list_tasks`
- `create_note`
- `list_notes`
- `capture_text_as_artifact`
- `run_artifact_action`
- `search_starlog`
- `list_due_cards`
- `generate_time_blocks`
- `create_calendar_event`
- `list_calendar_events`
- `generate_briefing`
- `render_briefing_audio`
- `schedule_morning_brief_alarm`

## 9.2 UI tools

Add:
- `request_due_date`
- `resolve_planner_conflict`
- `triage_capture`
- `grade_review_recall`
- `choose_morning_focus`

## 9.3 System tools

Add later if needed:
- `emit_ambient_update`
- `navigate_surface`
- `load_entity_context`
- `suggest_follow_up`

### Why separate system tools
Because some assistant actions are not domain mutations and not user-interrupts either.

---

# 10. Exact request/response schemas for first-wave UI tools

## 10.1 `request_due_date`

### Tool plan emitted by runtime
```json
{
  "tool_name": "request_due_date",
  "tool_kind": "ui_tool",
  "arguments": {
    "task_title": "Review the diffusion paper notes",
    "suggested_priority": 3,
    "allow_time_block_toggle": true
  }
}
```

### Interrupt payload created by backend
```json
{
  "interrupt_type": "form",
  "title": "Finish task details",
  "body": "Give the missing fields so Starlog can create the task without leaving the thread.",
  "fields": [
    {
      "id": "due_date",
      "kind": "date",
      "label": "Due date",
      "required": true
    },
    {
      "id": "priority",
      "kind": "priority",
      "label": "Priority",
      "value": 3,
      "min": 1,
      "max": 5
    },
    {
      "id": "create_time_block",
      "kind": "toggle",
      "label": "Create 45m block",
      "value": false
    }
  ],
  "primary_label": "Create task",
  "secondary_label": "Not now"
}
```

### Why this is a UI tool, not a domain tool
Because the domain mutation is incomplete until the user supplies the missing field.

---

## 10.2 `resolve_planner_conflict`

### Tool arguments
```json
{
  "candidate_title": "Deep Work",
  "candidate_start": "2026-04-21T10:00:00Z",
  "candidate_end": "2026-04-21T11:00:00Z",
  "conflicts": [
    {
      "title": "Team Sync",
      "start": "2026-04-21T10:00:00Z",
      "end": "2026-04-21T10:30:00Z"
    }
  ],
  "options": [
    {
      "id": "move_later",
      "label": "Move Deep Work to 10:30–11:30",
      "value": "move_later"
    },
    {
      "id": "shorten_block",
      "label": "Shorten Deep Work to 10:30–11:00",
      "value": "shorten_block"
    },
    {
      "id": "mark_flexible",
      "label": "Keep both and mark Deep Work flexible",
      "value": "mark_flexible"
    }
  ]
}
```

### Interrupt payload
Use `"choice"`.

### Why
Conflict resolution is structured and local; it should not require a whole planner navigation by default.

---

## 10.3 `triage_capture`

### Tool arguments
```json
{
  "artifact_id": "art_123",
  "title": "Screenshot from desktop helper",
  "suggested_kinds": [
    "research_source",
    "fleeting_note",
    "reference_image"
  ],
  "next_step_options": [
    "summarize",
    "cards",
    "append_note"
  ]
}
```

### Interrupt payload
Use `"form"` with:
- capture kind select
- next step select

### Why
Because this is exactly the kind of small structured interaction cards do poorly.

---

# 11. Exact new routes to add in `services/api/app/api/routes`

Create new file:

- `services/api/app/api/routes/assistant.py`

## 11.1 Route sketch

```py
router = APIRouter(prefix="/assistant")

@router.get("/threads")
def list_threads(...): ...

@router.post("/threads")
def create_thread(...): ...

@router.get("/threads/{thread_id}")
def get_thread(...): ...

@router.patch("/threads/{thread_id}")
def update_thread(...): ...

@router.post("/threads/{thread_id}/messages")
def create_message_and_start_run(...): ...

@router.get("/threads/{thread_id}/runs/{run_id}")
def get_run(...): ...

@router.post("/runs/{run_id}/cancel")
def cancel_run(...): ...

@router.post("/interrupts/{interrupt_id}/submit")
def submit_interrupt(...): ...

@router.post("/interrupts/{interrupt_id}/dismiss")
def dismiss_interrupt(...): ...

@router.post("/threads/{thread_id}/events")
def ingest_surface_event(...): ...

@router.get("/threads/{thread_id}/updates")
def get_thread_updates(...): ...

@router.get("/threads/{thread_id}/stream")
def stream_thread_updates(...): ...
```

### Why one dedicated route file
Because this is a new protocol surface, not a small patch to the current `conversations.py`.

---

# 12. Exact legacy compatibility plan

## 12.1 Keep `POST /v1/conversations/primary/chat` for now

But change its implementation so that internally it:

1. calls the new `/assistant`-style run machinery
2. waits for completion or first interrupt opening
3. materializes the old `ConversationTurnResponse`

### Why
This lets the old UI survive while the new backend is built.

## 12.2 Legacy adapter shape

Build a translator:

```py
def assistant_snapshot_to_legacy_turn(...) -> ConversationTurnResponse:
    ...
```

### Why
This reduces migration risk.

---

# 13. Exact frontend adapter expectations for assistant-ui

Even though this document is backend-focused, the backend contract should match the intended frontend.

## 13.1 Runtime model

Use assistant-ui with:
- custom backend
- server-owned threads
- delta/stream updates
- tool UI registry

## 13.2 Tool UI mapping

The frontend should register tool UIs by `toolName`:
- `request_due_date`
- `resolve_planner_conflict`
- `triage_capture`
- etc.

### Why this matters to backend design
Because the backend only needs to emit:
- `tool_name`
- `tool_call_id`
- `args`
- `status`
- optional interrupt object

not rendered UI.

---

# 14. Exact staged implementation order

## Phase 1 — contracts
Do first:
- add all new contract types
- keep legacy types temporarily
- add adapters

## Phase 2 — storage
Add:
- new tables
- new columns
- migration guards

## Phase 3 — new assistant route namespace
Add:
- `/v1/assistant/...`
- thread snapshot endpoint
- create-message/start-run endpoint
- run endpoint

## Phase 4 — run service
Implement:
- unified run lifecycle
- deterministic + llm + hybrid strategies

## Phase 5 — interrupts
Implement:
- interrupt creation
- submit/dismiss
- resume

## Phase 6 — surface events
Implement:
- event ingestion
- ambient update projection

## Phase 7 — assistant-ui frontend prototype
Then:
- replace existing web thread UI behind a feature flag

---

# 15. Final recommendation in plain language

If I compress the whole decision into one sentence:

> Starlog should stop treating rich assistant UI as “cards attached to text messages” and start treating it as a durable protocol of messages, runs, tool calls, interrupts, and surface events.

That is the exact change that makes assistant-ui a real architectural fit instead of a cosmetic swap.

