# Starlog Spec: Surface Events + Dynamic UI Panels for the Assistant Thread

## Purpose

This spec defines how Starlog should let the `Assistant` remain the single persistent orchestrator while `Library`, `Planner`, `Review`, and the desktop helper continuously feed structured context back into the thread.

It also defines a thread-native concept for dynamic UI popups: small, anchored interaction panels that appear in or near the conversation when the Assistant needs structured user input or when a support surface emits an event that deserves immediate follow-through.

The goal is not to turn Starlog into a general modal-heavy app. The goal is to make the Assistant thread feel like the active command surface for the whole product.

---

# 1. Product fit

## Why this belongs in Starlog

Starlog is already organized around:

- one persistent `Assistant` thread
- `Library`, `Planner`, and `Review` as support surfaces
- inline typed cards with typed actions
- voice and text routing into the same thread
- diagnostics that remain available but visually secondary

This spec extends that model instead of replacing it.

## Product thesis

A user should not have to narrate their own activity back to the Assistant.

If the user:
- captures something
- opens an artifact
- completes a task
- fails a review card
- starts a time block
- hits a planner conflict

then the Assistant should be able to notice that through structured surface events and respond appropriately inside the thread.

## Core principle

The thread remains the center.

Dynamic UI should:
- support the thread
- shorten the path from intent to action
- request missing structured input only when needed
- feel lighter than switching pages

Dynamic UI should not:
- become a second full workspace hidden inside chat
- replace deep editing in `Library`, `Planner`, or `Review`
- become generic modals for every operation

---

# 2. New concepts

## 2.1 Surface Event

A `SurfaceEvent` is a typed record emitted by a Starlog surface or subsystem and projected into Assistant context.

Examples:
- `capture.created`
- `artifact.opened`
- `task.completed`
- `review.answer.graded`
- `planner.conflict.detected`
- `planner.conflict.resolved`
- `planner.conflict.cleared`
- `briefing.played`
- `time_block.started`
- `voice.capture.transcribed`

A surface event is not itself a chat message.
It is an input into the Assistant runtime and optionally into the visible thread timeline.

## 2.2 Ambient Thread Update

An `AmbientThreadUpdate` is a lightweight visible projection of a surface event inside the thread.

It should look smaller than a normal assistant reply.
Think:
- a timestamped activity chip
- a compact timeline row
- a thin system-style event line with an optional follow-up affordance

Examples:
- `Library imported 1 screenshot capture`
- `Planner marked Deep Work block as started`
- `Review session: 3 cards missed in graph theory`

Ambient thread updates keep the thread aware of the user’s world without requiring a full assistant message every time.

## 2.3 Dynamic UI Panel

A `DynamicUIPanel` is a transient, anchored interaction surface attached to an assistant turn, card, or composer state.

Desktop behavior:
- anchored popup / sidecar near the triggering card or composer
- non-blocking when possible
- visually subordinate to the transcript

Mobile behavior:
- bottom sheet
- compact full-width panel
- must preserve thread context behind it

A dynamic UI panel should be used when the Assistant needs:
- one missing field
- a small multi-step clarification
- a ranked choice
- a quick triage action
- a structured confirmation

Examples:
- choose due date and priority for a task
- resolve a scheduling conflict
- triage a new capture
- grade recall after revealing an answer

---

# 3. Design rules

## 3.1 Thread-first hierarchy

The transcript is the primary plane.
Panels are secondary and anchored.
Support surfaces remain the place for deep editing.

## 3.2 Inline first, modal last

Use inline cards or anchored panels before full modals.
Full-screen takeover should be rare and only used when the user is clearly transitioning into a deep-work surface.

## 3.3 Ask only for the minimum missing structure

If the Assistant can infer 80 percent of the intent, it should do so and ask only for the missing 20 percent.

Bad:
- asking the user to restate the whole task in a form

Good:
- `I can create this task now. I only need a due date.`

## 3.4 Every popup should have a clear consequence

The user should know what happens when they submit:
- update task
- create time block
- save note
- reschedule event
- mark review outcome

## 3.5 Panels should degrade gracefully to cards

