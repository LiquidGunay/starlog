# Interface-Native Learning System: Exploration Brief

## Mission

Investigate existing MCP-based flashcard, quiz, tutoring, and learning systems before designing or implementing the new product.

The goal of this phase is not to build the final application. The goal is to:

1. run the strongest existing systems;
2. make them available for the user to test;
3. inspect how they are implemented;
4. evaluate them using the same learning workflows;
5. identify what they already solve well;
6. identify important missing capabilities;
7. propose a small number of differentiated product directions.

Treat the previous Starlog implementation as legacy. Do not reuse its application architecture, schemas, assistant runtime, interface code, or repository structure by default.

---

# 1. Current Product Requirements

## 1.1 Fresh implementation

The new system will be implemented from scratch.

The old `LiquidGunay/starlog` repository may be inspected for lessons, but:

* do not modify it during this exploration;
* do not design around compatibility with it;
* do not migrate its database;
* do not reuse its custom chat or mobile interfaces;
* do not preserve old product abstractions merely because they already exist.

Use a separate exploration workspace or repository.

## 1.2 ChatGPT text is the initial host

The initial target interface is ChatGPT text chat, particularly the web interface.

The system should eventually be capable of working with other MCP-compatible hosts, but do not compromise the first useful experience for speculative cross-host support.

Test portability where inexpensive, but optimize initial product experiments for ChatGPT.

## 1.3 No separate model API by default

Do not use OpenAI API credits, Anthropic API credits, Gemini API credits, locally hosted language models, or another inference service for the core learning workflows.

The host language model should perform:

* identifying candidate ideas from a conversation;
* generating quiz questions;
* generating distractors;
* critiquing cards;
* grading semantic responses;
* detecting misconceptions;
* explaining mistakes;
* adapting the next question;
* proposing recommendations;
* summarizing a completed session.

The MCP server should remain lightweight:

* CPU-only application logic;
* database storage;
* deterministic scheduling;
* deterministic filtering and constraints;
* MCP tools and resources;
* generative UI assets;
* authentication;
* simple scheduled jobs where needed.

A separate model API is permitted only as a documented fallback after:

1. a required workflow has been tested using the host model;
2. the host-model approach has a specific demonstrated blocker;
3. the cost and architectural consequences are documented;
4. the user explicitly approves the exception.

Do not introduce a model abstraction layer merely because one might eventually be needed.

## 1.4 Voice is out of scope

Do not build:

* speech-to-text infrastructure;
* text-to-speech infrastructure;
* a custom voice assistant;
* a Realtime API integration;
* a voice-specific mobile application.

Assume that existing voice hosts may eventually gain custom tool support. The learning core should be usable when that happens, but no workaround is required during this phase.

Phone dictation into an ordinary text conversation may be tested as a low-effort interaction, but it is not a separate product surface.

## 1.5 MCP Apps generative UI is the intended interaction layer

The product should expose its structured interactions through MCP Apps UI rendered inside the host conversation.

Likely interactions include:

* selecting what should be learned;
* editing learning intentions;
* authoring or refining cards;
* reviewing fixed flashcards;
* answering generated questions;
* revealing hints;
* submitting confidence;
* approving recommendations;
* viewing session feedback.

The UI should be supplied by the MCP server rather than recreated independently inside every host.

The official MCP Apps `basic-host` should be used as the baseline local testing environment. It can display tool input, tool output, app-to-host messages, and model-context updates. Remote-host testing can use a temporary HTTPS tunnel when appropriate.

## 1.6 The user controls the durable curriculum

The user should decide what becomes a durable learning obligation.

The model may propose things worth remembering, but proposed items must remain distinguishable from accepted items.

At minimum, distinguish:

* user-approved learning commitments;
* model recommendations awaiting a decision;
* transient captures and reference material;
* generated exercises used only for one session;
* durable fixed flashcards;
* rejected or retired learning material.

Do not silently turn conversations, documents, or recommendations into permanent flashcards.

## 1.7 Card creation is part of the learning process

