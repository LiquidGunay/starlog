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

The immediate problem is adoption. The user already takes notes, asks questions, and receives scheduled briefs in ChatGPT, but lacks the structure and continuity to repeat those activities reliably. Journaling also has the friction of starting the activity itself. Prioritize continuity and recurring practice, then retrieval and organization, then making development visible.

Notes and questions are the first usable loop. A narrow release is acceptable before the newspaper and journal are ready. Those can be developed in parallel once shared architecture and interfaces are agreed. More infrastructure, evaluation machinery, or speculative features must not become prerequisites for trying the core loop.

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
| Today | Resume current thinking; add the daily newspaper and evening journal as they become usable |
| Notebook | Notes, ongoing Threads, contextual discussions, search, links, and drafts |
| Reading | Raw clips and references in the Library, a deliberate Queue, and a small Up next selection |

Names and layout can be refined in design. These responsibilities describe the first daily-use iteration; the narrow notes/questions pilot does not wait for every surface to be complete.

Desktop should give the note or source the main space and allow discussion alongside it. Phone browsers should offer the same core workflow in a suitable compact layout. Writing must be easy to reach. A universal chat thread is not the organizing requirement.

### Notes, Threads, and questions

Create or edit a note without choosing a project, taxonomy, or learning technique. Begin with a real question, passage, thought, or rough explanation from reading or work. Quick notes can stand alone.

A Thread holds an ongoing question or pursuit across notes, sources, and discussions. Topics work as tags, rather than a required folder hierarchy. On return, suggest one useful starting point from the Queue or an existing open Thread, explain why, and make alternatives or a new start easy to choose.

Provide lightweight ways to express intent:

- Ask a question: help with something the user wants answered.

- Think this through: support investigation and reasoning; this is the default within an inquiry.

- Challenge my explanation: examine gaps, claims, assumptions, and counterexamples.

Both user-led and model-led questioning belong. Preserve the user's original question and allow a better question, revised explanation, or unresolved disagreement to become the saved outcome. Straightforward factual help remains available.

Save discussions automatically. Offer an optional, editable checkpoint containing current thinking, unresolved questions, and a possible next step. Leaving must not require a wrap-up. Distinguish model-authored checkpoints from the user's own words; saving useful outcomes must not require promoting an entire conversation into a note.

The tutoring behavior should make the smallest useful intervention that leaves meaningful reasoning to the learner:

- Ask one coherent question at a time.

- Respond to the actual attempt and infer difficulty cautiously.

- Avoid hiding the key insight in the question, setup, or example.

- Avoid questions so vague that they prevent progress.

- Explain missing prerequisites rather than withholding needed knowledge.

- Make hints, direct explanation, and stopping available.

- Do not treat repeating a supplied hint as independent understanding.

### Inspectable knowledge context

Maintain provisional, correctable interpretations of the user's knowledge from notes and discussions, with links to their supporting evidence. Keep source records distinct from model inferences. Corrections take precedence over inferred interpretations, and rejected interpretations must not silently reappear. Copied text, model-authored explanations, and successful responses after hints do not establish independent understanding.

This context belongs to Starlog and must remain useful without access to ChatGPT memories. Research into existing memory systems may inform the implementation; no memory library, graph database, or extraction pipeline has been selected. Journal entries and their derived interpretations are excluded from this knowledge context.

### Daily newspaper

Provide a finite daily edition from selected RSS sources, focused initially on the user's current research and product interests. Expand that scope deliberately over time. YouTube, Google, and X remain separate services the user continues to use; importing or reconstructing their feeds is outside this initial scope.

The target is roughly ten minutes, with natural day-to-day variation rather than a hard limit. No fixed item count or section quota is agreed. Each item should have a concrete reason to read it, an explanation that develops the idea, source access, and an optional way to investigate further. The user may read and leave without creating a note, answering a quiz, or accepting a commitment.

Starlog should control its own recommendations and give the user control over sources, interests, and relevance. The eventual selection process can use broad heuristic filtering followed by more intelligent curation. Exact controls, ranking methods, and infrastructure remain architecture and iteration decisions.