If a surface cannot render a rich panel, the same interaction should still work as:
- inline card actions
- composer prefill
- navigation to the support surface

## 3.6 Panels are for acceleration, not lock-in

A popup should never become the only path to complete an action.
The user must be able to dismiss it and continue in normal chat.

---

# 4. Proposed contract additions

## 4.1 Surface event contract

```ts
import type { AssistantCardAction, AssistantEntityRef } from "./assistant-card";

export const STARLOG_SURFACE_EVENT_KINDS = [
  "capture.created",
  "capture.enriched",
  "capture.untriaged",
  "artifact.opened",
  "artifact.summarized",
  "task.created",
  "task.completed",
  "task.missed",
  "task.snoozed",
  "commitment.overdue",
  "time_block.started",
  "time_block.completed",
  "planner.conflict.detected",
  "planner.conflict.resolved",
  "planner.conflict.cleared",
  "project.stale",
  "goal.stale",
  "review.session.started",
  "review.answer.revealed",
  "review.answer.graded",
  "review.repeated_failure",
  "briefing.generated",
  "briefing.played",
  "assistant.recommendation.deferred",
  "assistant.card.action_used",
  "assistant.panel.submitted",
  "voice.capture.transcribed",
] as const;

export type StarlogSurfaceKey = "assistant" | "library" | "planner" | "review" | "desktop_helper" | "system";
export type StarlogSurfaceEventKind = (typeof STARLOG_SURFACE_EVENT_KINDS)[number];

export type AssistantSurfaceEvent = {
  id: string;
  thread_id?: string | null;
  source_surface: StarlogSurfaceKey;
  kind: StarlogSurfaceEventKind | string;
  entity_ref?: AssistantEntityRef | null;
  payload: Record<string, unknown>;
  visibility?: "internal" | "ambient" | "assistant_message" | "dynamic_panel";
  projected_message?: boolean;
  created_at: string;
};

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

## 4.2 Ambient update projection

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

This should render as a small thread activity row, not a full assistant bubble.

## 4.3 Dynamic UI panel contract

```ts
export const ASSISTANT_PANEL_KINDS = [
  "choice",
  "form",
  "date_time_picker",
  "entity_picker",
  "conflict_resolver",
  "capture_triage",
  "review_grade",
  "confirm",
] as const;

export type AssistantPanelKind = (typeof ASSISTANT_PANEL_KINDS)[number];

export type AssistantPanelField = {
  id: string;
  label: string;
  field_type: "text" | "textarea" | "select" | "date" | "time" | "datetime" | "toggle" | "priority" | "entity_search";
  required?: boolean;
  placeholder?: string;
  value?: unknown;
  options?: Array<{ label: string; value: string }>;
  metadata?: Record<string, unknown>;
};

