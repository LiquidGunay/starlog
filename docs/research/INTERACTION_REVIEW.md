# Interaction references for Starlog

Reviewed 2026-10-04 · Product and learning/HCI literature review

[Canonical plan](../../PLAN.md) · [Visual reference atlas](interaction-atlas.html)

This review supports the detailed interface decision still open in PLAN.md. It does not change agreed scope, approve a layout, or authorize implementation. Personal, open-source Railway hosting is the accepted working assumption; this review does not investigate provider eligibility or establish hosted operation.

## What the review suggests

Starlog has useful precedents, but no single product is a complete model. The closest combination is Reader's distinction between incoming material and chosen reading; Heptabase's movement from source passages to authored ideas; NotebookLM's visible source scope; RemNote's explicit practice interactions; and Day One's writing entrypoints. Textfocals and iA Writer offer particularly useful ways to think about assistance and authorship. The evidence and qualifications for each follow below.

The main interface question is **what the user is working on at this moment**. A document, a question, a source passage, and a review attempt need different controls. A persistent discussion can connect them, but a chat transcript alone does not adequately represent all four. Conversely, a document-first interface should not make a person create and organize a note before asking a useful question.

My recommendation for the next design exercise is to compare three entrances into the same ongoing Thread: write a fragment, ask a question, and select a passage. Test whether each preserves the original material, makes assistance understandable, and leaves a recognizable place to return. This is a proposal for evaluation, not a newly accepted requirement.

A second distinction runs through the review: **reduce the work of managing information while preserving opportunities to think**. A visible passage, an automatic save, or a resumption cue can help cognition. Repeatedly guessing an unknown prerequisite, assigning tags before writing, or accumulating review debt is not inherently educational. Learning research supports testing particular forms of retrieval and explanation; it does not validate activity counts or an entire product category.

## How to read the evidence

- **Official walkthrough:** first-party documentation describes an interaction. It establishes documented behavior, not our successful use of the product.
- **Official illustration:** an identified screenshot, GIF, video, or public example. Unless stated otherwise, its link was found but the pixels or playback were not inspected. The atlas embeds selected original media and provides the owning page.
- **Research observation:** an empirical result, with population, task, and limits. Design implications below are inferences, not outcomes already established for Starlog.
- **Hands-on evidence:** none for competitor applications in this review. Browser inspection failed to initialize. No accounts, trials, private libraries, or native apps were accessed.

The Textfocals PDF is the exception for visual inspection: pages 4–5 were rendered and inspected. The figures are identified below. This establishes what the figures show, not operation of the prototype. Most current help pages have no reliable screenshot date; older launch material is labeled historical. Native mobile evidence is never treated as proof that a web app can deliver the same behavior.

## A short viewing tour

These eight references offer more value than browsing a long list of feature pages. The atlas puts selected media beside the observation to make.

