# Starlog — canonical product plan

Updated: 2026-10-03
Status: product direction accepted; architecture and implementation have not been selected.

## Authority and how to use this plan

This is the single source of truth for Starlog's product vision, scope, priorities, and agreed decisions. It consolidates the October 2026 discussion and supersedes all earlier product plans, assistant reset documents, UI concepts, and the MCP exploration brief.

Read this plan first. Read AGENTS.md for repository process and docs/CURRENT_STATE.md for implementation evidence. Neither is a second product plan. Update this file in place as product and architecture decisions are made; do not introduce another VISION, NEWPLAN, PRD, or competing roadmap. Implementation tickets and detailed technical references must point back here.

Previous material is preserved under docs/archive/2026-10-03-legacy/. It is historical evidence, not instructions. Do not load or search it during normal planning or development. Consult a specific archived file only when a concrete question requires history or the user requests it. Archive recovery instructions are in that directory's README.

The existing application is legacy. The next product is a fresh implementation; reuse a specific piece only after showing that it fits the new plan. Existing schemas, routes, prompts, infrastructure, UI, and migrations create no obligations. Repository location and any data migration remain architecture decisions.

## 1. Vision

Starlog helps people build a daily practice of curiosity, clear thinking, and reflection. It brings worthwhile material into view, gives unfinished thoughts a place to develop, and offers questions and feedback that help users form their own understanding. Over time, it connects that understanding to memory, writing, projects, and choices while keeping the user in charge of what deserves their attention.

The first user is the owner of this project. The longer-term ambition is a product other people can use for their own learning journeys. Generalization should follow successful personal use.

The immediate problem is adoption: useful ideas and draft skills exist, but the user has not reached a rhythm of using them. The first release must provide a complete daily experience with a short feedback cycle. More infrastructure, evaluation machinery, or speculative features must not become prerequisites for trying it.

## 2. Product principles

- Preserve human intellectual participation. Formulating a question, attempting an explanation, and making a connection can themselves be the learning.
- Make unfinished thinking welcome. A fragment or unresolved question is a useful outcome.
- Offer appropriate help. Ask a useful question, explain a missing prerequisite, or answer directly according to the user's intent. Do not force every interaction through Socratic questioning.
- Distinguish access, attention, and understanding. Saving a source is not reading it; reading it is not mastering it.
- Keep commitments explicit. Captures, model suggestions, and temporary exercises do not automatically become review obligations.
- Make ordinary writing, reading, search, and journaling usable without model availability.
- Keep sessions bounded and easy to resume. Missing days should not create an intimidating backlog.
- Make model contributions inspectable. Preserve sources, distinguish suggestions from accepted content, and retain meaningful edit history.
- Optimize for useful thinking and sustained practice, not time spent, output volume, graph size, or completion streaks.
- Improve from actual use. Treat model-quality and engagement claims as hypotheses until real interactions support them.

## 3. First daily-use iteration

### Surfaces

| Surface | Purpose |
| --- | --- |
| Today | A short daily brief, an easy way to resume current thinking, and the evening journal |
| Notebook | Fragments, questions, explanations, search, links, drafts, and contextual discussions |
| Reading | Saved sources, read/unread distinction, and a small selection for upcoming attention |

Names and layout can be refined in design. These are the agreed starting responsibilities.

Desktop should give the note or source the main space and allow discussion alongside it. Phone browsers should offer the same core workflow in a suitable compact layout. Writing must be easy to reach. A universal chat thread is not the organizing requirement.

### Notes and questions

Create or edit a note without choosing a project, taxonomy, or learning technique. A note may begin with a thought, a passage, a question, or a rough explanation.

Provide lightweight ways to express intent:
- Ask a question: help with something the user wants answered.
- Think this through: support investigation and reasoning.
- Challenge my explanation: examine gaps, claims, assumptions, and counterexamples.