export type AssistantDynamicPanel = {
  id: string;
  version: number;
  kind: AssistantPanelKind;
  title: string;
  body?: string | null;
  trigger_message_id?: string | null;
  trigger_card_id?: string | null;
  entity_ref?: AssistantEntityRef | null;
  fields: AssistantPanelField[];
  primary_action: AssistantCardAction;
  secondary_actions?: AssistantCardAction[];
  display: {
    desktop_mode: "anchored_popup" | "sidecar";
    mobile_mode: "bottom_sheet";
    dismissible: boolean;
    width?: "compact" | "medium" | "wide";
  };
  metadata: Record<string, unknown>;
};
```

## 4.4 Assistant thread message extension

Instead of inventing a second message system, add optional panel support to the current thread projection model.

```ts
export type AssistantConversationMessage = {
  id: string;
  thread_id?: string;
  role: "system" | "user" | "assistant" | "tool";
  content: string;
  cards: AssistantCard[];
  panels?: AssistantDynamicPanel[];
  ambient_updates?: AssistantAmbientUpdate[];
  metadata: Record<string, unknown>;
  created_at: string;
};
```

`panels` should usually be ephemeral UI state projected at read time.
They may be persisted if needed for resumability, but the preferred model is:
- persist the intent and resolution
- reconstruct the panel if it is still pending

---

# 5. Runtime behavior

## 5.1 Event ingestion

Any surface may emit a surface event.

Examples:
- Desktop helper creates a screenshot capture -> emits `capture.created`
- Planner drag/reschedule causes overlap -> emits `planner.conflict.detected`
- Review answer revealed and graded -> emits `review.answer.graded`

Recommended pipeline:
1. Surface emits event to API.
2. API stores event in canonical domain-event/event log.
3. AI runtime decides whether to:
   - ignore it
   - add it silently to context
   - project an ambient thread update
   - project an assistant reply with cards
   - project a dynamic panel because immediate structured input is needed

## 5.2 Projection rules

Not every event deserves a visible thread row.

### Internal only
Use when the event only improves context assembly.

Examples:
- `artifact.opened` during browsing
- `assistant.card.action_used`

### Ambient update
Use when the event matters but does not need a full assistant response.

Examples:
- `task.completed`
- `time_block.started`
- `capture.created`

### Assistant reply with cards
Use when the event deserves interpretation or next-step guidance.

Examples:
- several related captures suggest a new note or digest
- repeated review misses suggest a focused session
- planner conflict implies a concrete tradeoff

### Assistant reply with dynamic panel
Use when a quick structured decision would unlock progress.

Examples:
- task creation missing due date
- planner conflict needing user choice
- capture triage needing artifact type or next step

## 5.3 Resolution loop

A dynamic panel resolves through one of these paths:

- submit -> mutation endpoint -> assistant confirms with small result card
- dismiss -> thread continues normally, optionally with a reusable card action
- navigate -> user opens support surface for deeper work

After resolution, emit:
- `assistant.panel.submitted`
- plus the domain mutation event if something changed

---

# 6. UI behavior specification

## 6.1 Desktop rendering

### Ambient updates
Render as compact timeline rows between normal messages.
Visual weight should be lower than a normal assistant bubble.

Suggested shape:

```text
[10:32] Library imported 1 screenshot capture · Open in Library · Ask Assistant
```

### Dynamic panels
Render anchored to the triggering message/card.
Preferred placements:
- below the triggering card
- right-side sidecar attached to the triggering bubble
- above the composer when the panel is composer-related

The panel should feel like part of the thread, not a separate window.

### Panel dismissal
Dismissal options:
- explicit close
- submit
- navigate away from the triggering entity

Dismissal should not remove the underlying assistant reply or card.

## 6.2 Mobile rendering

Dynamic panels should open as bottom sheets.
The transcript remains visible behind the sheet header or through the partially expanded state.

Preferred behavior:
- half-height default
- full-height only when there are multiple fields or search
- close returns the user to the same scroll position in the thread

## 6.3 Voice compatibility

If a voice turn triggers a dynamic panel:
- the assistant speaks a short explanation
- the same question appears visually as a panel
- the user may answer by tapping or by voice

Example:
- spoken: `I can schedule that. I just need a start time.`
- visible: time picker bottom sheet / anchored popup

---

# 7. Scenario concepts

## Scenario A: Capture triage from desktop helper

### Trigger
The desktop helper uploads a screenshot and emits:
- `capture.created`

### Assistant response shape
1. ambient update row
2. optional compact assistant card
3. capture triage panel only if classification is uncertain or next action matters

### Thread concept

```text
You
[uploaded screenshot from desktop helper]

[Ambient update]
Desktop helper imported 1 screenshot capture

Assistant
I saved this as a new capture. It looks like a paper figure plus surrounding notes.

[Capture item card]
Latest capture
- Screenshot from desktop helper
- Extracted text available
Actions: Summarize | Make cards | Append to note | Open in Library

[Optional dynamic panel if uncertain]
┌ Triage this capture ─────────────────────┐
| What should Starlog treat this as?       |
| ( ) research source                      |
| ( ) fleeting note                        |
| ( ) reference image                      |
|                                           |
| Next step                                |
| [Summarize first ▼]                       |
|                           [Save choice]  |
└───────────────────────────────────────────┘
```

### Why this matters
The Assistant is immediately aware of intake, but only asks for structured input if it would improve downstream behavior.

---

## Scenario B: User asks to create a task, but due date is missing

### User input
`Create a task to review the diffusion paper notes`

### Assistant inference
The intent is clear enough to create the task draft.
The only missing structured field is timing.

### Response shape
1. assistant confirms intent in natural language
2. task draft card appears
3. due date panel opens anchored under the card

### Thread concept

```text
You
Create a task to review the diffusion paper notes

