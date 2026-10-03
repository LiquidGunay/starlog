
---

# Starlog Mobile UI Specification

## Mobile UX principle

```md
Mobile Starlog should not compress the desktop dashboard.

Desktop:
- broad situational awareness
- multiple panels visible at once
- side rails
- dense comparison

Mobile:
- one active decision at a time
- chat-first interaction
- progressive disclosure
- dynamic panels inline in the thread
- bottom sheets for overflow
- compact cards, not dashboards
```

The default mobile interaction should be:

```md
Assistant message
→ short reasoning
→ one inline dynamic panel
→ one clear action
→ optional handoff to Library / Planner / Review
```

---

# 1. Assistant Mobile — clean morning focus chat

## Purpose

This screen answers:

```md
What should I focus on right now?
Why?
Can Starlog turn that decision into a plan?
```

This should replace the earlier dense Assistant cockpit on mobile.

## Layout

```md
Header
- Starlog Assistant
- Synced just now
- Profile avatar

Context chips
- Morning
- Deep work window

Thread
- User message
- Assistant reply
- Inline dynamic focus chooser
- Tiny ambient planning row

Bottom
- Composer
- Suggested prompts
- Bottom nav
```

## Example content

```md
User:
What should I focus on this morning?

Assistant:
Here’s what makes the most sense this morning.

- You have a 90m deep work window.
- Finishing onboarding flow polish moves a live project forward.
- You can clear captures later without breaking momentum.

Let’s choose a focus and I’ll shape the block.
```

## Dynamic panel: Choose morning focus

```md
Title:
Choose morning focus

Options:
1. Move project forward
   Make visible progress on a priority project.

2. Clear system friction
   Reduce blockers and context switching.

3. Maintain learning
   Review or practice important material.

Recommended selected option:
Move project forward

Why these?
- You have a focused 90m window.
- Finishing onboarding polish ships real value.
- Clearing captures can wait.

Primary action:
Confirm focus

Secondary action:
Adjust options

Consequence preview:
Planner can reserve 9:30–11:00 AM for focus.
```

## Implementation

```md
Route:
apps/web/app/assistant/page.tsx

Mobile state:
assistant_thread

Components:
- MobileAssistantShell
- MobileAssistantHeader
- ContextChipRow
- ThreadMessage
- AssistantBubble
- UserBubble
- DynamicPanelRenderer
- MorningFocusPanel
- AmbientEventRow
- MobileComposer
- BottomNav

Data needed:
- current_context
- available_focus_windows
- active_projects
- open_loops_summary
- recommendation_reason_stack
```

## UX rules

```md
Only one dynamic panel should be open at once.

The assistant should not show:
- full “At a glance” grids
- right rail summaries
- multiple suggestion cards
- planner/review/library stats all at once

The panel should be visually part of the assistant response, not a modal.
```

---

# 2. Assistant Mobile — schedule conflict chat

## Purpose

This screen shows Starlog handling a real operational interruption inside chat.

It answers:

```md
Something changed. What should I do?
Can Starlog resolve it without sending me to another screen?
```

## Layout

```md
Header
- Starlog Assistant
- Synced status
- Avatar

Context chips
- Work
- Today

Thread
- Ambient event row
- User message
- Assistant reply
- Inline conflict resolution panel
- Short assistant follow-up

Bottom
- Composer
- Quick prompt chips
- Bottom nav
```

## Example content

```md
Ambient row:
Planner flagged a 30m overlap.

User:
My product review overlaps with deep work. What should I do?

Assistant:
Here are your best options to resolve this cleanly.

- Protect the deep work if it is your highest-leverage block.
- Move the review if there is a safe later slot.
- I can resolve this in one step.
```

## Dynamic panel: Resolve schedule conflict

