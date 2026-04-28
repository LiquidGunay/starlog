## First thoughts

These mockups are directionally very strong. They finally make Starlog feel like a **Life OS**, not just “notes + chat + calendar.” The strongest idea is that the Assistant is the default control plane, while Library, Planner, and Review are specialized surfaces it can hand off to.

The biggest risk is **dashboard sprawl**. Several screens are visually beautiful but dense. The product will work best if the rule is:

> The Assistant decides what matters now.
> The other surfaces explain, execute, or inspect that decision.

A few canonical decisions I would lock in:

1. **Assistant is the home surface.** Do not make “Today” a nav item. “Today / Morning / Focus / Briefing ready” can be state chips inside Assistant.
2. **Dynamic panels should be schema-driven, not bespoke UI.** The existing contracts already support assistant cards, actions, and interrupt-like structured input, so panels should be rendered from data rather than hand-built one-off components. The current contract has card kinds such as `review_queue`, `task_list`, `knowledge_note`, `capture_item`, and `learning_drill`, with action kinds like `navigate`, `mutation`, `composer`, and `interrupt`.
3. **Library needs sharper terminology.** Captures, artifacts, notes, and review items must be visibly different. Otherwise the Library will feel like another generic file manager.
4. **Review is the most differentiated surface.** The learning ladder is the strongest “not just flashcards” signal. It should be made more central.
5. **Right rails should be consistent but not repetitive.** “Now,” “Open loops,” “Current context,” and “Suggestions” are good primitives, but each surface should only show the rails that are actually useful.

Current implementation-wise, this maps well onto the repo’s shape: the app is already a pnpm monorepo, with `apps/web` using Next 15, React 18, `@assistant-ui/react`, and shared `@starlog/contracts`.

---

# Starlog UI Surface Specification

## Shared product model

Before implementing the individual screens, define these as first-class concepts:

```md
Capture
Raw incoming item from a source: screenshot, article, PDF, email, note, audio, web clip.

Artifact
A processed output generated from one or more captures: summary, card set, task list, highlights, extracted concepts.

Note
A durable user-facing knowledge object. May be manually written, imported, or generated from artifacts.

Project
A workstream or life area that captures, tasks, notes, review items, and plans can link to.

Task
A concrete action with status, priority, due date, estimate, project link, and optional scheduled block.

ReviewItem
A learning object generated from notes/artifacts/projects. Has a ladder stage: Recall, Understanding, Application, Synthesis, Judgment.

Source / Provenance
The origin trail: source app, URL/file, capture method, timestamp, raw/normalized/extracted layers, linked outputs.

AssistantCard
A structured assistant message part with actions.

AssistantInterrupt / DynamicPanel
A structured inline panel asking for missing information or confirmation.
```

The existing contracts already distinguish artifact actions such as `summarize`, `cards`, `tasks`, and `append_note`, and have capture layers for raw, normalized, and extracted content. That should become the backbone of the Library UX.

---

# 1. Assistant — main home / cockpit screen

## Purpose

The Assistant cockpit answers:

```md
What should I do now?
Why that?
What can I do quickly?
What needs attention?
What context is Starlog using?
```

This is not “Today.” It is the default Assistant state.

## Canonical header

```md
Starlog Assistant
[Morning] [Focus] [Synced] [Briefing ready]
```

Use state chips, not a separate nav item.

## Layout

```md
Left nav
- Assistant
- Library
- Planner
- Review
- Search
- Settings

Main column
- Recommended next move hero
- Reason stack: why this recommendation
- Primary actions
- At a glance table
- Quick action row
- Assistant composer

Right rail
- Now
- Needs attention / open loops
- Current context
- Suggestions
```

## Main hero behavior

The hero should contain exactly one recommended action.

Example:

```md
Recommended next move
Finish onboarding flow polish

Why:
- You are already in motion
- This unlocks launch
- A 90-minute focus block is available now

Primary CTA:
Start focus

Secondary:
Adjust plan
Show other options
```

The Assistant should not show five equal-priority choices here. The product promise is prioritization.

## Implementation

```md
Route
/apps/web/app/assistant/page.tsx

Primary components
- AssistantShell
- AssistantCockpit
- RecommendedNextMoveCard
- ReasonStack
- AtAGlancePanel
- QuickActionsRow
- AssistantComposer
- RightContextRail

Data sources
- assistant thread snapshot
- planner summary
- review queue summary
- capture inbox summary
- active focus block
- current context state

State
- empty/default Assistant state renders cockpit
- active conversation state renders thread
- cockpit may still show latest assistant recommendation from the primary thread
```