| Reference | Artifact to inspect | Watch for |
| --- | --- | --- |
| Reader | [Contextual and expanded discussion](https://docs.readwise.io/reader/guides/ghostreader/global) | Whether the source remains easy to recover when the conversation grows. |
| Heptabase | [Worked reading-to-concepts example](https://wiki.heptabase.com/the-best-way-to-acquire-knowledge-from-readings) | The moment copied material becomes a separately named idea. |
| Obsidian | [Clipper walkthrough](https://obsidian.md/help/web-clipper/capture) and [math example](https://obsidian.md/images/clipper-math.jpg) | What is captured, what is edited before saving, and what remains a remote reference. |
| NotebookLM | [Learning Guide illustration](https://blog.google/innovation-and-ai/models-and-research/google-labs/notebooklm-student-features/) | Whether a learner can see the question, relevant sources, and available help together. |
| RemNote | [Generated-card selection](https://help.remnote.com/en/articles/10102901-generating-flashcards-with-ai) | The separate decisions to generate, retain, and begin learning. |
| Day One | [Templates](https://dayoneapp.com/guides/tips-and-tutorials/templates/) and [Go Deeper](https://dayoneapp.com/guides/labs/go-deeper/) | How writing starts, and how explicitly the user requests a follow-up. |
| Textfocals | [Paper, figure 1 on PDF page 4](https://ceur-ws.org/Vol-3660/paper17.pdf#page=4) | Which paragraph the assistant sees, and whether its question helps revision. |
| iA Writer | [Authorship controls](https://ia.net/writer/support/editor/authorship?platform=mac) | Whether quoted, generated, and personally written text remain distinguishable during editing. |

## Product studies

### 1. Reader: reading, deliberate attention, and contextual discussion

Reader explicitly distinguishes a Library of deliberately saved material from subscribed Feed content. Its documentation also separates Seen from Read and offers several Library arrangements, including Inbox/Later/Archive and Later/Shortlist/Archive. These are useful precedents for distinguishing retention, intention, and current attention. Starlog's Queue should remain a chosen subset of its Library; importing every saved item into an obligation would erase that distinction. [Adding content](https://docs.readwise.io/reader/docs/faqs/adding-new-content), [Library configurations](https://docs.readwise.io/reader/guides/workflows/library-configuration), [Feed states](https://docs.readwise.io/reader/docs/faqs/feed).

The documented Global Ghostreader flow moves between a reading sidebar and an expanded conversation. Citations can reveal an exact passage and navigate to it; conversations persist and can be searched. This is a strong reference for a discussion that stays connected to reading while allowing more room when necessary. Current documentation places library-wide use on desktop web; mobile support is narrower. [Global Ghostreader guide](https://docs.readwise.io/reader/guides/ghostreader/global).

Daily Digest brings selected Feed and Later material together. Its mobile presentation differs from web, and an iOS badge clears on viewing rather than accumulating missed-day debt. The documentation does not establish the exact finite ending, recommendation explanation, or reading-time budget Starlog needs. Treat it as a useful entrypoint reference, not a complete newspaper specification. [Daily Digest documentation](https://docs.readwise.io/reader/docs/faqs/daily-digest).

**Borrow:** stable source-to-discussion movement; distinct attention states; a simple return point. **Avoid:** importing swipe-through throughput as the goal. The 2022 launch GIFs are historical, and the associated emphasis on rapid feed triage is a poor match for deliberate inquiry. [Historical launch and demonstrations](https://blog.readwise.io/the-next-chapter-of-reader-public-beta/).

**Interaction to compare later:** read one paragraph, ask a question about it, expand the exchange, then return to that exact paragraph without searching again.

### 2. Heptabase: making ideas and connections deliberately

Heptabase separates cards from whiteboards: a card can appear in more than one board without becoming a duplicate document. Its worked reading example moves selected material from a book card into separately named concept cards, which can then be arranged and connected. This offers a concrete analogue for notes participating in Threads. It does not imply that Starlog needs a canvas to express that relationship. [Fundamental elements](https://wiki.heptabase.com/fundamental-elements), [Reading workflow with screenshots](https://wiki.heptabase.com/the-best-way-to-acquire-knowledge-from-readings).

The AI guide exposes selected cards or board context and allows useful conversation material to be retained as cards. PDF annotation offers a distinct source-highlight object that can be referenced from writing. Together, these illustrate how source evidence, discussion, and authored ideas can stay near each other without being identical objects. The documentation does not establish how authorship remains visible after every subsequent edit. [Working with AI](https://wiki.heptabase.com/work-with-ai), [PDF annotation](https://wiki.heptabase.com/pdf-annotation).

**Borrow:** write a meaningful idea, preserve its source, and choose a connection. **Avoid:** requiring spatial arrangement or a polished atomic note before an early fragment can be useful. Its journal-to-inbox workflow is not appropriate for Starlog's strict journal boundary. [Journal workflow](https://wiki.heptabase.com/three-ways-to-make-sense-of-your-fleeting-thoughts-in-journal).

**Artifacts:** the Mindstorms walkthrough has paired screenshots and a [public board](https://app.heptabase.com/w/d229915bd30fbf3b7af9db9a539856e73ebcb13c7d89012a891b9e15be1343d7). The walkthrough is historical, updated in 2024; the public board was not operated. Current mobile/deep-link documentation should be consulted separately rather than inferring phone behavior from its desktop images. [Deep links](https://support.heptabase.com/en/articles/11176386-use-deep-links).

### 3. Obsidian: low-friction writing and inspectable clipping

Obsidian's Quick Switcher combines returning to a recent note, searching, and creating an unmatched note. Inline links can target headings or blocks, while backlinks expose existing links and unlinked textual mentions. These patterns reduce the need to choose a folder or visit a graph before writing. Unlinked mentions are a lexical affordance, not evidence of a meaningful conceptual connection. [Quick Switcher](https://obsidian.md/help/plugins/quick-switcher), [Internal links](https://obsidian.md/help/links), [Backlinks](https://obsidian.md/help/plugins/backlinks).

The Clipper captures a page, selection, or highlights into an editable capture form before saving. Images normally remain references to their online locations unless downloaded. This makes the capture contract visible: saved text and a durable offline copy of every asset are different things. Obsidian writes the result into notes; Starlog can borrow the capture interaction while retaining its separate raw-source role. [Capture documentation](https://obsidian.md/help/web-clipper/capture).

**Borrow:** immediate writing, quick return, selected-passage linking, and a capture preview that exposes what will be retained. **Avoid:** making users learn an object taxonomy, process every clip, or maintain a global graph to benefit. Mobile toolbar and navigation examples are inspiration only; Obsidian is a native app and its capabilities do not demonstrate Starlog PWA behavior. [Mobile documentation](https://obsidian.md/help/mobile).

**Artifacts:** the [official Clipper page](https://obsidian.md/clipper) includes examples of [article capture](https://obsidian.md/images/clipper-cookie.jpg), [a table](https://obsidian.md/images/clipper-matrix.jpg), and [mathematics](https://obsidian.md/images/clipper-math.jpg). They illustrate intended output, not fidelity tests for our extraction/editor stack.

### 4. NotebookLM: visible source scope and learning-oriented discussion

Current Google help describes choosing sources with checkboxes, cited answers that open source context, and a Learning Guide conversation style. A saved response can become a note while retaining citations. This is relevant to Starlog because a discussion should make its evidential scope understandable, especially when a question concerns one passage rather than the entire Library. [Chat and source scope](https://support.google.com/gemininotebook/answer/16179559?hl=en).

Google also distinguishes authored notes from saved response notes, and separately allows a note to become a source. The current guide describes saved-response notes as non-editable and lists limitations for note creation on mobile. These distinctions are useful references, not a reason to copy every restriction. The help URLs now redirect to a Gemini Notebook namespace; this review makes no inference about a rename announcement or rollout date. [Notes documentation](https://support.google.com/gemininotebook/answer/16262519?hl=en).

**Borrow:** a visible context selection, inspectable citations, and a deliberate transition from an answer to retained material. **Avoid:** importing a source-upload-first workflow as the only entrance. Starlog also needs to welcome a user's unaided question and half-written idea.

**Artifacts:** Google's September 2025 [Learning Guide illustration](https://storage.googleapis.com/gweb-uniblog-publish-prod/images/Learning_Guide_UI.width-1200.format-webp.webp) and November 2025 [quiz/flashcard announcement](https://blog.google/innovation-and-ai/models-and-research/google-labs/notebooklm-app-quizzes-flashcards/) show dated interfaces. The [current quiz guide](https://support.google.com/gemininotebook/answer/16958963?hl=en) describes hints, explanations, and retrying missed questions; it does not establish a formal spaced-repetition system or learning efficacy.

### 5. RemNote: assistance, an attempt, and an explicit review commitment

RemNote's AI tutor can work alongside documents or practice, with selected context and citations. Its generated-card flow previews candidate cards and allows selection before retaining them. Retained cards can wait in Need to Learn before the user begins learning them. That separation is more relevant to Starlog than importing the entire flashcard system: generating something useful need not immediately create an obligation. [AI tutor](https://help.remnote.com/en/articles/10103884-ai-tutor-chat), [Generating flashcards](https://help.remnote.com/en/articles/10102901-generating-flashcards-with-ai).

Practice normally allows mental recall before Show Answer and a scheduling judgment. Typed answers are optional, with grading choices and user correction. Separate practice modes have different effects on scheduling. These details matter: displaying an answer, recognizing it, producing it, and committing to repeat it are not interchangeable actions. [Spaced repetition basics](https://help.remnote.com/en/articles/6022755-getting-started-with-spaced-repetition), [Typed answers](https://help.remnote.com/en/articles/7752298-typing-in-answers), [Scoped practice](https://help.remnote.com/en/articles/6904503-practicing-specific-flashcards).

**Borrow:** attempt before reveal; usable escape routes; inspect generated material before choosing it. **Avoid:** a due-count-centered home, streaks, or automatic card creation from every useful conversation. The first pilot's optional Revisit can ask for an explanation or application without a deck.

**Artifacts:** use the screenshots in the linked help pages in sequence. Their direct image URLs are signed and expire, so the atlas deliberately links the stable owning pages rather than presenting those URLs as durable assets.

### 6. Day One, with Rosebud and Reflection as contrasts: writing before interpretation

Day One offers visible daily prompts and editable templates, including a short one-sentence format. Templates become writing content rather than requiring a large form. Go Deeper is an explicit action that offers questions based on the current entry; the user can insert a chosen prompt or dismiss it. It can be used while editing, so it is not evidence of a strict after-save boundary. [Daily prompts](https://dayoneapp.com/guides/tips-and-tutorials/daily-writing-prompts/), [Templates](https://dayoneapp.com/guides/tips-and-tutorials/templates/), [Go Deeper](https://dayoneapp.com/guides/labs/go-deeper/).

**Borrow:** one readily available writing place, stable questions, and a separately requested follow-up. **Avoid:** importing journal contents into general learning context. Day One's wider AI and Daily Chat capabilities must not be confused with the narrower current-entry example. Its reminders are native-platform features; its guide does not offer web reminders. [AI features](https://dayoneapp.com/guides/labs/ai-features/), [Reminders](https://dayoneapp.com/guides/tips-and-tutorials/reminders/).

Rosebud illustrates a different default: its guide describes automatic reflections after entries and alternative follow-up styles. Its web/mobile draft limitation also shows why a promise to synchronize entries is not enough to establish reliable unfinished writing. A save-only, no-inference path was not established by the reviewed documentation. [Entry reflection](https://help.rosebud.app/ai-analysis/entry-reflection), [Dig Deeper](https://help.rosebud.app/tools-for-growth/dig-deeper), [Entry history](https://help.rosebud.app/daily-journaling/entry-history).

Reflection's shipped changelog describes excluding private entries from AI use and keeping writing intact during interruptions. Its announced v7 interface was still a future preview as of this review, not a shipped reference. These are useful boundaries to inspect, not a reason to introduce additional journaling features. [Shipped privacy controls](https://www.reflection.app/changelog/inline-ai-coach-privacy-controls-and-smoother-writing), [Reliability changes](https://www.reflection.app/changelog/smoother-sign-in-a-more-reliable-app-and-a-sharper-coach), [September 30 v7 preview](https://www.reflection.app/blog/coming-soon-reflection-v7).

### 7. Textfocals: assistance beside the user's writing

Textfocals is a research Word add-in, not a mature product benchmark. Figure 1 places a writer's document beside selectable prompt actions and generated views; the interface exposes paragraph scope and supports pinning views. In its four-participant formative study, people misunderstood highlighting and were uncertain about what context the model saw. Figure 2 describes a writing, reflection, and revision loop. The study does not establish improved learning. [Paper and figures, 2024](https://ceur-ws.org/Vol-3660/paper17.pdf).

**Borrow:** assistance that responds to something the user is already thinking about, with visible scope. **Avoid:** refreshing a wall of suggestions whenever the cursor moves or expecting the user to diagnose a hidden context mistake. For Starlog, inspect whether a question refers to the selected passage, the current note, or the wider Thread. This is an interface hypothesis drawn from the observed confusion.

**Artifact:** PDF page 4, figure 1, was visually inspected; page 5, figure 2, was also inspected. The paper is CC BY 4.0. The separate chat comparison and editable prompt controls are visible in the figure, but they were not operated.

### 8. iA Writer: provenance during writing

The current macOS Authorship guide distinguishes human contributions, AI text, and references visually. Authors are assigned through explicit marking and paste actions; this is not an AI detector. Its export behavior is also instructive: ordinary Markdown and several document exports do not preserve the authorship metadata. [Current Authorship guide](https://ia.net/writer/support/editor/authorship?platform=mac).

**Borrow:** distinguish model contribution and quoted material where editing happens, without repeatedly asking the user to reconstruct origin. **Avoid:** treating an edit to generated text as proof of understanding, or assuming provenance survives every export. Starlog need not reproduce word-level color treatment; a clearly labeled model contribution or retained source relationship may be enough initially.

**Artifacts:** [Paste As](https://static.ia.net/2025/10/Writer-Mac-Autorship-Paste-As.webp) and [Authorship menu](https://static.ia.net/2025/10/Writer-Mac-Autorship-Focus-Menu-1.webp), linked from the current guide. Its older launch description uses a different visual treatment; use the current guide when comparing the interaction.

## Secondary references with a narrower purpose

| Product / prototype | Useful comparison | Boundary for Starlog |
| --- | --- | --- |
| **Capacities** | [Reading workflow](https://docs.capacities.io/reference/use-cases/reading-workflow): a highlight can acquire a personal comment and a concept link. [AI guide](https://docs.capacities.io/reference/ai-assistant): contextual conversations can be retained and found. | Avoid making object types prerequisite knowledge. The AI guide and its FAQ conflict about automatic saving versus Save as object; do not treat that transition as verified. |
| **LiquidText** | [Official demonstrations](https://www.liquidtext.net/liquidtextadeeperdive) make excerpts and links to their original documents tangible. | Study provenance and side-by-side comparison, not a large workspace by default. Its native product is not evidence of Android or web feasibility. [Platforms](https://law.liquidtext.net/get-started/). |
| **Inoreader** | [Reading progress and archiving](https://www.inoreader.com/blog/2024/11/build-active-reading-habits.html); [automated reports](https://www.inoreader.com/blog/2026/03/automated-intelligence-reports-for-insights-delivered-to-you.html) let a person choose inputs, schedule, and preview. | A bounded input set does not establish a compelling ten-minute edition. Keep curation inspectable and let source retention survive removing a reading commitment. |
| **Feedbin** | [Three-column reading](https://feedbin.com/blog/2019/07/08/three-columns/) and [visible-page capture](https://feedbin.com/blog/2025/07/30/browser-extension/) offer simpler alternatives to an AI-heavy home. | Reading state can also be changed by automation; it should not stand in for comprehension. A desktop arrangement is not the phone design. |
| **Feedly** | [Refining a recommendation](https://docs.feedly.com/article/549-refining-feedly-ai-feeds) and [mute filters](https://feedly.com/new-features/posts/feedly-ai-and-mute-filters) expose more specific control than a generic dislike. | Distinguish disinterest in a topic from duplicate coverage or a poor source. Do not import an enterprise query builder into the pilot. |
| **Orbit / Quantum Country** | [The public essay](https://quantum.country/qcvc) embeds recall in reading; [Orbit](https://docs.withorbit.com/) preserves source context around review prompts. | Optional participation matters. The creator's [critique of imposed prompts](https://notes.andymatuschak.org/zR5H2t4iYJECveXmu1DnYvS) is a valuable counterpoint to mandatory collection. This experimental platform is not evidence for Starlog adoption. |
| **Allume, formerly Muse** | [Current official site](https://allume.com/) illustrates an inbox and nested spatial boards for mixed material. | A useful spatial alternative to inspect, not a requirement for an infinite canvas. The advertised native Apple experience does not establish a web/Android route. |

These are selected precedents rather than an exhaustive market census. Products were included for a concrete interaction relevant to the accepted plan, not their popularity or number of AI features.

## What learning and HCI research actually supports

The evidence below concerns specific tasks and populations. None demonstrates Starlog's effectiveness or a sustainable daily habit. The last column records a design inference to test.

| Primary evidence | Finding and important limit | Interface implication to test |
| --- | --- | --- |
| [Karpicke & Blunt, 2011](https://learninglab.psych.purdue.edu/downloads/2011/2011_Karpicke_Blunt_Science.pdf), two experiments, 80 and 120 undergraduates | Retrieval after science reading outperformed comparison study activities on delayed questions, including inferences. This does not show that all mapping is ineffective or establish broad real-world transfer. | Revisit can ask for a causal explanation or comparison before revealing prior work; it need not be a factual flashcard. |
| [Pan & Rickard, 2018](https://rickardlab.ucsd.edu/pdf/PR_2018.pdf), original meta-analysis, 122 experiments / 10,382 participants | Transfer from retrieval was positive on average and depended on the task, successful retrieval, and other conditions. Learning one response does not guarantee flexible understanding. | Include a changed example or application when appropriate; do not infer mastery from repeating a definition. |
| [Chi et al., 1994](https://education.asu.edu/sites/g/files/litvpz656/files/lcl/chideleeuwchiulavancher_3.pdf), 14 prompted pupils and 10 controls | Explaining a circulatory-system text was associated with stronger understanding. Study time differed substantially, and posttests allowed text or notes. This is not clean evidence of unaided retention. | Offer a meaning-making prompt beside a passage; do not force an explanation after every clip. |
| [Graesser & Person, 1994](https://journals.sagepub.com/doi/10.3102/00028312031001104), tutoring dialogue analysis | Question quality, rather than quantity, correlated with achievement after tutoring experience. This is observational; only the publisher abstract was accessible in this review. | A better question can be an outcome. Do not use question counts or dialogue length as progress measures. |
| [Klahr & Nigam, 2004](https://journals.sagepub.com/doi/10.1111/j.0956-7976.2004.00737.x), 112 children | Direct instruction taught a controlled-experiment procedure to more pupils than discovery. Successful learners from both conditions transferred it to a richer task. The result is specific to this instruction and population; full PDF retrieval failed. | Keep prerequisite explanations and direct help available. Repeatedly rephrasing an unanswerable question is not a Socratic method. |
| [Butler, Karpicke & Roediger, 2007](https://learninglab.psych.purdue.edu/downloads/2007/2007_Butler_Karpicke_Roediger_JEPA.pdf), two experiments, 48 and 40 undergraduates | In factual multiple-choice tasks, repeated guessing did not outperform showing the correct answer; delayed feedback helped later recall. This does not justify delaying essential help during inquiry. | Permit a genuine attempt, then useful feedback. Let the person request help rather than imposing successive guesses. |
| [Bastani et al., 2025](https://pmc.ncbi.nlm.nih.gov/articles/PMC12232635/), nearly 1,000 high-school mathematics students | Both AI conditions improved supported practice. General chat harmed later unaided exam performance relative to control; a teacher-informed guarded tutor removed that harm without a detectable exam advantage over control. | Keep guided success distinct from an independent attempt. Evaluate the actual tutoring behavior rather than assuming guardrails guarantee learning. |
| [Kestin et al., 2025](https://www.nature.com/articles/s41598-025-97652-6), college physics crossover study, 194 eligible students | A purpose-built tutor produced stronger immediate posttests in two lessons than the comparison active-learning classes. It used expert-designed instructional material and scaffolding. It was not generic chat or a semester-long retention test. | Invest in behavior examples, feedback, and content quality. Neither a chat layout nor a model name is a tutoring method. |
| [Kirsh & Maglio, 1994](https://adrenaline.ucsd.edu/kirsh/Articles/CogsciJournal/DistinguishingEpi_prag.pdf), Tetris observations and modeling | Actions can change an external representation to make thinking easier. This supplies no learning-effect estimate for note graphs. | Keep useful passages visible and allow comparison. Reducing reconstruction work can support thought; all cognitive offloading is not harmful. |
| [Trafton et al., 2003](https://www.gregtrafton.com/papers/preparing.to.resume.pdf), 17 adults in a laboratory task | An interruption warning helped people prepare to resume, with differences diminishing through practice. It did not test generated summaries, daily habits, or multi-day returns. | Test an optional next-step cue and restoration of relevant context. Do not claim a checkpoint has solved continuity until actual returns improve. |

Two research interfaces add useful counterpoints. **Sensecape** compared spatial exploration with a chat-plus-canvas baseline in a 12-person study; reported exploration and perceived utility are not evidence of delayed learning. Its [paper figures](https://hci.ucsd.edu/papers/sensecape.pdf) can help compare levels of detail without committing to a global graph. **VIKI** offers a historical example of spatial organization expressing provisional relationships; its [author-hosted project](https://people.engr.tamu.edu/shipman/viki/index.html) is an interface reference, not a verified runnable contemporary product.

The practical correction to the earlier SRS discussion is modest: retrieval can help conceptual understanding, but scheduling, question quality, and transfer are separate concerns. That supports the agreed lightweight Revisit; it does not reopen formal SRS as a pilot requirement.

## What to decide through concrete interaction examples

The review does not require another broad scope interview. It suggests six short design exercises using realistic material. A throwaway prototype can compare these without implementing accounts, providers, or the database.

1. **Start with an incomplete thought.** Type two lines, then ask a question. Compare a note-centered workspace with a Thread-centered opening. Can the person begin without titling, tagging, or polishing? Does their initial question remain identifiable?
2. **Start from a passage.** Clip an article paragraph containing an equation or table, ask about one part, and request a source. Compare discussion beside the material with a phone-sized transition into a separate discussion view. Can the person tell what context is included and return to the exact passage?
3. **Use help without surrendering the inquiry.** Try an explanation, get a non-leading question, then discover a missing prerequisite. Are “give me a hint,” “explain this,” and “stop here” understandable without a mode selector dominating the page? Can revising the question itself be the outcome?
4. **Leave and return.** Close mid-discussion and return the next day. Compare restoring the last working position with an optional next-step cue. Does the cue save reconstruction, or does it produce another summary to read? No compulsory wrap-up should be needed.
5. **Revisit something chosen.** Attempt an explanation before opening the earlier answer, request a hint if needed, then compare. Does the UI distinguish remembering, recognizing, and learning from supplied help without grades or a due backlog?
6. **Finish a bounded daily activity.** Read an edition, keep one item, reject one for a specific reason, and finish. Separately, answer a nightly journal prompt and save without AI. Are the stopping points clear, and do neither activity nor missed days manufacture obligations?

For each exercise, inspect the first meaningful action, where context becomes unclear, what survives leaving, and what the person feels expected to do next. These are evaluation observations, not an analytics or scoring specification. Try the desktop and narrow phone view separately; collapsing desktop panels into tabs is a hypothesis to test.

Three layout candidates remain credible: a note with contextual discussion, a Thread overview that opens the current piece of work, and a reader that opens a discussion around a passage. They can share underlying records without forcing identical entry flows. The previous conversation sketch is one candidate, not the default winner.

## Synthesis to carry into the next conversation

- Make it easy to begin with writing, a question, or a passage; do not require prior organization.
- Keep source evidence, the user's attempt, and model assistance understandable while they are used, not only in an audit view.
- Separate saving from committing attention, and generated review material from a commitment to practice.
- Let inquiry produce a revised question, a partial explanation, or an unresolved next step. A polished note is optional.
- Give direct help when needed and preserve a later chance for independent thought.
- Provide places to stop: a finished edition, a saved journal entry, a paused inquiry. Avoid making daily use synonymous with clearing a queue.

These are recommendations grounded in the review and compatible with the accepted direction. Record any subsequently accepted interface decisions in PLAN.md; do not let this research document become a competing product plan.

## Artifact and evidence maintenance

The atlas embeds or links original public media from the cited owners; it does not contain recreated competitor screenshots. Media may change or become unavailable. Every exhibit includes an owning source page so the reference remains inspectable if a CDN link fails. Embedded media requires network access and contacts its original host. No competitor media was downloaded to work around browser restrictions.

Research handoffs and the rendered Textfocals inspection files are ignored under `.localdata/interaction-research/`. They are working evidence rather than portable product dependencies. The public paper and source pages above are the durable references. Product features can change; refresh only the relevant reference when it is used for an actual interface decision.