```md
Title:
Resolve schedule conflict

Conflict summary:
- Deep work block — 9:30–11:00 AM
- Conflict — 9:45–10:15 AM
- Team sync — 9:45–10:15 AM

Options:
1. Move deep work
   Recommended — preserves your longer focus block.

2. Shorten block
   Keep both, but reduce protected time.

3. Keep both
   Mark deep work flexible and decide later.

Primary action:
Apply choice

Secondary action:
Open planner

Consequence preview:
Moves deep work to 2:15–3:45 PM and preserves 90m focus.

Assistant follow-up:
If you want, I can also repair the rest of the afternoon.
```

## Implementation

```md
Components:
- AmbientEventRow
- ConflictSummaryMiniTimeline
- ConflictResolutionPanel
- DynamicPanelOption
- ConsequencePreview
- AssistantFollowupBubble

Panel source:
AssistantInterrupt with tool_name = resolve_planner_conflict

Fields:
- selected_resolution
- affected_block_id
- target_time
- apply_scope

Actions:
- submit interrupt
- open Planner
- ask Assistant to repair full day
```

## UX rules

```md
The user should understand the conflict in under 5 seconds.

Do not show the full day calendar inside chat.

Show only:
- what conflicts
- why it matters
- best recommended repair
- consequence of applying it
```

---

# 3. Mobile Dynamic Panels — board A

## Purpose

This board defines the mobile grammar for structured assistant actions.

These panels are not separate screens. They are reusable inline components that can appear inside Assistant threads.

## Shared panel pattern

```md
Dynamic panel anatomy:

1. Panel title
2. One-line reason
3. Structured choices / fields
4. Recommended default
5. Consequence preview
6. Primary action
7. Secondary escape
```

## Panel A1 — Task missing due date

```md
Trigger:
Assistant has found or created a task but cannot schedule it.

Title:
Finish onboarding flow polish

Reason:
This task is missing a due date.

Fields:
- Due date: Today / Tomorrow / Pick date
- Priority: High / Medium / Low
- Option: Create 45m focus block

Primary:
Create task

Consequence preview:
Blocks 9:30–11:00 AM for deep work and protects focus time.
```

## Panel A2 — Capture triage

```md
Trigger:
A new capture enters the inbox.

Title:
Design idea: inline AI suggestions in the editor

Metadata:
Captured from Chrome · Starlog idea doc

Fields:
Classify this item:
- Reference
- Idea
- Task
- Review material
- Project input

What should we do next?
- Summarize
- Make cards
- Create task
- Append to note

Primary:
Summarize

Consequence preview:
I’ll summarize this idea, extract key points, and save a note to your Ideas library.
```

## Panel A3 — Planner conflict resolution

```md
Trigger:
A scheduled block overlaps with another commitment.

Conflict display:
- Deep work block
- Conflict
- Team sync

Options:
- Move deep work
- Shorten deep work
- Keep both
- Open Planner

Primary:
Apply choice

Secondary:
Cancel
```

## Panel A4 — Quick entity picker

```md
Trigger:
A capture, note, task, or review item looks related to a project.

Title:
Link to project

Fields:
- Search projects
- Suggested projects
- Selected project

Suggested projects:
- Assistant v2.0 launch
- AI suggestions engine
- Onboarding experience
- Analytics revamp

Primary:
Link item
```

## Implementation

```md
Base component:
DynamicPanelRenderer

Panel variants:
- MissingTaskDetailsPanel
- CaptureTriagePanel
- ConflictResolutionPanel
- EntityPickerPanel

Render source:
AssistantInterrupt

Mobile display mode:
inline first
bottom_sheet for long pickers
full_screen only for complex search
```

---

# 4. Mobile Dynamic Panels — board B

## Purpose

This board defines lightweight mobile assistant panels for choosing, grading, clarifying, and deferring.

## Panel B1 — Morning focus chooser

```md
Trigger:
User opens Assistant in the morning or asks what to focus on.

Options:
- Move project forward
- Clear system friction
- Maintain learning

Primary:
Confirm focus

Why this matters:
Turns vague intention into a concrete plan.
```