## Key rule

The cockpit should be generated from the same underlying recommendation engine that powers chat. Do not make it a separate dashboard with hardcoded stats.

---

# 2. Assistant — normal thread screen

## Purpose

This screen proves Starlog is **assistant-first**.

It should show a real conversation, with cards and ambient system updates inside the thread.

## Layout

```md
Main column
- User message
- Assistant reply
- Inline assistant cards
- Ambient update rows
- Tool activity summary
- Handoff cards
- Composer

Right rail
- Now
- Open loops
- Context
- Suggestions
```

## Required thread elements

```md
User message
"Help me plan my afternoon around the onboarding work and review queue."

Assistant reply
Clear prose plan with reasoning.

Suggested next step card
Start focus block / Adjust plan / Open Planner.

Ambient row
"Planner started Deep Work block."

Surface handoff card
"From Planner: Today’s plan..."

Compact tool activity
"What I checked:
- Checked Planner
- Reviewed due items
- Scanned open loops"
```

## Implementation

```md
Primary components
- AssistantThreadView
- ThreadMessage
- AssistantMessageBubble
- UserMessageBubble
- AssistantCardRenderer
- AmbientEventRow
- ToolActivityStrip
- HandoffCard
- AssistantComposer
- RightContextRail

Message parts
- text
- card
- tool activity
- surface event
- interrupt request / dynamic panel

Behavior
- User messages remain visually distinct.
- Assistant replies may contain text plus structured cards.
- Tool activity should be collapsed by default.
- Ambient rows are not assistant messages; they are system events inserted into the timeline.
```

The current Assistant page already appears to handle thread snapshots, runs, interrupts, streaming updates, card actions, and interrupt submission, so the thread screen should build on that rather than becoming a separate static surface.

## Important UX rule

The Assistant reply should always include a **decision or recommendation**, not just a summary. Starlog should say “do this next” when it has enough context.

---

# 3. Assistant — dynamic panels board A

## Purpose

This is not a production route. It is a design board / Storybook-style reference showing the product grammar for structured assistant input.

Include:

```md
1. Task missing due date
2. Capture triage
3. Planner conflict resolution
4. Optional: quick entity picker / link to project
```

## Product grammar

All dynamic panels should share:

```md
- compact title
- why this is being asked
- structured controls
- recommended defaults
- consequence preview
- primary action
- dismiss/defer action
```

## Panel A.1 — task missing due date

```md
Trigger
Assistant creates or finds a task that cannot be scheduled because it lacks due date / priority.

Fields
- due date: Today / Tomorrow / Pick date
- priority: High / Medium / Low
- optional toggle: Create focus block

Primary action
Create task

Secondary
Cancel / Not now

Consequence preview
"Adds this task to today’s plan and reserves 45 minutes if enabled."
```

## Panel A.2 — capture triage

```md
Trigger
New capture arrives and needs classification.

Fields
- classify as: Reference / Idea / Task / Review material / Project input
- next action: Summarize / Make cards / Create task / Append to note / Archive
- tags
- linked project

Primary action
Summarize and save

Consequence preview
"I’ll summarize this, extract key points, and create a note in your Ideas library."
```

## Panel A.3 — planner conflict resolution

```md
Trigger
A scheduled focus block conflicts with a calendar event.

Fields
- conflict visualization: left event, conflict marker, right event
- options:
  - Move deep work
  - Shorten deep work
  - Keep both
  - Open Planner

Primary action
Apply choice

Consequence preview
"Moves the focus block to the next available 90-minute slot."
```

## Panel A.4 — entity picker / link to project

```md
Trigger
A capture, note, task, or review item appears related to a project.

Fields
- search projects
- suggested projects
- create new project
- confidence / reason

Primary action
Link item

Consequence preview
"Links this capture to Onboarding Revamp and makes it available in project context."
```

## Implementation

```md
Component
DynamicPanelRenderer

Input
AssistantInterrupt

Renderer chooses by:
- tool_name
- interrupt_type
- fields
- display_mode
- metadata.variant

Supported modes
- inline
- composer
- sidecar
- bottom_sheet

Base field components
- TextField
- TextAreaField
- SelectField
- DateField
- TimeField
- PriorityField
- ToggleField
- EntitySearchField
```