Assistant
I can add that now. I only need when you want it due.

[Task card]
Review the diffusion paper notes
Status: draft
Priority: suggested medium

[Anchored panel]
┌ Finish task details ─────────────────────┐
| Due date        [Tomorrow ▼]             |
| Priority        [3 ▢▢▢▢]                 |
| Optional block   [Create 45m block ☐]    |
|                   [Create task]          |
└──────────────────────────────────────────┘
```

### Submit result
- mutation creates task
- emits `task.created`
- assistant shows compact success card with `Open in Planner`

### Key rule
Do not ask the user to restate the task inside the popup.

---

## Scenario C: Planner conflict resolution

### Trigger
The user or assistant tries to place a block that overlaps an existing block.
Surface emits:
- `planner.conflict.detected`
- `planner.conflict.resolved` after a direct Planner resolution
- `planner.conflict.cleared` when replay shows the conflict no longer needs action

### Response shape
1. ambient update or assistant warning
2. conflict resolver panel
3. resolution creates planner mutation and confirmation row

### Thread concept

```text
[Ambient update]
Planner found a conflict for Deep Work at 10:00

Assistant
`Deep Work` overlaps with `Team Sync` from 10:00 to 10:30.

[Conflict resolver panel]
┌ Resolve scheduling conflict ──────────────────────┐
| New block: Deep Work 10:00–11:00                  |
| Conflicts with: Team Sync 10:00–10:30             |
|                                                   |
| ( ) Move Deep Work to 10:30–11:30                 |
| ( ) Shorten Deep Work to 10:30–11:00              |
| ( ) Keep both and mark Deep Work flexible         |
| ( ) Open Planner                                  |
|                                    [Apply choice] |
└───────────────────────────────────────────────────┘
```

### Important detail
Conflict resolution is a perfect use case for a popup because the decision is structured and local.
This should not require a whole planner navigation unless the user chooses it.

---

## Scenario D: Review card answer reveal and grading

### Trigger
The user reveals an answer in `Review`, then grades recall.
Events:
- `review.answer.revealed`
- `review.answer.graded`

### Response shape
Inside Review, the grading UI remains primary.
Inside Assistant, the thread gets:
- ambient updates for session progress
- occasional assistant nudges when patterns matter

### Thread concept

```text
[Ambient update]
Review session: 2 cards missed in diffusion models

Assistant
You are missing the same cluster twice: score matching vs flow matching.

[Review queue card]
Suggested focused review
- 4 cards from diffusion foundations
Actions: Start focused session | Make comparison note | Remind later

[Optional review grade panel if launched from Assistant]
┌ Grade recall ─────────────────────────────┐
| How well did you recover this?            |
| [Again] [Hard] [Good] [Easy]              |
└───────────────────────────────────────────┘
```

### Key idea
Review remains a dedicated surface, but the Assistant can notice patterns and turn them into next actions.

---

## Scenario E: Morning briefing with lightweight action panel

### Trigger
User opens Assistant in the morning or taps a notification.
Event:
- `briefing.generated`

### Response shape
1. assistant briefing message
2. briefing card
3. one-tap focus panel with today’s options

### Thread concept

```text
Assistant
Here is your morning briefing.

[Briefing card]
- 2 important tasks due
- 1 review queue needs attention
- 1 research capture from last night is unprocessed
Actions: Play briefing | Open Planner | Start review