Do not evaluate card generation only by how much effort it removes.

For important conceptual material, test workflows where:

1. the user selects the idea;
2. the user attempts to formulate what should be recalled;
3. the model critiques the formulation;
4. the user edits or approves the final result.

Automatic generation remains acceptable for mechanical material such as vocabulary, syntax, mappings, terminology, and dates.

## 1.8 SRS should be deterministic

Spaced-repetition eligibility, scheduling state, and due dates should be computed algorithmically.

The language model may provide evidence such as:

* correct or incorrect;
* partial understanding;
* confidence;
* detected misconception;
* answer completeness;
* apparent difficulty.

The model should not directly invent or write the next review date.

During exploration, compare FSRS-based implementations with simpler schedulers, but do not implement a new scheduler yet.

## 1.9 Quizzing should exploit the host model

Investigate whether the system can schedule a learning target rather than always scheduling a fixed question.

For example, the persistent target may be:

> Explain why reciprocal-rank fusion does not require calibrated relevance scores.

At review time, the host model might generate:

* direct free recall;
* a concrete retrieval scenario;
* a comparison with score normalization;
* a misconception-detection question;
* an implementation design question.

Determine when fixed prompts are superior and when regenerated prompts produce better evidence.

## 1.10 User-owned and inspectable data

Any eventual product should support:

* user-controlled storage;
* visible learning history;
* source provenance;
* editable learning items;
* export in a documented format;
* migration without dependence on a particular host.

ChatGPT conversation history, host memory, and widget-local state must not become the only authoritative copies of important learning state.

---

# 2. Questions This Exploration Must Answer

## 2.1 Host-model workflow

Determine whether ChatGPT can reliably perform the entire intelligence loop without another API:

1. retrieve eligible learning material from the MCP;
2. generate a structured exercise;
3. render it through an MCP UI tool;
4. receive the user’s UI interaction;
5. semantically evaluate a free-form response;
6. send feedback or remediation;
7. persist the resulting evidence through another tool call.

Pay particular attention to whether this works across multiple turns without losing the active widget or session.

## 2.2 UI-to-model round trip

Test the available mechanisms for returning user actions to the model:

* updating model context silently;
* sending a follow-up chat message;
* calling an app-only persistence tool;
* calling a model-visible tool;
* reopening or updating the same widget;
* associating multiple tool calls with the same session.

Determine which mechanism is appropriate for:

* simple deterministic grading;
* free-response semantic grading;
* requesting a new explanation;
* continuing an adaptive lesson;
* saving a completed review.

## 2.3 Model versus algorithm authority

Explore the correct boundary for each decision:

* What is due?
* What is eligible?
* What should appear in a five-minute session?
* Which due item is most important?
* What exercise form should test it?
* Was the answer correct?
* Did the user demonstrate understanding or merely recognition?
* Should the topic be tested at a deeper level next time?
* What new topic should be recommended?
* Should that recommendation enter the permanent curriculum?

Do not force one universal answer. Produce a decision table based on reversibility, reliability, semantic complexity, and user agency.

## 2.4 Fixed cards versus generated exercises

Compare:

* repeated fixed prompts;
* fixed learning targets with regenerated prompts;
* reusable exercise banks;
* entirely ephemeral generated questions;
* hybrid sessions containing all three.

Assess:

* cue memorization;
* grading reliability;
* question quality;
* source faithfulness;
* variety;
* latency;
* usefulness for conceptual transfer;
* user trust.

## 2.5 Recommendation scope

Investigate multiple recommendation levels:

1. ranking already-due material;
2. selecting among already-approved commitments;
3. suggesting a deeper learning activity;
4. suggesting an adjacent concept;
5. proposing an entirely new learning commitment.

Determine which levels may be automatic and which require explicit approval.

## 2.6 Consistency and adoption

Evaluate whether each system makes it easy to:

* begin a two-minute session;
* recover after missing several days;
* stop without losing progress;
* create one meaningful item without managing a deck;
* understand why something is being shown;
* reject irrelevant material;
* use the system without opening a separate application.