## Panel B2 — Review grade panel

```md
Trigger:
User answers a review item in Assistant.

Prompt:
What’s the most effective action when a feature flag causes performance degradation in production?

Grades:
- Again
- Hard
- Good
- Easy

Insight:
You are missing application, not recall.

Support actions:
- Show worked example
- Switch to explanation
```

## Panel B3 — Short clarification panel

```md
Trigger:
Assistant needs exactly one missing detail.

Question:
What time should I schedule this?

Options:
- 9:30 AM
- 10:00 AM
- 10:30 AM
- 11:00 AM
- Pick custom time

Optional:
Use this time for similar blocks

Primary:
Confirm time
```

## Panel B4 — Defer / remind later

```md
Trigger:
The user dismisses or postpones a recommendation.

Options:
- In 1 hour
- This evening
- Tomorrow morning
- No thanks, keep it in view

Purpose:
Keep momentum without nagging.
```

## Implementation

```md
Panel variants:
- FocusChoicePanel
- ReviewGradePanel
- ClarificationPanel
- DeferPanel

Important:
These should use the same visual grammar as board A.

They should not feel like different products.
```

---

# 5. Library Mobile — main surface

## Purpose

The Library mobile screen answers:

```md
What have I captured?
What needs processing?
What has already been turned into useful outputs?
Where did things come from?
```

## Layout

```md
Header
- Starlog Library
- Synced status
- Avatar

Top stat chips
- Unprocessed captures
- Recent artifacts
- Notes & saved items
- Linked to projects

Segmented control
- Inbox
- Artifacts
- Notes
- Sources

Main section
- Inbox / Unprocessed captures

Secondary sections
- Recent artifacts
- Notes & saved items
- Recent sources
- Suggestions

Bottom nav
- Library selected
```

## Inbox row anatomy

```md
Each capture row should show:

- source thumbnail or icon
- title
- source app / source type
- capture type
- timestamp
- 1–2 primary quick actions
- overflow menu
```

Example:

```md
Title:
Onboarding flow polish — user interview notes

Metadata:
Confluence · Interview notes

Actions:
Summarize
Make cards
```

## Mobile behavior

```md
Rows should not expose every action at once.

Show:
- best suggested action
- one secondary action
- overflow menu for the rest

Swipe actions:
- Archive
- Link to project
- Process later
```

## Implementation

```md
Route:
library or notes alias

Components:
- MobileLibraryShell
- LibraryStatsCarousel
- LibrarySegmentedTabs
- CaptureInboxList
- MobileCaptureRow
- RecentArtifactsCarousel
- NotesCompactList
- RecentSourcesCard
- LibrarySuggestionsCard
- BottomNav

Data:
- captures summary
- unprocessed captures
- artifacts
- notes
- source counts
- suggested actions
```

## UX rule

```md
Library mobile should feel like a processing queue, not a file browser.
```

---

# 6. Library Mobile — artifact detail / capture processing

## Purpose

This screen answers:

```md
What is this item?
Where did it come from?
What has Starlog extracted?
What can I turn it into?
Where is it connected?
```

## Layout

```md
Header
- Back to Library
- Artifact title
- Open in source
- More

Stacked accordion cards:
1. Artifact detail
2. Quick capture
3. Source & provenance
4. Conversion & enrichment
5. Activity & timeline

Bottom nav
- Library selected
```

## Artifact detail card

```md
Shows:
- file/type icon
- title
- subtitle
- source
- captured time
- file / URL
- tags
- summary
- key ideas

Primary actions:
- Summarize
- Make cards
- Create task
- Append to note
```

## Quick capture card

```md
Shows:
- preview thumbnail
- quick note
- classify capture
- add tags
- save to Library
- create task from this
```

## Source & provenance card

```md
Shows:
- source
- URL
- capture method
- capture time
- linked project
- linked notes
- used in tasks/review
```