Evaluate source relevance separately from writing quality. The newspaper should be compelling without sensationalism, manufactured certainty, or an endless stream. Preserve meaningful dates and attribution when summarizing outside material. A supplied-source trial is acceptable before an extensive autonomous research system exists.

Inspection of existing personal briefs found useful explanations, caveats, and personalization, but weak prioritization and repeated strong recommendations. Improve selection and differentiation through real feedback; reading every item must not become an obligation. Exact RSS sources and edition timing remain open.

### Nightly journal

Offer a short entry with editable questions. Possible defaults:

- What held my attention today?

- What changed my mind, or remained confusing?

- What would I like to return to tomorrow?

Users can replace these with questions about work, relationships, habits, or other concerns. A one-sentence entry is valid. Saving must not require inference. Offer model follow-ups as an optional action after writing; do not turn every entry into an extended interview.

Journal entries may inform journal recommendations only. Neither entries nor interpretations derived from them may influence knowledge context, tutoring, learning recommendations, or the newspaper. Preserve this boundary when designing retrieval and personalization.

Use one evening reminder with an easy skip/resume path. Exact time and questions remain configurable. Notification availability and delivery behavior must be verified in the selected web environment; this decision does not mean a reminder has already been scheduled.

### Clips, Library, Queue, and Up next

Adopt Obsidian-style browser clipping: preserve useful selected or extracted content and its source attribution. Storing text, HTML, and images is acceptable; link to videos. Reading and watching normally happen at the original source. The feasible capture route on desktop and Android browsers, extraction fidelity, and any extension or sharing integration remain architecture decisions.

Raw clippings are retained source material. Notes can reference one or several clips when useful. Keep authored thinking distinct from quotations. There is no required processed state and no automatic promotion from a clip to a note.

Separate retained material from intended attention:

- Library: the larger searchable collection of clips, notes, and references.

- Queue: things the user intends to read, watch, or think about, not every saved reference.

- Up next: a small deliberate selection within the Queue, without a fixed three-item cap.

Read/unread status may help describe source attention independently of Queue membership. A rough fragment, open question, explanation, or assembled draft describes thinking; none requires a compulsory processing pipeline. No model should mark a source understood because it was opened, summarized, or discussed.

Offer a brief weekly pruning review of a handful of older Queue items, with suggestions and reasons. The user decides what stays in the Queue. Removing an item from the Queue leaves it available as reference; do not silently delete captures or create overdue work from everything saved.

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

The narrow personal pilot must support a complete notes/questions loop:

1. Open on a laptop or Android browser and write a fragment or capture a source with minimal setup.
2. Ask a question or examine an explanation in context, with direct help available.
3. Keep the discussion, optionally save an editable checkpoint, and connect a note if useful.
4. Find prior work through search and resume an open Thread or something from Up next without reconstructing context.
5. Return after missed days without an intimidating backlog.
6. Flag an unhelpful question directly where it occurred.

The newspaper and journal complete the broader daily-use iteration as they become ready: read a finite RSS edition and leave feedback; write with chosen journal questions, optionally request a follow-up, and receive one evening reminder where delivery is supported. These features may progress in parallel once shared architecture is settled. They are not prerequisites for starting the narrow pilot.

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

Users can decide that something should be retained or practised. Support recall, teach-back, comparison, misconception checks, application, interleaving, and project work when useful. These commitments remain part of the fuller vision; whether lightweight optional review enters the first pilot is still open in section 8.

Distinguish a learning target from any particular exercise. Fixed cards, regenerated questions, and ephemeral exercises can coexist where evidence justifies them. Important conceptual formulation remains participatory; automatic generation may help mechanical material.

If spaced repetition is introduced, scheduling is deterministic. The model supplies semantic feedback or evidence, not invented due dates. Users can edit, suspend, reject, and retire commitments.

### A meaningful map

Connect notes, questions, sources, and projects with intelligible relationships and provenance. Keep accepted relationships distinct from model suggestions. The map represents recorded thinking, not a claim of comprehensive knowledge or mastery.

### Reflection and small experiments

Weekly or monthly reflection may reveal recurring interests, obstacles, and patterns. Present grounded observations the user can correct. Help choose a small change, try it, and revisit the result. Keep journal-derived reflection within journaling and use knowledge records for learning reflection. Broader habits and planning enter only where this practice benefits.