---

# 3. Projects to Investigate

## 3.1 Memora MCP

Repository: `Servation/memora-mcp`

Why it matters:

* inline MCP Apps review UI;
* flashcards, multiple-choice, and cloze modes;
* FSRS scheduling;
* due-first ordering;
* app-only grading tool;
* lightweight local JSON persistence;
* React and Vite single-file UI.

Memora’s UI calls an app-only grading tool that updates FSRS state, while its review and creation tools remain model-visible. This is the closest existing implementation of the basic SRS-plus-MCP-UI loop.

Questions:

* How cleanly can it run in ChatGPT rather than Claude?
* Does its interactive session remain stable across several cards?
* Can its UI pattern support open-ended answers?
* Does binary correct/incorrect grading lose important evidence?
* How much of its deck creation workflow is model-authored?
* Can the persistence and scheduling layers be separated from the deck model?
* What parts are worth borrowing under its license?

## 3.2 Lumo MCP App

Repository: `connorads/lumo-mcp-app`

Why it matters:

* adaptive tutor rather than conventional flashcard manager;
* interactive diagrams and mind maps;
* multiple-choice and recall exercises;
* follow-up messages that ask the model to continue or explain differently;
* pedagogically detailed tool descriptions.

Lumo explicitly follows an `Explore → Interact → Drill → Check → Adapt → Suggest` loop, and its quiz widget sends different follow-up messages after success and failure.

Questions:

* Can the adaptive conversational loop be connected to durable learning state?
* Does the model reliably respect its pedagogical tool descriptions?
* Does sending a follow-up message create excessive visible transcript noise?
* Can silent model-context updates replace some follow-up messages?
* Can its widgets be adapted to free recall and teach-back?
* What happens when the model generates a poor or ambiguous question?
* Verify the repository’s current license before copying code.

## 3.3 OpenAI Cards Against AI MCP example

Why it matters:

* ChatGPT-specific MCP Apps example;
* widget session binding;
* distinction between model-visible text and widget-visible structured data;
* keeping a live UI synchronized with repeated model actions;
* separate real-time state updates.

The example documents widget-session binding, tool response channels, app resource registration, and optional SSE updates.

Questions:

* Which ChatGPT-specific mechanisms are necessary?
* Can one learning session remain mounted while several questions are generated?
* Can UI state be updated without opening a fresh widget every turn?
* Which pieces use OpenAI-specific metadata rather than portable MCP Apps metadata?
* What breaks in another MCP Apps host?

## 3.4 `louislva/flashcards-mcp`

Why it matters:

* hosted remote MCP server;
* authentication;
* persistent projects and memory;
* flashcard CRUD;
* due retrieval and review ratings;
* documented ChatGPT installation.

Its tool surface separates persistent project context, flashcard management, due retrieval, answer reveal, and review recording.

Questions:

* How easy is the remote authentication flow?
* Does it provide an inline UI or rely on ordinary chat?
* How does it model projects and persistent memory?
* Is its hosted architecture still lightweight?
* What does the user experience feel like compared with Memora?
* Can the user edit and approve generated cards before saving them?

## 3.5 Anki MCP Server

Repository: `ankimcp/anki-mcp-server`

Why it matters:

* integration with a mature SRS system;
* conversational review;
* broad card, deck, media, and review tooling;
* explicit separation of due retrieval, presentation, answer reveal, and rating.

Its current tool surface includes due-card retrieval, presentation, rating, deck operations, note operations, statistics, and GUI automation.

Questions:

* Is the large tool surface useful or distracting?
* Does conversation improve review, or mostly wrap standard Anki?
* Which Anki concepts are essential and which are legacy complexity?
* How does it prevent revealing answers too early?
* How does it manage synchronization and review consistency?
* Can its data model represent conceptual learning targets rather than only notes/cards?

## 3.6 MCP Apps reference implementation

Repository: `modelcontextprotocol/ext-apps`