This fits the existing interrupt contract well: it already supports field kinds such as `text`, `textarea`, `select`, `date`, `time`, `datetime`, `toggle`, `priority`, and `entity_search`, plus display modes like `inline`, `composer`, `sidecar`, and `bottom_sheet`.

---

# 4. Assistant — dynamic panels board B

## Purpose

This board proves that Starlog can stay lightweight while still being proactive.

Include:

```md
1. Morning focus chooser
2. Review grade panel
3. Short clarification panel
4. Defer / remind later panel
```

## Panel B.1 — morning focus chooser

```md
Trigger
User asks "What should I focus on?" or opens Assistant in the morning.

Options
- Move project forward
- Clear system friction
- Maintain learning

Each option includes:
- one-line outcome
- why Starlog recommends it
- expected time block

Primary action
Confirm focus

Consequence preview
"I’ll shape your plan around this and protect the first focus block."
```

## Panel B.2 — review grade panel

```md
Trigger
User answers a recall or understanding review item in the Assistant thread.

Grades
- Again
- Hard
- Good
- Easy

Support actions
- Show worked example
- Switch to explanation
- Flag question

Feedback line
"You are missing application, not recall."
```

## Panel B.3 — clarification panel

```md
Trigger
Assistant has enough context to proceed but needs one missing parameter.

Example
"What time should I schedule this?"

Options
- 9:30 AM
- 10:00 AM
- 10:30 AM
- 11:00 AM
- Pick custom time

Primary action
Confirm time

Rule
Ask for only one missing decision at a time.
```

## Panel B.4 — defer / remind later panel

```md
Trigger
User dismisses a recommendation, or Assistant detects a useful loop but not urgent enough.

Options
- In 1 hour
- This evening
- Tomorrow morning
- No thanks, keep it in view

Primary action
Set reminder / Defer

Consequence preview
"I’ll bring this back when it is more actionable."
```

## Implementation

```md
These are also DynamicPanelRenderer variants.

Do not create separate React components for every scenario unless the visual structure truly differs.

Suggested mapping:
- choose_morning_focus -> ChoicePanel
- grade_review_recall -> GradePanel
- request_clarification -> FormPanel
- defer_recommendation -> DeferPanel
```

## UX rule

Dynamic panels should feel like **the Assistant temporarily became a tiny app**, not like a modal dialog.

---

# 5. Library — main surface

## Purpose

The Library answers:

```md
What have I captured?
What has been processed?
What still needs attention?
Where did this come from?
How is it connected to my projects, notes, and review queue?
```

## Layout

```md
Header
- Starlog Library
- sync state
- optional global filters/search

Top stats
- Unprocessed captures
- Recent artifacts
- Notes & saved items
- Linked to projects

Main sections
- Inbox / Unprocessed captures
- Recent artifacts
- Notes & saved items

Right rail
- Inbox breakdown
- Recent sources
- Current context
- Suggestions
```

## Required item metadata

Every Library row should show:

```md
- title
- source
- capture type
- timestamp
- processing state
- linked project/note count
- suggested actions
```

Example action set:

```md
Summarize
Make cards
Create task
Append to note
Link to project
Archive
```

## Canonical statuses

```md
Capture status
- unprocessed
- needs_decision
- ready_to_process
- processing
- processed
- archived
- failed

Artifact status
- generated
- user_edited
- linked
- stale
- archived
```

## Implementation

```md
Route
/library

Current compatibility
If the app currently has /notes as the Library route, keep /notes as a redirect or alias, but the product-facing nav label should be Library.

Primary components
- LibraryShell
- LibraryStatsBar
- CaptureInboxList
- CaptureRow
- RecentArtifactsStrip
- ArtifactCard
- NotesList
- SourceBreakdownRail
- LibrarySuggestionRail

Data sources
- GET captures with filters
- GET artifacts
- GET notes
- GET projects
- GET source breakdown
- GET suggested library actions
```

## Key UX rule

The Library should not feel like storage. It should feel like an **ingestion and conversion pipeline**:

```md
capture -> classify -> process -> link -> review/use
```

---

# 6. Library — artifact detail / capture processing board

## Purpose

This screen explains one captured item deeply.

It should answer:

```md
What is this?
Where did it come from?
What did Starlog extract?
What can I turn it into?
Where is it connected?
What has already happened to it?
```

## Layout

```md
Top
- breadcrumb: All captures / Article: The Focus Fallacy
- open in source
- more menu

Main area
- Artifact detail
- Quick capture / source preview
- Source & provenance

Lower area
- Conversion & enrichment actions
- Auto-extracted highlights
- Activity & timeline
```

## Artifact detail panel

```md
Shows
- title
- type icon
- source
- captured timestamp
- file/source URL
- tags
- summary
- key ideas

Actions
- Summarize
- Make cards
- Create task
- Append to note
```

## Quick capture panel

```md
Shows
- screenshot/PDF/article preview
- optional quick note
- classify capture
- add tags
- save to Library
- create task from this
```

## Provenance panel

```md
Shows
- source app
- URL/file
- capture method
- capture time
- captured by
- location/device if available
- raw/normalized/extracted layers
- linked project
- linked notes
- used in tasks/review
```

## Conversion actions

```md
Summarize
Generate concise summary with key points.

Make cards
Create atomic review items.

Create task
Turn insight into actionable task.

Append to note
Add this artifact to existing note.

Extract highlights
Find and save key quotes/passages.
```

## Implementation

```md
Routes
/library/captures/[captureId]
/library/artifacts/[artifactId]

Primary components
- LibraryDetailShell
- ArtifactDetailCard
- CapturePreviewCard
- ProvenanceCard
- ConversionActionGrid
- ExtractedHighlightsPanel
- ConnectionsPanel
- ActivityTimeline

Important data
- capture.raw
- capture.normalized
- capture.extracted
- artifact versions
- summary versions
- card set versions
- action runs
- relations
- activity events
```

## Key UX rule

Never show generated summaries without provenance. Starlog’s value comes from trustworthy transformation, not opaque AI output.

---

# 7. Planner — main surface

## Purpose

The Planner answers:

```md
What am I doing today?
What is fixed?
What is flexible?
Where are the conflicts?
What should be protected?
How do I recover when the plan slips?
```

## Layout

```md
Header
- Starlog Planner
- date selector
- Plan day
- Add block

Top summary
- focus time
- meetings
- tasks
- buffer

Main split
- left: day timeline
- center/right: today's plan list

Right rail
- Today progress
- Upcoming
- Needs reschedule
- Current context
- Suggestions

Bottom
- Assistant composer / planning prompt box
```

## Timeline semantics

Use distinct visual treatment for:

```md
Commitments
External calendar events or hard obligations.

Focus blocks
Protected work blocks generated by Starlog or user.

Flexible tasks
Unscheduled work that can be placed into available blocks.

Buffer
Recovery time, admin time, transitions.

Conflicts
Overlaps or impossible plans.
```

## Plan list grouping

```md
Scheduled commitments
- meetings
- meals
- locked time

Flexible tasks
- sortable by priority, estimate, project, deadline

Done
- completed items
```

## Conflict behavior

A conflict card should include:

```md
- affected time range
- conflicting items
- severity
- suggested repair
- one-click reschedule
```

## Implementation

```md
Route
/planner

Primary components
- PlannerShell
- DateStrip
- DayMetricsBar
- DayTimeline
- TimeBlockCard
- PlanAgendaList
- FlexibleTaskList
- ConflictCard
- ReschedulePanel
- PlannerAssistantComposer
- PlannerRightRail

Data objects
- Task
- TimeBlock
- CalendarEvent
- Conflict
- PlanningSuggestion
- FocusBlock
```

## Assistant relationship

The Planner should not replace Assistant. It should expose planning state and let Assistant operate on it.

Examples:

```md
User in Assistant:
"Protect 2h deep work today."

Assistant:
Creates/updates Planner blocks.

User in Planner:
"Plan my day."

Planner:
Opens Assistant composer with planner context attached.
```

## Key UX rule

Planner is not a calendar clone. It is an execution optimizer.

---

# 8. Review — main surface

## Purpose

Review answers:

```md
What should I revisit?
At what depth?
Why now?
Where did this come from?
How does this connect to my real projects?
```

This is the strongest signal that Starlog is more than spaced repetition.

## Layout