Both user-led and model-led questioning belong. Preserve the user's original question and allow a better question, revised explanation, or unresolved disagreement to become the saved outcome. Saving useful outcomes should not require promoting the entire conversation into a permanent note.

The tutoring behavior should make the smallest useful intervention that leaves meaningful reasoning to the learner:
- Ask one coherent question at a time.
- Respond to the actual attempt and infer difficulty cautiously.
- Avoid hiding the key insight in the question, setup, or example.
- Avoid questions so vague that they prevent progress.
- Explain missing prerequisites rather than withholding needed knowledge.
- Make hints, direct explanation, and stopping available.
- Do not treat repeating a supplied hint as independent understanding.

### Daily brief

Provide a finite edition that earns attention through selection, explanation, and useful payoff. Initial candidate content includes outside discoveries and the user's ongoing interests or questions.

Each item should have a concrete reason to read it, an explanation that develops the idea, source access, and an optional way to investigate further. The user may read and leave without creating a note, answering a quiz, or accepting a commitment.

Evaluate source relevance separately from writing quality. The brief should be compelling without sensationalism, manufactured certainty, or an endless stream. Preserve meaningful dates and attribution when summarizing outside material.

A provisional starting size is roughly three worthwhile items. Content balance, length, cadence, and sources remain tunable; no unanswered preference is a locked requirement. A simple supplied-source workflow is acceptable for initial trials; an extensive autonomous research system is not required before use.

### Nightly journal

Offer a short entry with editable questions. Possible defaults:
- What held my attention today?
- What changed my mind, or remained confusing?
- What would I like to return to tomorrow?

Users can replace these with questions about work, relationships, habits, or other concerns. A one-sentence entry is valid. Saving must not require inference.

Offer model follow-ups as an optional action after writing. Do not turn every entry into an extended interview. Let the user choose whether journal material is used in briefs or other model interactions.

One reminder with an easy skip/resume path is the provisional default. The user has not yet chosen reminder persistence. Notification availability and delivery behavior must be verified in the selected web environment.

### Notes, clipping, and attention

Initial capture can save a URL, selected text, source metadata, and an optional reason for saving. Rich extraction, browser extensions, and platform share integrations can follow demonstrated friction.

Keep source status separate from the state of the user's thinking:
- Sources: unread, read, retained as reference, or archived.
- Thinking: rough fragment, open question, developed explanation, or an assembled draft.

These are descriptive distinctions, not a compulsory processing pipeline. No model should mark a source understood merely because it was opened, summarized, or discussed.

Separate a small Reading next shelf from the larger searchable collection. Three selected items is a provisional starting point, not a hard cap. Other captures are available without becoming overdue work. Offer keep/archive decisions; do not silently delete old captures.

### Connections and drafts

Start with explicit links and backlinks. Let the user describe a connection in their own words; optional relationship labels can help.

The model may suggest a connection with a reason and supporting passages. Suggested links remain distinct from user-authored or accepted links. Users can accept, reject, or ignore them.

Let users gather and arrange fragments into drafts. The model can critique an outline, identify a gap, ask what claim connects the fragments, or propose a structure when asked. Compare these approaches through use rather than assuming model-generated synthesis is always desirable.

A large interactive graph is a later experiment. It must help navigate or develop an idea to justify its complexity.

### Feedback built into use

Embed the brief and tutoring skills in their relevant interactions. The user should not have to copy prompts, invoke a skill manually, or manage model context to use the app.

Offer quick, optional feedback attached to the exact output:
- Brief: interesting, lost me, too obvious, poor explanation, or a comment.
- Questioning: too leading, too vague, need an explanation, or a comment.

Preserve the relevant interaction, source context, model/settings when available, and skill version. Keep feedback collection selective and reviewable. Revise skills from recurring failures and occasional comparisons, without making the user a full-time evaluator.

The September 2026 pilot produced draft Compelling Briefs and Socratic Learning skills. Its findings were mixed; they are starting hypotheses, not proven improvements. Preserve useful evaluation lessons: factual fidelity, source selection versus prose quality, who supplied an inference, prerequisite teaching, and later unassisted performance.