Use this as infrastructure, not a competing product.

Set up:

* `basic-host`;
* React example;
* app-only tools;
* model-context updates;
* follow-up messages;
* tool and resource inspection;
* local Streamable HTTP;
* optional temporary HTTPS tunnelling.

MCP Apps support model-visible, app-visible, or app-only tools, and the embedded UI can call server tools or send information back to the conversation.

---

# 4. Exploration Workspace

Create a new repository or local workspace separate from the old Starlog repository.

Suggested temporary name:

```text
learning-mcp-lab
```

Suggested structure:

```text
learning-mcp-lab/
├── README.md
├── DECISIONS.md
├── CAPABILITY_MATRIX.md
├── GAP_ANALYSIS.md
├── USER_TEST_GUIDE.md
├── findings/
│   ├── memora.md
│   ├── lumo.md
│   ├── cards-against-ai.md
│   ├── flashcards-mcp.md
│   └── anki-mcp.md
├── demos/
│   ├── memora/
│   ├── lumo/
│   ├── cards-against-ai/
│   ├── flashcards-mcp/
│   └── anki-mcp/
├── test-scenarios/
│   ├── standard-prompts.md
│   ├── sample-learning-data.json
│   └── scoring-rubric.md
├── evidence/
│   ├── screenshots/
│   ├── transcripts/
│   ├── network-logs/
│   └── run-results/
└── scripts/
    ├── setup-all.*
    ├── start-basic-host.*
    └── verify-no-model-api.*
```

Do not copy upstream source into the new product.

For each project:

* record the repository and exact tested commit;
* record the license;
* provide a repeatable setup script;
* provide an `.env.example` without secrets;
* provide a one-command start path where practical;
* document local ports;
* document how to expose the server for remote-host testing;
* provide cleanup instructions;
* preserve upstream changes as small patches or forks, not undocumented local edits.

---

# 5. Phase Zero: Capability and Account Preflight

Before evaluating products, verify the actual available host capabilities.

Record:

* ChatGPT plan and workspace type;
* whether Developer Mode is visible;
* whether a private custom MCP app can be created;
* whether write tools can be scanned and enabled;
* whether interactive UI renders;
* whether Memory can be enabled during app use;
* whether the app is web-only in the actual account;
* whether scheduled tasks can select or invoke the custom app;
* whether a remote HTTPS MCP endpoint is required;
* whether a secure tunnel or public test deployment is needed.

Do not infer these from documentation alone. Record screenshots or transcripts of the actual account behaviour.

If private ChatGPT app testing is unavailable:

1. continue local testing with `basic-host`;
2. test compatible upstream hosts where useful;
3. clearly label ChatGPT-specific questions as unresolved;
4. do not build a separate model API workaround;
5. determine whether access to an eligible ChatGPT workspace is required before product implementation.

---

# 6. Standard Test Scenarios

Use the same content for every relevant system.

## Sample topic

Use a narrow technical topic the user understands well enough to judge question quality, such as:

> Reciprocal Rank Fusion in hybrid retrieval systems

Prepare a short source packet containing:

* a concise explanation;
* one implementation example;
* one misconception;
* one comparison with score normalization;
* one application scenario.

## Scenario A: User-authored commitment

User says:

> I want to remember why RRF does not require calibrated scores. Help me formulate the learning item, but do not save anything until I approve it.

Evaluate:

* whether the system waits for approval;
* whether it asks what matters;
* whether it helps without taking over;
* whether edits are easy;
* whether provenance is retained.

## Scenario B: Generated factual cards

Ask for five mechanical cards from trusted material.

Evaluate:

* correctness;
* atomicity;
* ambiguity;
* duplication;
* ease of editing;
* whether generation is useful for low-judgment material.

## Scenario C: Fixed-card review

Review five cards.

Evaluate:

* reveal flow;
* answer leakage;
* grading controls;
* progress persistence;
* session continuation;
* due-date update.

## Scenario D: Free recall

Ask:

> Why can RRF combine BM25 and vector-search rankings without normalizing their raw scores?

Submit:

1. a strong answer;
2. a partially correct answer;
3. a plausible misconception;
4. an irrelevant answer.

Evaluate semantic grading consistency and feedback.

## Scenario E: Adaptive remediation

Answer incorrectly and observe whether the system:

* repeats the same explanation;
* gives a different analogy;
* generates a simpler question;
* identifies the misconception;
* returns to the concept later;
* changes durable scheduling state appropriately.

## Scenario F: Application

Present a retrieval-system design scenario and ask the user to choose between:

* raw score averaging;
* normalized score fusion;
* RRF;
* reranking.

Evaluate whether the system tests transfer rather than memorized language.

## Scenario G: UI-to-model continuity

Perform several UI actions:

* answer;
* request hint;
* answer again;
* ask for explanation;
* continue;
* finish.

Determine:

* what the model sees;
* what the server stores;
* whether the widget remains active;
* whether duplicate messages or widgets appear;
* whether refreshing loses state.

## Scenario H: Session recovery

Begin a session, stop midway, and reopen it.

Evaluate:

* whether progress is preserved;
* whether the user is punished with the full backlog;
* whether a minimal recovery session is possible.

## Scenario I: Recommendation

Provide the system with:

* one overdue card;
* one recent failure;
* one high-priority active topic;
* one adjacent unapproved topic.

Ask it what to study next.

Record:

* what was selected;
* why;
* whether a new topic was silently committed;
* whether the recommendation is inspectable;
* whether rejection affects future recommendations.

## Scenario J: No-model-API verification

For every demo:

* inspect environment variables;
* inspect source for model-provider SDKs;
* record outbound network traffic where practical;
* verify whether question generation came from the host model;
* identify any hidden server-side inference dependency.

Do not use paid model APIs merely to complete a demo.

---

# 7. Evaluation Rubric

Score each system from 0 to 5 on:

## Host and infrastructure

* ChatGPT compatibility;
* MCP Apps standards compliance;
* local setup quality;
* remote setup quality;
* mobile behaviour;
* session stability;
* lightweight hosting;
* authentication;
* absence of separate model API requirements.

## Learning workflow

* user control over what is saved;
* quality of card authorship;
* fixed-card review;
* SRS quality;
* free-recall support;
* semantic grading;
* application questions;
* adaptive remediation;
* interleaving;
* source grounding;
* evidence of learning depth.

## Product experience

* capture friction;
* review friction;
* clarity of UI;
* usefulness inside conversation;
* ease of restarting;
* explanation of “why now”;
* ability to reject recommendations;
* transcript cleanliness;
* phone usability where supported.

## Engineering

* code quality;
* test coverage;
* data model quality;
* persistence reliability;
* security model;
* answer leakage;
* exportability;
* license suitability;
* ease of extension;
* host-specific lock-in.

For every numeric score, provide at least one concrete observation.

---

# 8. Required Deliverables

## 8.1 Runnable demos

Provide runnable versions of the highest-value projects.

Each demo must include:

* exact tested commit;
* setup command;
* start command;
* local URL or MCP endpoint;
* test credentials or test-data instructions where safe;
* five sample prompts;
* known limitations;
* shutdown and cleanup steps.

The user should be able to test a demo without reading the upstream repository.

## 8.2 Per-project reports

Each report should contain:

1. product summary;
2. architecture;
3. tool inventory;
4. UI resources;
5. persistence model;
6. scheduling model;
7. model responsibilities;
8. host responsibilities;
9. user responsibilities;
10. successful test scenarios;
11. failed test scenarios;
12. notable code patterns;
13. license;
14. ideas worth borrowing;
15. ideas not worth borrowing.

## 8.3 Capability matrix

Create one comparison table covering all evaluated systems.

Do not compare only feature presence. Distinguish:

* implemented and verified;
* claimed but not verified;
* possible with modification;
* absent;
* blocked by host limitations.

## 8.4 Interaction transcripts