## Conversion & enrichment

```md
Action tiles:
- Summarize
- Make cards
- Create task
- Append
- Extract highlights
```

## Implementation

```md
Routes:
library/captures/[captureId]
library/artifacts/[artifactId]

Components:
- MobileArtifactDetailScreen
- AccordionSection
- ArtifactMetadataCard
- CapturePreviewCard
- ProvenanceCard
- ConversionActionRail
- ActivityTimelineCompact

Mobile rules:
- Use accordions.
- Keep Artifact detail expanded by default.
- Collapse Activity unless recently updated.
- Use bottom sheets for tag editing and project linking.
```

## UX rule

```md
Generated content must always stay close to provenance.
```

---

# 7. Planner Mobile — main surface

## Purpose

The Planner mobile screen answers:

```md
What is my day?
What is fixed?
What is flexible?
What is blocked or conflicting?
What is the next focus action?
```

## Layout

```md
Header
- Starlog Planner
- Synced status
- Avatar

Date controls
- Today
- previous / next
- selected date
- Add block

Day strip
- Mon / Tue / Wed / ...

Metric chips
- Focus time
- Meetings
- Tasks
- Buffer

Main content
- Day timeline
- Today’s plan list
- Conflict card
- Next focus block card
- Upcoming card

Bottom
- Planner composer
- Prompt chips
- Bottom nav
```

## Timeline blocks

```md
Block types:
- Focus block: green
- Meeting / commitment: blue
- Meal / away: neutral
- Conflict: amber/red
- Buffer: dark/hatched
```

## Today’s plan grouping

```md
Scheduled commitments:
- Deep work block
- Team sync
- Lunch
- Focus review

Flexible tasks:
- Design inline AI suggestions
- Write capture logic
- Review analytics schema
- Update help copy

Done:
- Triage capture ideas
```

## Conflict card

```md
Title:
Conflict detected

Description:
Product review overlaps with your deep work block.

Primary:
Repair day
```

## Implementation

```md
Route:
planner

Components:
- MobilePlannerShell
- DateSelector
- DayStrip
- PlannerMetricChips
- MobileDayTimeline
- TimeBlockCard
- TodayPlanList
- ConflictSummaryCard
- NextFocusBlockCard
- UpcomingCard
- PlannerComposer
- BottomNav

Mobile behavior:
- Timeline is vertically scrollable.
- Today’s plan can be collapsed below the timeline.
- Conflict card should float upward in priority.
- “Repair day” opens an Assistant dynamic conflict panel.
```

## UX rule

```md
Planner mobile should optimize execution, not calendar browsing.
```

---

# 8. Review Mobile — main surface

## Purpose

The Review mobile screen answers:

```md
What should I review now?
At what depth?
Why this?
How does it connect to my real work?
```

## Layout

```md
Header
- Starlog Review
- Synced status
- Avatar

Tabs
- Today
- All due
- Upcoming
- Mastered
- Insights

Learning ladder
- Recall
- Understanding
- Application
- Synthesis
- Judgment

Main review card
- stage
- progress
- due state
- question
- answer choices
- grading buttons

Support actions
- Show explanation
- Show worked solution
- Flag question

Explanation cards
- Correct
- Why this now?

Lower cards
- Knowledge health
- Queue ladder
- Session progress

Bottom nav
- Review selected
```

## Learning ladder

```md
The ladder should be horizontally scrollable on smaller phones.

Stages:
- Recall
- Understanding
- Application
- Synthesis
- Judgment

Selected:
Application
```

## Review item anatomy

```md
Stage:
Application

Prompt:
Your team’s onboarding flow has a 62% drop-off between the plan selection screen and workspace setup. Which change is most likely to reduce drop-off without adding friction earlier in the flow?

Answer options:
A. Add a feature tour before workspace setup
B. Move workspace setup earlier in the flow
C. Pre-fill workspace defaults and allow skip
D. Require team invites before setup

Selected:
C

Grades:
Again
Hard
Good
Easy
```