[Dynamic panel]
┌ Start with one thing ─────────────────────┐
| Choose today’s first move                 |
| ( ) 30m review queue                      |
| ( ) Process latest capture                |
| ( ) Start deep work block                 |
|                           [Begin]         |
└───────────────────────────────────────────┘
```

This is especially aligned with Starlog’s role as a follow-through engine.

---

# 8. Interaction patterns to standardize

## 8.1 Panel trigger styles

There are three allowed trigger styles:

### A. Auto-open panel
Use only when the thread would otherwise stall.
Examples:
- missing due date
- unresolved planner conflict

### B. Open from card action
Use when the action is optional.
Examples:
- `Triage capture`
- `Refine task`
- `Choose review focus`

### C. Open from composer state
Use when the current draft naturally implies a structured helper.
Examples:
- typed date phrase opens inline scheduling picker
- voice turn with ambiguous time opens time picker

## 8.2 Panel completion styles

### Submit and stay in thread
Default.
Best for small mutations.

### Submit then navigate
Use when the result is best inspected in a support surface.
Example:
- planner resolution then open planner

### Defer
Creates a reminder/suggestion card instead of forcing resolution now.

## 8.3 Panel copy rules

Panel titles should be action-oriented:
- `Finish task details`
- `Resolve scheduling conflict`
- `Triage this capture`

Panel body copy should explain why the panel exists in one sentence.

Primary action labels should be concrete:
- `Create task`
- `Apply choice`
- `Save choice`
- `Start session`

Avoid vague labels like:
- `Continue`
- `OK`
- `Submit`

---

# 9. Message and projection rules

## 9.1 When to show an ambient update only

Use only if:
- the event is self-explanatory
- there is no meaningful inference to add
- the user does not need to decide anything right now

Examples:
- `Task completed`
- `Briefing played`
- `Capture saved`

## 9.2 When to upgrade to an assistant reply

Upgrade when:
- multiple events form a pattern
- the event implies a recommendation
- the event changes what the user should do next

Examples:
- several missed review cards on the same concept
- several related captures that deserve synthesis
- repeated planner drift this week

## 9.3 When to attach a dynamic panel

Attach only if the missing user input is:
- small
- structured
- locally resolvable
- useful immediately

Avoid panels for open-ended thinking tasks.
Those belong in the main thread.

---

# 10. Suggested implementation plan

## Phase 1: contracts and event ingestion

1. Add `AssistantSurfaceEvent` contract in `@starlog/contracts`
2. Add API endpoint for event ingestion
3. Map helper, Library, Planner, Review, and Assistant actions to event emission
4. Store events in canonical event log

## Phase 2: ambient update projection

1. Add ambient update rendering in `MainRoomThread`
2. Project selected event kinds into compact timeline rows
3. Keep them visually lighter than assistant bubbles

## Phase 3: dynamic panel contract and renderer

1. Add `AssistantDynamicPanel` contract
2. Add desktop anchored popup renderer
3. Add mobile bottom sheet renderer
4. Support field types: select, date, datetime, priority, toggle, entity search

## Phase 4: first three use cases

Implement first:
1. task missing due date
2. planner conflict resolution
3. capture triage from helper/library

## Phase 5: review and briefing integrations

Implement:
1. review grading / focused session prompts
2. morning briefing start-choice panel

---

# 11. Minimal API sketch

## POST `/v1/conversations/primary/events`

Ingest a surface event.

Request:
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

## POST `/v1/conversations/primary/panels/:panel_id/submit`

Resolve a dynamic panel.

Request:
```json
{
  "values": {
    "due_date": "2026-04-21",
    "priority": "3",
    "create_time_block": true
  }
}
```

Response:
- updated thread projection
- emitted domain mutation event
- panel resolution metadata

---

# 12. Rendering concept summary

## Good thread feel

The user should feel:
- the thread knows what is happening across the product
- the thread can help immediately without forcing surface switches
- structured decisions are fast
- deep work still belongs in the support views

## Bad thread feel

The user should not feel:
- bombarded by modals
- trapped inside chat UI that imitates a full app poorly
- forced to re-enter information the system already knows
- exposed to internal tool/runtime details in the main flow

---

# 13. Canonical examples of what to build first

If only three things ship from this spec, ship these:

1. `SurfaceEvent` ingestion from helper, Planner, Review, and Library
2. Ambient update rows in the Assistant thread
3. Dynamic panels for:
   - task missing due date
   - planner conflict resolution
   - capture triage

Those three changes would materially strengthen Starlog’s identity as a thread-first Life OS.