## 4. First-release acceptance

A usable first release lets the owner complete this ordinary day:
1. Open Today on a laptop or Android browser and find a brief worth trying.
2. Write a fragment or save a source with minimal setup.
3. Ask a question or examine an explanation in context.
4. Save the useful result, connect a note if helpful, and find it again through search.
5. Write the nightly journal with chosen questions and optionally request a follow-up.
6. Return the next day, or after several missed days, without reconstructing context.
7. Flag an unhelpful brief or question directly where it occurred.

Reliability requirements:
- Persistent private data and a recoverable save path.
- Clear distinction between saved locally and synced.
- Safe retry behavior and protection against stale cross-device overwrites.
- Useful access to already-loaded notes during brief connection interruptions, if included in the selected first implementation.
- Search, source links, and a practical export/backup path.
- Notes and journal remain usable when model access is unavailable or limits are reached.
- No repeated CLI, prompt-copying, or skill-management chores in daily use.

Judge the pilot by whether the user returns, develops worthwhile questions or explanations, finishes a useful small session, and identifies actionable friction. Do not substitute completion counts or model-graded mastery for this evidence. Exact trial duration and cadence are open.

## 5. Fuller product vision

The mature product deepens the same practice rather than accumulating every Life OS feature.

### Starting a learning journey

A new user can begin with one curiosity, source, or real problem. Offer immediate useful work before requesting extensive setup. Establish interests, difficulty, reading appetite, and reflection preferences gradually.

Support informal exploration alongside deliberate goals. A curriculum must not be a prerequisite for notes, reading, or reflection.

### Continuing inquiry

A question can connect sources, notes, discussions, experiments, applications, and drafts. Show how the user's explanation changed, what evidence informed it, and which uncertainties remain.

### User-chosen learning commitments

Users can decide that something should be retained or practised. Support recall, teach-back, comparison, misconception checks, application, interleaving, and project work when useful.

Distinguish a learning target from any particular exercise. Fixed cards, regenerated questions, and ephemeral exercises can coexist where evidence justifies them. Important conceptual formulation remains participatory; automatic generation may help mechanical material.

If spaced repetition is introduced, scheduling is deterministic. The model supplies semantic feedback or evidence, not invented due dates. Users can edit, suspend, reject, and retire commitments.

### A meaningful map

Connect notes, questions, sources, and projects with intelligible relationships and provenance. Keep accepted relationships distinct from model suggestions. The map represents recorded thinking, not a claim of comprehensive knowledge or mastery.

### Reflection and small experiments

Weekly or monthly reflection may reveal recurring interests, obstacles, and patterns. Present grounded observations the user can correct. Help choose a small change, try it, and revisit the result. Broader habits and planning enter only where this practice benefits.

### Personalization and ownership

Improve relevance and assistance using explicit preferences and observed interactions. Let users inspect and correct what the app assumes, control which material is used, pause directions, and export their work.

Other users must have their own private data and preferences. Account isolation, onboarding, support, and commercial model access must be resolved before offering a public service; personal subscription access does not settle that architecture.

## 6. Boundaries and deferred scope

Agreed platform direction:
- Web-first for laptop and phone. A native Android app is not a first-release requirement.
- Voice interaction is out of scope. Optional short briefing read-aloud may be added if it proves useful.
- Online storage is acceptable. Sync is reliability work, not the product's central differentiator.
- Prefer low-cost use of the user's ChatGPT plan for eligible intelligence workflows, subject to actual supported access and testing.
- Application data and history belong to Starlog; provider memory is not the only copy.
- No automatic separately billed model fallback. Any paid provider path needs an explicit decision.
- Keep credentials out of browser clients.

