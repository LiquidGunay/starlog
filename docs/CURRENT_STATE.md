# Current state

Updated: 2026-10-03

## Product reset

[PLAN.md](../PLAN.md) is the sole product source. The user accepted the deliberate learning workspace direction and requested consolidation and archival.

The documentation reset provides the canonical plan, narrowed agent instructions, and a recoverable archive. The product and architecture preference interviews are recorded in PLAN.md, including a fresh Library, preserved legacy data, and MIT for new original code. The same plan now contains a concrete architecture proposal covering modules, records, execution flows, source layout, and validation order. That proposal is ready for review; it is not implementation evidence.

The new application is not implemented or deployed. Limited local feasibility evidence is recorded below; Firefox Android capture, real clipboard behavior, two-account isolation, request recovery, and workload priorities remain untested. ChatGPT integration eligibility, account inference, and web search remain unverified. The proposed product/ workspace and detailed module contracts remain subject to review and validation. No product workspace or new license file has been created.

The existing apps, services, packages, and capture tools are the legacy implementation. They have not been modified or validated as part of this documentation reset. Earlier build, phone, and production evidence is historical and cannot establish current readiness.

## Feasibility evidence and interface status

The user authorized delegated feasibility checks on 2026-10-03. Repeatable harnesses and full evidence are ignored under `.localdata/feasibility/` in the `codex/starlog-product-decisions` worktree; they are not application code or a second plan.

- **Model access:** Python 3.12.9 passed a local PKCE test vector and loopback callback round-trip, plus live unauthenticated OpenAI OIDC discovery and public verification-key retrieval. Evidence: `model-access/REPORT.md`, `readiness.py`, and `readiness.json`. No client registration, account consent, token validation, inference, native search, refresh, or hosted scheduling was tested. Personal Railway eligibility remains unresolved separately from OAuth mechanics; the next account check requires a newly granted Starlog session.
- **Capture/editor:** Defuddle 0.19.4, Tiptap 3.31.4, and JSDOM 26.1.0 were exercised on seven synthetic fixtures with Node 24.19.0: 14 assertions passed and one semantic-fidelity assertion failed. Structured document restoration was exact after import; that cannot recover an earlier extraction loss. Stock HTML import lost editable math; an explicit adapter preserved tested equations with retained LaTeX. For MathML without original LaTeX, a fraction became plain letters; this is an unresolved failure. Preserve original MathML and distinguish original from inferred LaTeX, with an explicit unsupported/read-only fallback until conversion fidelity is verified. Complex tables retained spans in structured storage but lost structure through Markdown. Image references survived, without downloading image bytes. Evidence: `capture-editor/REPORT.md`, `harness.mjs`, and `evidence/results.json`. These library checks do not establish real browser, clipboard, extension, authenticated-page, protected-attachment, or Android success.
- **Interface:** Today, Notebook, Reading, and the note/source-centered interaction are agreed at a high level. Detailed layouts and controls are still proposals. A disposable conversation sketch demonstrates writing, contextual discussion, optional saved outcomes, returning through a Thread, and review before revealing a note. Ten DOM interaction checks passed. The browser preview tool failed to initialize, so rendered layout and phone behavior were not verified. The sketch is not an approved visual reference or production UI.

## What exists to reuse selectively

- Draft Compelling Briefs and Socratic Learning instruction packages from the September 2026 personal skill pilot.

- A pilot report with mixed results and useful examples of answer leakage and prerequisite-teaching failures.

- The legacy application's code and documentation, available only as explicitly selected references.

The pilot artifacts are local to the owner's machine at C:/Users/bossg/Documents/Codex/2026-09-24/s/outputs/. Their presence does not mean the new app loads them or that they are proven improvements.

## Deployment boundary

The owner authorized merging the documentation reset on 2026-10-03, including the possibility of a Railway deployment triggered by master. The archived setup notes document these hooks, but the current hook configuration and hosted behavior have not been reverified. Future deployment or production changes still require approval under AGENTS.md.

PLAN.md is the entrypoint for subsequent work. Any remaining untracked NEWPLAN.md at the repository root is obsolete; remove that old entrypoint only after checking its hash against the archived copy. The archive manifest preserves the original content.

## Development skills

All 37 skills from mattpocock/skills at revision d81f3a183412e71a5b1e84ca21bc1a35eea03a60 are installed in the owner's Codex skills directory. All 101 upstream files were verified against their Git blob hashes; the MIT license and installation record are retained beside the installed skill folders.

These are development workflows, not Starlog's runtime briefing or tutoring skills. The grill-me/grilling workflow has been used to clarify the product. Engineering workflows can be configured after choosing the fresh workspace.

Research inspected existing daily briefs and primary documentation about memory, clipping, and feed access, plus learning evidence relevant to review. Current official documentation also describes Sign in with ChatGPT plan usage, self-hosted VM setup, and browser capture on Railway. This research informs the discussion; it does not establish Starlog eligibility, Railway compatibility, live integrations, account inference, learning outcomes, or a deployed app.

## Next evidence needed

- Work through architecture decisions in PLAN.md, including any scope tradeoffs revealed by concrete feasibility evidence.

- A verified intelligence path for the actual account and intended hosting arrangement.

- A working personal daily-use slice.

- Feedback from real use before broader feature or public-service expansion.