## Explanation area

```md
Correct:
This reduces friction at the highest-leverage drop-off point while preserving optionality.

Why this now?
You’re working on onboarding flow polish, which targets this exact drop-off. Reviewing this strengthens transfer to your current project.

Source:
Starlog Idea Note

Project:
Onboarding flow polish
```

## Implementation

```md
Route:
review

Components:
- MobileReviewShell
- ReviewTabRow
- LearningLadderScroller
- ReviewQuestionCard
- AnswerChoiceList
- ReviewGradeButtons
- ReviewSupportActions
- ExplanationCard
- WhyThisNowCard
- KnowledgeHealthCard
- QueueLadderCard
- SessionProgressCard
- BottomNav

Mobile behavior:
- Show one review item at a time.
- Keep answer choices full width.
- Grade buttons should be thumb-friendly.
- Explanation appears after answer or on demand.
- “Why this now?” should stay visible after grading.
```

## UX rule

```md
Review mobile should feel like training judgment in small moments,
not like grinding flashcards.
```

---

# Shared mobile implementation rules

## 1. Bottom nav

```md
Always present:
- Assistant
- Library
- Planner
- Review

Active tab uses gold accent.
Inactive tabs use muted gray.
```

## 2. Composer

```md
Assistant composer appears:
- in Assistant always
- in Planner as a planning composer
- optionally in Library detail for “ask about this”
- optionally in Review for explanations

Composer anatomy:
- sparkle icon
- placeholder
- send button
- optional prompt chips
```

## 3. Dynamic UI display modes

```md
Inline panel:
Default for Assistant thread.

Bottom sheet:
Use for long pickers, filters, date/time selection, project search.

Full screen:
Use only for complex editing, search, or multi-step workflows.

Toast / ambient row:
Use for background events and completed actions.
```

## 4. Density limits

```md
Mobile screen should usually contain:

- one active decision
- one primary CTA
- at most one dynamic panel
- at most 3 prompt chips
- at most 2 visible secondary cards below the main action

If more context exists, hide it behind:
- View details
- Expand
- Open surface
- Bottom sheet
```

## 5. Dynamic panel contract

```md
Every mobile dynamic panel should define:

id
tool_name
title
body
entity_ref
fields
recommended_defaults
consequence_preview
primary_label
secondary_label
display_mode
metadata.variant
```

## 6. Assistant-first handoff pattern

```md
Assistant can create or modify state in other surfaces.

Examples:
- Confirm focus → creates Planner focus block
- Apply conflict repair → updates Planner
- Summarize capture → creates Library artifact
- Make cards → creates Review items

After action:
Show a tiny ambient confirmation row in the thread.
Do not navigate away unless the user asks.
```

---

# Recommended mobile build order

## Phase 1 — clean Assistant thread

```md
Build:
- MobileAssistantShell
- Thread message layout
- Composer
- Bottom nav
- Inline DynamicPanelRenderer

Implement first scenarios:
- Morning focus chooser
- Schedule conflict resolver
```

## Phase 2 — dynamic panel library

```md
Build reusable panels:
- ChoicePanel
- FormPanel
- ConflictPanel
- EntityPickerPanel
- GradePanel
- DeferPanel
```

## Phase 3 — mobile Library

```md
Build:
- Library inbox
- Capture row
- Artifact carousel
- Artifact detail with accordions
```

## Phase 4 — mobile Planner

```md
Build:
- Day timeline
- Today’s plan
- Conflict card
- Assistant repair handoff
```

## Phase 5 — mobile Review

```md
Build:
- Ladder scroller
- Review card
- Grade buttons
- Why this now
```

The most important mobile decision: **Assistant should not become a dashboard on a phone.** It should be a clean thread with powerful inline panels. That is the mobile interaction model that makes Starlog feel different.