Preserve representative transcripts for:

* card creation;
* card editing;
* fixed review;
* free-response grading;
* adaptive remediation;
* recommendation;
* UI-to-model continuation.

Include screenshots of the associated widget states.

## 8.5 Gap analysis

Organize missing capabilities into:

### Already solved well elsewhere

Things the new product should probably reuse, copy under license, or avoid rebuilding.

### Solved poorly

Existing features that work but have serious UX, learning, or architecture weaknesses.

### Unsolved but important

Potential differentiation.

### Interesting but unnecessary

Features that are attractive but not required for the first product loop.

Pay particular attention to these hypotheses:

* user-owned learning commitments rather than generated decks;
* scheduling learning targets rather than only fixed prompts;
* regenerated application questions;
* preserving user participation in card formulation;
* source-grounded semantic grading;
* evidence of recall versus understanding versus application;
* bounded recommendations;
* recovery after inconsistency;
* lightweight subscription-powered intelligence;
* interface-independent durable state.

Do not assume these are all necessary. Test whether they create meaningful value.

## 8.6 Candidate product wedges

After completing the comparison, propose exactly three possible first products.

Each proposal must specify:

* target user problem;
* complete interaction loop;
* what existing products fail to provide;
* what the MCP server stores;
* what ChatGPT does;
* what the UI does;
* what deterministic algorithms do;
* what is deliberately omitted;
* likely adoption friction;
* largest technical uncertainty;
* smallest validating prototype.

Do not yet produce a full system architecture.

## 8.7 User decision packet

Prepare a final review document containing:

1. short demo links or launch commands;
2. five-minute testing instructions for each;
3. capability matrix;
4. major findings;
5. three candidate wedges;
6. decisions the user must make;
7. the agent’s recommended wedge and reasoning.

---

# 9. Operating Rules

* Prefer primary documentation and source code.
* Pin tested commits.
* Verify licences before copying code.
* Never place secrets in the repository.
* Use synthetic or non-sensitive learning data.
* Keep upstream modifications minimal.
* Do not quietly repair a project so extensively that the demo no longer represents it.
* Clearly distinguish native behaviour from behaviour added by the exploration adapter.
* Do not prematurely design the final database.
* Do not build a general note-taking system.
* Do not build a custom chat interface.
* Do not build a native mobile application.
* Do not add a model API.
* Do not treat generated flashcards as the default product.
* Do not choose the final name before the differentiation is understood.
* Document failed experiments; they are part of the result.

When an upstream project cannot be run after two materially different setup attempts, document the blockers and continue. Do not let one broken demo consume the entire exploration.

---

# 10. Exploration Order

Use this order:

1. ChatGPT capability/account preflight.
2. MCP Apps `basic-host` and reference examples.
3. Memora MCP.
4. Lumo MCP App.
5. OpenAI Cards Against AI example.
6. `louislva/flashcards-mcp`.
7. Anki MCP Server.
8. Cross-project standard test scenarios.
9. User demo session.
10. Gap analysis.
11. Three candidate product wedges.
12. Product and naming workshop.

Memora and Lumo should receive the deepest investigation because they represent the two most important poles:

* deterministic persistent review;
* adaptive model-led teaching.

The key product question is what becomes possible when those strengths are combined without letting the model silently own the curriculum.

---

# 11. Exit Criteria

The exploration is complete only when:

* at least three relevant demos run locally;
* at least two interactive MCP UIs are available for user testing;
* the actual ChatGPT custom-app capability has been verified or clearly documented as unavailable;
* the standard scenarios have been run consistently;
* the no-separate-model-API constraint has been tested;
* the UI-to-model semantic-grading loop has been demonstrated or shown to be blocked;
* every project has a licence and architecture note;
* a capability matrix exists;
* a gap analysis exists;
* three differentiated first-product wedges exist;
* no final architecture has been selected without user review.

The final output should help the user answer:

> What can existing MCP learning systems already do well, what important learning workflow is still missing, and what is the smallest product worth building?