### Personalization and ownership

Improve relevance and assistance using explicit preferences and observed interactions, within the journal/knowledge boundary. Let users inspect and correct what the app assumes, control which material is used, pause directions, and export their work.

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

- Broad import/migration work, capture integrations beyond the agreed browser-clipping workflow, and automatic deck generation.

- Automated import or amalgamation of X, YouTube, or Google recommendation feeds.

- Public multi-user infrastructure before a useful personal pilot.

Deferred items are options, not a promised backlog. Exact offline alarms and closed-app audio should not be assumed available merely because the app is a PWA.

## 7. Architecture work still to do

This plan does not select a framework, database, deployment provider, model runtime, or repository layout.

Next, reason through concrete scenarios and record decisions here:

1. Walk through the narrow notes/questions loop and the newspaper, capture, and journal interactions, including failure and resumption.
2. Settle the smallest content/state model for notes, Threads, discussions, raw clips, Library/Queue/Up next, tags, checkpoints, and relationships. Distinguish user-authored, suggested, accepted, read, and committed material without imposing a processing pipeline.
3. Choose the note editor, desktop/Android clipping route, search, and contextual discussion attachment.
4. Design evidence-linked, correctable knowledge context and enforce the separate journal context boundary. Evaluate existing memory techniques without adopting a framework by default.
5. Test eligible ChatGPT plan access, supported tools, limit behavior, worker hosting, and unattended newspaper generation on the actual account.
6. Decide authentication, online storage, backup/export, and a minimal persistent edit queue with stale-write and conflict handling.
7. Choose a deployable web topology and notification approach; specify what happens when a worker sleeps or inference is unavailable.
8. Choose a minimal RSS ingestion and curation approach with useful recommendation controls, source attribution, and finite editions.
9. Decide how skill versions, source packets, feedback, and narrow regressions are maintained.
10. Choose the fresh implementation location and shared interfaces so the first usable loop can ship while independent work proceeds safely in parallel.

Use existing products or prototypes when they answer a specific uncertainty. The earlier multi-project MCP exploration is no longer a compulsory gate. Retain useful lessons without rerunning an entire old research program.

Implement only after the user has worked through the architecture and scope. Deliver a complete usable loop, then iterate on the friction revealed by actual use. Do not build an extensibility framework before the first daily experience works.

## 8. Open preferences and decision record

Still open:

- Exact RSS sources, edition timing, and the first recommendation controls; focus and approximate reading time are agreed.

- Exact journal questions and evening reminder time; a single reminder and journal-only use of entries are agreed.

- The concrete interaction for the first connection suggestion and the need that would justify a larger graph.

- Whether lightweight optional review should enter the first pilot. The current proposal is to revisit an existing note or Thread, attempt an explanation, comparison, or application before revealing the old answer, then inspect feedback. Formal spaced repetition and a global graph would remain later decisions. This proposal is not yet accepted scope.

- Pilot cadence and the threshold for expanding beyond personal use.

- The architecture choices in section 7.

Accepted on 2026-10-03:

- Consolidate this conversation into one canonical plan; archive earlier plans so they do not drive future development.

- Prioritize notes/questions and continuity. Start with a narrow usable loop, allowing the newspaper and journal to progress in parallel after shared architecture is agreed.

- Organize ongoing inquiry as Threads, Topics as tags, and deliberate attention as Queue/Up next within a broader Library.

- Save discussions automatically and offer editable, optional checkpoints. Preserve the user's reasoning and distinguish model contributions.

- Use provisional knowledge interpretations with evidence and durable corrections; provider memories are not required.

- Adopt browser clipping with raw source material referenced by notes, without a required processed state; prune the deliberate Queue periodically with user decisions.

- Create a finite RSS newspaper for current interests, targeting roughly ten minutes without a hard cap. Keep YouTube, Google, and X separate; expand source scope deliberately and evolve curation through use.

- Provide customizable journaling, optional follow-ups, and one evening reminder. Journal entries and their derived context influence journal recommendations only.

- Start with participatory links and distinguish model suggestions. A large graph and formal learning commitments belong to the fuller vision unless a further decision brings a narrow part forward.

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
