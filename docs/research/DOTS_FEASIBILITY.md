# Dots, documents, and intelligent UI: Starlog feasibility

Researched: 2026-10-17. Status: research and a proposed experiment, not an adopted architecture or implementation authorization. [PLAN.md](../../PLAN.md) remains the sole product plan.

## Finding

Much of the personal Starlog experience can plausibly become a workflow inside ChatGPT: a Dot for ongoing assistance, a plugin for learning practices and document tools, and an existing editor/store for durable work. Current plugin extensions make this substantially more capable than a collection of chat commands. This deserves testing before committing to the proposed standalone application.

The supported proposition is Starlog **inside ChatGPT**, where the host can use a plugin. We did not find a documented contract allowing a separate Starlog website to call the user's personal Dot or read its private memory. Those are different integration directions. This is a documentation finding, not proof that no future or private integration exists.

The core opportunity is to outsource intelligence and coordination while retaining explicit, editable learning records. Personal memory can improve relevance; it should not become the only record of what the user wrote, attempted, rejected, or intends to revisit.

## What is now documented

Dots run in the cloud, maintain continuing responsibilities, use relevant ChatGPT memory and their own notes, and can delegate background work. Fixed recurring work needs a saved schedule; supported event monitoring depends on the connected source. The personal computer can be off for cloud work. Local skills still require a connected computer with ChatGPT running. These capabilities fit a personal briefing and learning companion without operating an inference worker ourselves. [Dots](https://learn.chatgpt.com/docs/dots), [tasks and memory](https://learn.chatgpt.com/docs/dots/tasks-and-memory), [computers and apps](https://learn.chatgpt.com/docs/dots/computers-and-apps).

Plugins package skills and connected tools. Bundled skills can work in Chat and Work across web, desktop, and mobile; copying a standalone skill into a local Codex folder does not establish that cloud/mobile path. Tool and skill choice remains model-mediated and needs testing with ordinary requests. [Plugins](https://learn.chatgpt.com/docs/plugins), [build skills](https://learn.chatgpt.com/docs/build-skills).

The current extensions include sidebar applications, panels beside conversations, file viewers/editors, deep links, settings, and selected-context controls. This supports a recognizable notebook inside ChatGPT, rather than requiring a new prompt every time the user wants to write. The documentation establishes these extensions for ChatGPT generally; support for each extension inside Dot and on Android is not established. Composer content mentions are explicitly desktop-only, and web extensions for Free/Go are described as coming soon. [Plugin extensions](https://developers.openai.com/plugins/build/extensions).

Space already provides directly editable Pages with tables, code, images, links, comments, and interactive visualizations. Its agent guide explicitly supports a Dot alongside a Page and inline or comment requests to it. This is the strongest documented low-build starting point. It does not establish all Starlog requirements: equation/paste fidelity, clipping, export completeness, precise provenance, phone ergonomics, and automatic discussion continuity still need checking. [Pages](https://learn.chatgpt.com/docs/space/pages), [agents in Space](https://learn.chatgpt.com/docs/space/agents).

## What belongs where

| Responsibility | Candidate owner | What Starlog still specifies or implements |
| --- | --- | --- |
| Conversation, explanation, research, ongoing follow-through | Dot and supported host tools | Learning instructions, source boundaries, feedback and quality checks |
| Personalization | Dot memory plus explicit learning documents | Declared focus, corrected assumptions, rejected suggestions, source controls |
| Writing and retained documents | Space Pages or an existing cloud document service | A small organization convention and verified export/recovery path |
| Threads, Queue, Up next, accepted links and review attempts | Explicit documents initially; structured storage if needed | Stable identifiers, meaning of each state, reliable updates |
| Brief preparation and delivery | Dot recurring work | Finite format, sources, relevance reasons, repetition control, timing and destination |
| Interactive explanations | Generated visualizations | Useful question, grounding, accessibility and correctness |
| Durable interactive actions | Tool-connected plugin UI | Save/update tools, authorization, validation and recoverable state |
| Capture | Existing clipping/editor workflow or a small integration | Selected content, attribution, attachments and Android entrypoint |
| Journal | Separately controlled workflow | Existing journal-only purpose boundary; see the unresolved constraint below |

An existing store can remove most storage operations from our workload. It does not automatically provide our exact learning semantics. At personal scale, a few explicit documents may be sufficient; there is no reason to start with a graph database or automatic knowledge-extraction pipeline.

A minimal record set would be a Library index, current focus, open Threads, Queue/Up next, raw source excerpts, authored notes, optional review attempts, and a brief feedback log. These are explicit records, not a second hidden memory engine. Model interpretations and suggestions retain their origin and evidence; accepted corrections are durable.

## Briefings: memory and sources have different jobs

Memory can help choose and explain material in relation to the user. Sources provide fresh evidence. RSS can remain one useful discovery input without defining the whole experience. Dots' connected-source research and continuing context make a personalized brief plausible, but do not automatically inherit the user's X, YouTube, or Google recommendation feeds. The previous decision to leave those feeds separate is not silently reversed by this proposal.

For example, a proposed brief could say: an article bears on an open Thread; a new result complicates an explanation the user wrote; a source offers a useful next step for a declared focus. The user could read and leave, explore one item, keep it in the Library, or express less interest. None should automatically become a Queue or review obligation.

Use explicit current interests and source controls alongside host memory. Save what appeared and optional feedback so repetition and selection can be inspected. Relevance reasons should cite an actual note, Thread, declared preference, or source where possible, rather than inventing a confident story about the user. Memory helps contextual relevance; source quality, novelty, factual accuracy and explanation quality remain separate evaluation questions. This is a product inference from documented capabilities, not a tested outcome.

## Three meanings of intelligent UI

### Generated teaching material

A visualization can generate a small simulation, comparison, concept map, or explanation suited to the current question. For example, a probability discussion could receive an adjustable example rather than another long answer.

These are generally snapshots of supplied context. They are not automatically live views of the Library; a follow-up may replace the visualization. Availability is rolling out across supported web, desktop and mobile accounts. They suit temporary exploration, not the sole storage of a note or an attempted answer. [Visualizations](https://learn.chatgpt.com/docs/visualizations).

### Predictable controls with intelligent content

An MCP App can receive structured data, display a component, call tools when the user acts, and send selected context or a follow-up message to the host. The host model can choose relevant material or generate a question while the controls stay familiar. [MCP UI](https://developers.openai.com/plugins/build/chatgpt-ui).

Starlog examples:

- A finite briefing with source links, relevance reasons, and working Keep, Explore, and Less like this actions.
- A passage panel showing the original quote while a discussion or interactive explanation develops beside it.
- A Revisit view that records the user's attempt before revealing the earlier note; feedback remains distinct from that attempt.
- A small relationship map drawn from selected notes, with proposed connections visually distinct and saved only on acceptance.
- A Queue pruning view where removing an item from intended attention retains the source in the Library.

Buttons that affect durable records must call real tools. UI state such as an expanded section is different from a saved answer. Official guidance assigns authoritative data to the server or external service and explicitly says widget state is not durable business storage. A component also does not gain unrestricted access to Dot memory. [UI state ownership](https://developers.openai.com/plugins/build/chatgpt-ui#manage-state).

### A stable home inside ChatGPT

A sidebar app or conversation panel can make Notebook, Reading, or a selected Thread directly accessible. A file editor could provide richer writing where Pages or an existing editor falls short. This is actual plugin UI development, with host constraints and device testing, even if the model generates the initial code.

Recommendation: stable writing, saving and navigation; adaptive teaching and investigation around the current material. Recreating the entire application on each request would risk repeating the user's difficulty knowing how to start. The three entrances remain fragment, question, and passage; they need not become a setup wizard.

## Three implementation shapes

| Shape | Work we avoid | Remaining work and tradeoff |
| --- | --- | --- |
| Dot + Space/existing documents + workflow plugin | Own editor, agent runtime, memory pipeline and scheduler | Verify the host's everyday interactions, use a simple document convention, validate capture/export and skill activation; most host dependence |
| Dot + small Starlog MCP/plugin UI + durable store | Own inference and agent coordination; potentially own hosting | Build narrow storage tools and stable views; more control over provenance, Queue and review history; Dot/mobile UI compatibility still unproven |
| Independent Starlog website + managed intelligence API | Can avoid operating the agent harness | Own application/state/integration; no documented access to personal Dot memory; API billing and a different product proposition |

The first is the recommended personal experiment. Move to the second only for specific friction found during use. Preserve a usable editor even when assistance is unavailable. Do not treat every current standalone architecture component as mandatory for this experiment.

The third has a newer alternative to running our own worker: the Agents API manages sessions, orchestration, compaction and recovery, with optional hosted sandboxes. It is API-billed, and its documentation does not establish access to a user's personal Dot or ChatGPT memory. It should not be described as plan-funded Dot integration. [Agents API](https://developers.openai.com/api/docs/guides/agents-api/overview).

## Hosting and distribution

Plugin Creator can build an MCP server hosted on Sites. Sites handles sign-in between ChatGPT and that server; access from the server to an underlying document system still needs correct authentication and authorization. This may remove the need to run a Railway service for the pilot. Sites-generated MCP plugins currently do not support editing skills/reference files, so one all-in-one bundle through that path should not be assumed; separate workflow and connector plugins can be used together. [Sites-hosted MCP](https://learn.chatgpt.com/docs/extend/mcp#build-an-mcp-plugin).

If existing documents are insufficient, Sites also documents D1 structured storage and R2 file storage. This is another hosting option, not proof of an implemented private Starlog store. A public Site's identity sign-in is distinct from using visitor-connected plugins: the documented latter capability is restricted to private workspace Sites with required permissions. Sites has runtime and background-service constraints; a public multiuser product is a separate feasibility step. [Site data and connections](https://learn.chatgpt.com/docs/sites/data-and-connections), [Sites limits](https://learn.chatgpt.com/docs/sites#understand-limits-and-unsupported-uses).

A Railway-hosted HTTPS MCP service remains a reasonable alternative if control or compatibility requires it. Its job could be only storage, search and explicit mutations, with no intelligence runtime. Existing repo deployment approval rules continue to apply.

For personal testing, a private connection is different from public plugin publication. Broader distribution adds plugin packaging, review, availability and per-user authorization concerns. Each user's documents must be authorized by the backing service; a user identifier supplied in a prompt is not an access boundary. Local marketplace installation does not prove cloud availability. [Plugin packaging](https://developers.openai.com/plugins/build/plugins), [connect and test](https://developers.openai.com/plugins/deploy/connect-chatgpt).

## Material constraints

1. **Journal isolation is unresolved.** Dot uses selected ChatGPT context and its own notes across its work; its notes are separate from saved ChatGPT memory. Changing saved-memory settings does not necessarily alter existing Dot notes. Custom rules are instructions it tries to follow, not a documented purpose-isolated memory system. Separate chats, folders, or a journal-only instruction therefore do not establish the accepted boundary. Withholding journal documents also cannot erase journal-derived information already in host memory. Keep journaling out of the first Dot experiment, and do not claim strict isolation until a supported boundary is verified or the user explicitly changes the requirement. [Memory](https://learn.chatgpt.com/docs/dots/tasks-and-memory#persistent-memory), [controls](https://learn.chatgpt.com/docs/dots/controls#set-custom-rules).

2. **Host memory is not the knowledge ledger.** The reviewed Dot docs do not specify an exhaustive memory viewer, export, individual-note CRUD API, or guarantees that rejected knowledge inferences never recur. Context is selective. Explicit corrections and learning evidence can live in documents, but a skill cannot guarantee all future model behavior.

3. **Mobile web is unsupported for Dot.** ChatGPT mobile apps are supported. Using the Android ChatGPT app avoids building our own Android app, but changes the accepted phone-browser requirement. Generic plugin mobile support does not prove parity for custom editors, side panels or every visualization. [Dot access](https://learn.chatgpt.com/docs/dots#access), [plugin surfaces](https://learn.chatgpt.com/docs/plugins).

4. **Account access and consumption need checking.** The current Dot rollout covers eligible Pro 100/200/500 accounts outside EEA/UK/Switzerland, Business Premium, and admin-enabled Enterprise, with age and rollout conditions. Dot conversation is documented separately from ordinary ChatGPT limits; delegated Work/Codex use counts toward those products' limits. Deeper work has an allowance, without a complete numeric metering contract on the overview. This is not unlimited inference or a guaranteed available account feature. [Dots](https://learn.chatgpt.com/docs/dots).

5. **A workflow instruction is not an enforcement mechanism.** Skills can guide questioning and source use; they cannot guarantee invocation, perfect instruction-following, exact retrieval, or saving every desired record. Use explicit controls/tools for state transitions and evaluate the learning behavior on real interactions. [Build skills](https://learn.chatgpt.com/docs/build-skills), [MCP UI](https://developers.openai.com/plugins/build/chatgpt-ui).

6. **Cloud execution is not a service-level guarantee.** Saved schedules and source-supported monitoring exist, but docs do not establish exact-time alarm delivery, unrestricted event triggers, or database-grade retention for the Dot computer's files. A successful run is not itself proof the requested result was delivered. [Tasks](https://learn.chatgpt.com/docs/dots/tasks-and-memory), [computer environment](https://learn.chatgpt.com/docs/dots/computers-and-apps).

7. **UI still has engineering constraints.** Components run in a host-controlled iframe, with declared resource/network access. They cannot freely modify the ChatGPT shell or read all its internal data. Reliable editing, keyboard/phone behavior, stale views, retries and durable saves still need validation. Tools should remain usable when a rich component cannot render. [MCP UI](https://developers.openai.com/plugins/build/chatgpt-ui).

## Relation to the earlier MCP exploration

For the user's explicit historical question, only the relevant opening sections of the archived [Interface-Native Learning System brief](../archive/2026-10-03-legacy/NEWPLAN.md) were consulted. It proposed the host model doing the reasoning, a lightweight MCP server owning records, and MCP Apps supplying structured learning interactions. It also warned against making chat history, host memory or widget state the only authoritative record.

The current possibility has the same useful separation. Dots now document continuing personal context and cloud responsibilities; plugin packaging combines behavior and tools; extensions give persistent entrypoints/editors; Space provides an existing document surface; Sites can host MCP. These reduce integration and operational work compared with building those capabilities ourselves.

The old brief's flashcard/SRS emphasis and any unverified assumptions are not revived. The current notes/questions-first scope, optional Revisit, bounded brief, source distinctions and journal boundary remain the comparison criteria. This research proposes reuse of the separation of responsibilities, not legacy code or an archived product plan.

## Smallest useful feasibility experiment

Before replacing the architecture, run one real fragment/question/passage loop with an existing document surface and a cloud-compatible learning plugin. Use a genuine note and source, not a scripted mockup or a new interface testing exercise.

Evidence to collect:

- Open on Android with the personal computer off; identify whether the flow stays with Dot, uses a Page, or hands off to Work.
- Write without a model turn; ask a contextual question; distinguish the selected quote, expanded source context and authored text.
- Save an optional checkpoint; close and reopen on another device; locate the same note, source and continuation without re-explaining.
- Produce a trial finite brief using explicit current focus, an open Thread, fresh sources and available Dot context. Explain relevance, preserve citations, and save feedback.
- Try one tool-connected action if needed; confirm refresh and cross-device persistence. A generated button alone is not evidence of a saved change.
- Verify export/recovery and source fidelity; identify missing equation, code, table or attachment behavior.
- Keep journal data out of the experiment and record the remaining memory-isolation limitation. A handful of successful prompts cannot prove a hard purpose boundary.

Only after this personal flow works should we decide whether a custom editor, structured store, graph, or public plugin is justified. If expanding to disjoint users, separately test account authorization, private records, installation and usage limits. No experiment, installation, account access, schedule, or deployment was performed for this research.

## Evidence limits

This review used fetched official OpenAI product/developer documentation and targeted API discovery, plus the narrowly identified historical brief. Two research agents independently checked memory/runtime and plugin/UI boundaries. Claims about product fit are labeled recommendations or inferences. Documentation availability is not proof of availability in this account, direct rendering within Dot, Android success, durable save behavior, briefing quality or an accessible Dot API. The existing application and archived implementation were not used as the proposed architecture.