Deferred:
- Native mobile parity, custom alarms, STT/TTS infrastructure, and voice-first flows.
- A universal persistent assistant thread and assistant-driven management of every surface.
- Extensive calendar synchronization, time blocking, task orchestration, and autonomous life management.
- A plugin platform, comprehensive Obsidian compatibility, or a general graph editor.
- Full offline library replication, collaborative real-time editing, and sophisticated automatic conflict merging.
- Broad import/migration work, rich clipping integrations, and automatic deck generation.
- Public multi-user infrastructure before a useful personal pilot.

Deferred items are options, not a promised backlog. Exact offline alarms and closed-app audio should not be assumed available merely because the app is a PWA.

## 7. Architecture work still to do

This plan does not select a framework, database, deployment provider, model runtime, or repository layout.

Next, reason through concrete scenarios and record decisions here:
1. Walk through note/question, brief, capture, and journal interactions, including failure and resumption.
2. Settle the smallest content/state model and distinguish user-authored, suggested, accepted, read, and committed material.
3. Choose the note editor, source capture/search approach, and how contextual discussions attach to content.
4. Test eligible ChatGPT plan access, supported tools, limit behavior, worker hosting, and unattended brief generation on the actual account.
5. Decide authentication, online storage, backup/export, and a minimal persistent edit queue with conflict handling.
6. Choose a deployable web topology and notification approach; specify what happens when a worker sleeps or inference is unavailable.
7. Decide how skill versions, source packets, feedback, and narrow regressions are maintained.
8. Choose the fresh implementation location and the smallest complete daily-use slice.

Use existing products or prototypes when they answer a specific uncertainty. The earlier multi-project MCP exploration is no longer a compulsory gate. Retain useful lessons without rerunning an entire old research program.

Implement only after the user has worked through the architecture and scope. Deliver a complete usable loop, then iterate on the friction revealed by actual use. Do not build an extensibility framework before the first daily experience works.

## 8. Open preferences and decision record

Still open:
- Brief content balance: outside discoveries, ongoing questions, or a blend.
- Brief length, sources, and timing.
- Nightly reminder persistence and exact journal questions.
- When the first connection suggestion or graph experiment becomes worthwhile.
- Pilot cadence and the threshold for expanding beyond personal use.

The proposed blend of brief content, three-item edition/shelf, and one journal reminder are provisional defaults only.

Accepted on 2026-10-03:
- Consolidate this conversation into one canonical plan.
- Archive earlier plans so they do not drive future development.
- Prioritize notes/questions, compelling brief/feed, customizable nightly journal, clipping/search, and participatory connections.
- Embed draft skills into real use and iterate from feedback.
- Keep web-first delivery and deliberate human interaction.
- Discuss architecture before starting the fresh application.

## 9. Historical continuity and references

Retained from previous visions: lifelong learning, reflection, follow-through, provenance, inspectable history, user-chosen commitments, varied practice, and useful bounded recommendations.

Reframed: proactivity becomes a worthwhile brief, an optional connection or question, and a chosen reminder. Life OS is an aspiration to connect learning and living, not a mandate to manage every domain.

Superseded: voice/chat-first UX, native mobile parity, compulsory assistant-ui protocol migration, the old surface taxonomy, mandatory separate Python orchestration and fallback providers, and MCP/ChatGPT-hosted UI as a predetermined architecture.

For a specific historical question, use the [archive inventory](docs/archive/2026-10-03-legacy/README.md). It points to preserved originals; it is not a reading list.

Existing skill experiment:
- [Pilot findings](C:/Users/bossg/Documents/Codex/2026-09-24/s/outputs/skill-evaluation-pilot/report.md) — local personal artifact, not a portable product dependency.
- Local draft packages: C:/Users/bossg/Documents/Codex/2026-09-24/s/outputs/skills/compelling-briefs/ and socratic-learning/.
- Matt Pocock's [skills repository](https://github.com/mattpocock/skills) supplies development workflows for subsequent questioning and design. Installing these does not settle architecture or start implementation.

If a development skill normally produces another product document, incorporate the relevant decision into this PLAN.md instead. Technical detail and tickets may reference it without duplicating the vision.