```md
Header
- Starlog Review
- Today / All due / Upcoming / Mastered / Insights
- Review settings

Left
- Learning ladder

Center
- active review item
- answer choices or open response
- confidence / grade
- explanation
- source trace
- why this now

Right rail
- knowledge health
- queue ladder
- session progress
```

## Learning ladder

```md
Recall
Remember facts.

Understanding
Explain and connect.

Application
Apply to new situations.

Synthesis
Combine and create.

Judgment
Evaluate and decide.
```

The ladder should not just be decorative. It should affect queueing, prompts, grading, and insights.

## Review item anatomy

```md
Stage
Application

Prompt
"Your team’s onboarding flow has a 62% drop-off..."

Answer format
- multiple choice
- free response
- scenario answer
- compare/contrast
- worked example
- project reflection

Grading
- Again
- Hard
- Good
- Easy

Support
- Show explanation
- Show worked solution
- Flag question
- View in context

Trace
- source note/artifact
- project link
- reason this was chosen
```

## Scheduling logic

```md
Recall
Use normal spaced repetition.

Understanding
Use explanation quality and confusion markers.

Application
Use scenario performance and transfer failures.

Synthesis
Use project relevance and recency.

Judgment
Use decision quality, uncertainty, and importance.
```

## Implementation

```md
Route
/review

Primary components
- ReviewShell
- LearningLadderSidebar
- ReviewSessionCard
- ReviewChoiceList
- ReviewGradeBar
- ExplanationPanel
- SourceTraceCard
- WhyThisNowCard
- QueueHealthRail
- SessionProgressRail

Data objects
- ReviewItem
- ReviewAttempt
- ReviewSchedule
- SourceRef
- ProjectContext
- KnowledgeHealthSummary
```

## Key UX rule

The user should feel:

```md
"I am training judgment and transfer, not just memorizing."
```

The “Why this now?” card is essential. It connects review to execution.

---

# Shared implementation primitives

## 1. App shell

```md
AppShell
- left navigation
- surface header
- main content slot
- optional right rail
- sync/account status
```

Use across all four surfaces.

## 2. Right rail

```md
RightRail
Sections:
- Now
- Open loops / Needs attention
- Current context
- Suggestions
- Surface-specific health/progress
```

Each rail section should have:

```md
- title
- 1–4 items max
- one clear CTA
- click-through to source surface
```

## 3. Assistant cards

```md
AssistantCardRenderer
Renders:
- briefing
- task_list
- review_queue
- capture_item
- knowledge_note
- project_status
- goal_status
- learning_drill
- tool_step
```

Actions map to:

```md
navigate
mutation
composer
interrupt
```

This matches the existing assistant card contract.

## 4. Dynamic panels

```md
DynamicPanelRenderer
Renders AssistantInterrupt objects.

Variants:
- ChoicePanel
- FormPanel
- ConfirmPanel
- GradePanel
- DeferPanel
- EntityPickerPanel
```

Do not scatter bespoke one-off panels through the app.

## 5. Provenance chip

Every AI-generated object should support:

```md
Source
Captured at
Generated from
Linked project
Open original
View extraction
View activity
```

## 6. Action grammar

Use the same verbs everywhere:

```md
Capture
Summarize
Make cards
Create task
Append to note
Link to project
Plan
Review
Archive
Defer
```

Avoid having one surface say “Make cards” and another say “Generate flashcards.” Starlog’s language should be consistent.

---

# Recommended implementation order

## Phase 1 — lock the design system

```md
- AppShell
- SurfaceHeader
- RightRail
- Card
- Button
- Badge
- ActionBar
- Composer
- DynamicPanelRenderer skeleton
```

## Phase 2 — make Assistant real

```md
- Assistant cockpit
- Assistant thread
- Card renderer
- Tool activity strip
- Dynamic panels A/B using mocked data
```

## Phase 3 — Library pipeline

```md
- Library main
- Capture inbox
- Artifact detail
- Provenance
- Conversion actions
```

## Phase 4 — Planner execution loop

```md
- Day timeline
- Task agenda
- Focus blocks
- Conflict resolution
- Assistant handoff
```

## Phase 5 — Review ladder

```md
- Ladder queue
- Review session
- Source trace
- Why this now
- Knowledge health
```

The highest-leverage near-term move is to implement the **Assistant thread + dynamic panel renderer** first. That gives Starlog its distinctive interaction model; the other surfaces can then become richer targets that the Assistant reads from and writes to.
