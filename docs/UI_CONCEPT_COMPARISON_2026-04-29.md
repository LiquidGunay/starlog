# UI Concept Comparison - 2026-04-29

This comparison is based on current `master` after PR #178 (`9f439c5bebf50de808579bfd0a2e3da30b34c68c`), the concept pack in `artifacts/ui-concept/`, and screenshots captured with the existing Playwright UI functional harness where possible.

Current screenshots are stored in:

```text
artifacts/ui-comparison/2026-04-29/
artifacts/phone-current/2026-04-29/
```

Concept references are stored in:

```text
artifacts/ui-concept/pwa/
artifacts/ui-concept/mobile/
```

## Screenshot Inventory

| Surface | Current screenshot | Concept target |
| --- | --- | --- |
| PWA Assistant cockpit | [pwa-assistant-cockpit-current.png](../artifacts/ui-comparison/2026-04-29/pwa-assistant-cockpit-current.png) | [Assistant Cockpit.png](../artifacts/ui-concept/pwa/Assistant%20Cockpit.png) |
| PWA Assistant thread | [pwa-assistant-thread-current.png](../artifacts/ui-comparison/2026-04-29/pwa-assistant-thread-current.png) | [Assistant Normal Thread.png](../artifacts/ui-concept/pwa/Assistant%20Normal%20Thread.png) |
| PWA dynamic panel | [pwa-assistant-dynamic-panel-current.png](../artifacts/ui-comparison/2026-04-29/pwa-assistant-dynamic-panel-current.png) | [Dynamic Panels Board A.png](../artifacts/ui-concept/pwa/Dynamic%20Panels%20Board%20A.png) |
| PWA Library | [pwa-library-current.png](../artifacts/ui-comparison/2026-04-29/pwa-library-current.png) | [Library Main Surface.png](../artifacts/ui-concept/pwa/Library%20Main%20Surface.png) |
| PWA Library detail | [pwa-library-artifact-detail-current.png](../artifacts/ui-comparison/2026-04-29/pwa-library-artifact-detail-current.png) | [Library Artifact Detail.png](../artifacts/ui-concept/pwa/Library%20Artifact%20Detail.png) |
| PWA Planner | [pwa-planner-current-failure.png](../artifacts/ui-comparison/2026-04-29/pwa-planner-current-failure.png) | [Planner Main Surface.png](../artifacts/ui-concept/pwa/Planner%20Main%20Surface.png) |
| PWA Review | [pwa-review-current.png](../artifacts/ui-comparison/2026-04-29/pwa-review-current.png) | [Review Main Surface.png](../artifacts/ui-concept/pwa/Review%20Main%20Surface.png) |
| Mobile Assistant conflict | [mobile-assistant-conflict-current.png](../artifacts/ui-comparison/2026-04-29/mobile-assistant-conflict-current.png) | [Assistant Chat Schedule Conflict .png](../artifacts/ui-concept/mobile/Assistant%20Chat%20Schedule%20Conflict%20.png) |
| Mobile Assistant activity | [mobile-assistant-tool-activity-current.png](../artifacts/ui-comparison/2026-04-29/mobile-assistant-tool-activity-current.png) | [Assistant Morning Focus.png](../artifacts/ui-concept/mobile/Assistant%20Morning%20Focus.png) |
| Mobile Library | [mobile-library-current.png](../artifacts/ui-comparison/2026-04-29/mobile-library-current.png) | [Library Main Surface.png](../artifacts/ui-concept/mobile/Library%20Main%20Surface.png) |
| Mobile Library detail tap failure | [mobile-library-detail-tap-failure-current.png](../artifacts/ui-comparison/2026-04-29/mobile-library-detail-tap-failure-current.png) | [Library Artifact Detail.png](../artifacts/ui-concept/mobile/Library%20Artifact%20Detail.png) |
| Mobile Planner | [mobile-planner-current.png](../artifacts/ui-comparison/2026-04-29/mobile-planner-current.png) | [Planner Main Surface.png](../artifacts/ui-concept/mobile/Planner%20Main%20Surface.png) |
| Mobile Review | [mobile-review-current.png](../artifacts/ui-comparison/2026-04-29/mobile-review-current.png) | [Review Main Surface.png](../artifacts/ui-concept/mobile/Review%20Main%20Surface.png) |
| Native phone Assistant | [native-phone-current-state.png](../artifacts/ui-comparison/2026-04-29/native-phone-current-state.png) / [starlog-active-current.png](../artifacts/phone-current/2026-04-29/starlog-active-current.png) | [Assistant Morning Focus.png](../artifacts/ui-concept/mobile/Assistant%20Morning%20Focus.png) |
| Native phone Library | [starlog-library-current.png](../artifacts/phone-current/2026-04-29/starlog-library-current.png) | [Library Main Surface.png](../artifacts/ui-concept/mobile/Library%20Main%20Surface.png) |
| Native phone Planner | [starlog-planner-current.png](../artifacts/phone-current/2026-04-29/starlog-planner-current.png) | [Planner Main Surface.png](../artifacts/ui-concept/mobile/Planner%20Main%20Surface.png) |
| Native phone Review | [starlog-review-current.png](../artifacts/phone-current/2026-04-29/starlog-review-current.png) | [Review Main Surface.png](../artifacts/ui-concept/mobile/Review%20Main%20Surface.png) |

The fresh native phone screenshots were captured from device `9dd62e84` with the app foregrounded. The earlier black screenshot was a locked-device capture and is no longer representative. `adb shell svc power stayon true` exited with code `137`, and `settings put global stay_on_while_plugged_in 3` is blocked by Android's `WRITE_SECURE_SETTINGS` guard on this device, so the repeatable phone-capture path is to wake the device with ADB immediately before each screenshot.

## Executive Read

The current PWA is much closer to the concept than the mobile surface. Assistant, Library, and Review have meaningful product structure: the Assistant has cockpit/thread modes, ambient updates, compact tool activity, and schema-driven panels; Library has a capture pipeline and provenance detail; Review has a learning ladder, reveal/grade flow, and learning-insight cards.

Native mobile is closer to the concept than the Playwright mobile-width screenshots suggested, but it still needs major visual work. The phone shows the right four-surface shell and real Assistant decision panel, yet the Library, Planner, and Review still carry too much explanatory text and dense stacked content compared with the concept's calmer, one-decision-at-a-time phone grammar. The Playwright mobile-width screenshots remain useful for repeatable PWA fallback checks; they should not be treated as proof of the native app's current visual state.

## PWA Assistant

What matches the concept:

- The Assistant is now the primary operating surface rather than a runtime console.
- The empty state opens to a Today-style recommendation, not a blank chatbot.
- The cockpit contains a recommended next move, reason stack, at-a-glance context, quick actions, and right-rail open loops.
- The thread view supports user messages, assistant prose, assistant cards, ambient rows, collapsed tool activity, and structured interrupt panels.
- Dynamic panels are rendered from assistant interrupt data, which matches the concept requirement that panels remain schema-driven.

Gaps against the concept:

- The cockpit still feels more like a dense status board than a calm single next move. The concept wants prioritization to dominate the first viewport.
- The right rail is useful but not yet visually as quiet or consistent as the concept's Now / Open loops / Context / Suggestions grammar.
- The visual system still carries some old implementation class names and dense panel styling. This does not surface as runtime copy, but it still affects layout instincts.
- The Assistant mobile concept says the phone should not compress the desktop cockpit. That rule is only partly enforced by the PWA/mobile-width implementation.

Implementation direction:

- Keep the current contracts and renderer path.
- Continue reducing always-visible explanatory copy. The concept markdown explains intent; the shipped UI should show decisions, concise reasoning, and actions.
- Make the first viewport answer one question: "What should I do now?"

## PWA Dynamic Panels

What matches:

- The core panel anatomy exists: title, reason/body, fields, recommended defaults, consequence preview, primary action, and dismiss/defer path.
- Current coverage includes morning focus, schedule conflict, task detail, capture triage, review grade, clarification, defer, and project picker variants.
- The renderer hides raw protocol labels from the user and keeps diagnostic language out of normal flow.

Gaps:

- Panels are functional, but the concept panels look more polished and less form-like.
- Some variants still need stronger consequence previews and clearer "why Starlog is asking" language.
- Mobile bottom-sheet behavior is not yet a distinct native interaction pattern; current work is primarily inline.

Implementation direction:

- Do not create bespoke panels per feature unless the structure truly differs.
- Continue extending `AssistantInterrupt` metadata conservatively rather than inventing a parallel frontend-only modal model.

## PWA Library

What matches:

- Library is framed as a capture and conversion pipeline, not only a file browser.
- The main view distinguishes inbox/unprocessed captures, recent artifacts, notes/saved items, sources, context, and suggestions.
- Actions use the correct product verbs: summarize, make cards, create task, append to note, link to project, archive.
- Detail view includes provenance, source layers, generated outputs, connections, conversion actions, and timeline.

Gaps:

- Rows expose many actions at once. The concept wants best action plus one secondary action, especially on smaller layouts.
- The concept makes capture/artifact/note distinctions sharper than the current visual hierarchy.
- Source thumbnails or compact type indicators are still weaker than the concepts.
- The mobile Library tap-to-detail functional test currently fails, so the Library detail path is not yet reliable under the mobile-width harness.

Implementation direction:

- Keep Library as ingestion pipeline.
- Tighten mobile rows: best suggested action, one secondary action, overflow for the rest.
- Preserve provenance close to any generated summary, card, or task.

## PWA Planner

What matches:

- Planner has summary stats, time blocks, calendar events, conflict repair, and Assistant handoff links.
- The direction is execution-oriented rather than a generic calendar clone.

Gaps:

- The PWA Planner functional run currently has a date-state failure. The first test expected the selected April 28 plan, but the screenshot/failing assertion showed the page did not reach the expected April 28 heading. The second summary-only conflict test passed.
- The current visual structure is not yet as close to the concept as Assistant, Library, or Review.
- Planner still needs stronger distinctions between fixed commitments, protected focus, flexible work, buffer, and conflicts.

Implementation direction:

- Fix the date-control state mismatch before treating Planner as visually stable.
- Then invest in the timeline/agenda split and conflict repair card polish from the concept.

## PWA Review

What matches:

- Review now has the core learning ladder: Recall, Understanding, Application, Synthesis, Judgment.
- The active review card includes due state, answer reveal, grading, source trace, project context, and "why this now" context.
- Learning insights and recommended drills make Review feel closer to a learning engine than plain SRS.

Gaps:

- The concept makes the active review item the clear center of gravity. Current PWA Review still spends a lot of first-viewport weight on queue context.
- The visual hierarchy is dense and text-heavy.
- Review modes exist at the UI/summary level, but deeper application/synthesis/judgment exercise generation still needs backend and agent behavior expansion.

Implementation direction:

- Keep the ladder and "why this now" as core primitives.
- Move toward one active exercise plus one support/action area.

## Mobile Assistant

What matches:

- This is the closest native mobile surface to the concept.
- The fresh phone capture shows the Assistant-first shell, morning/today context chips, one active morning-focus panel, a compact transcript, and bottom navigation.
- The dynamic-panel library now covers both Board A and Board B concepts: conflict, task detail, capture triage, review grade, clarification, defer, and project picker.

Gaps:

- The concept morning-focus screen is calmer and more spatially deliberate than the current native phone surface.
- Some explanatory labels from the concept notes are still too visible in the product UI; phone screens should bias toward concise state, choices, and actions.
- Bottom-sheet behavior for long pickers/search is not yet the main mobile overflow pattern.

Implementation direction:

- Continue mobile Assistant first. It is the correct control plane for the product.
- Keep only one active decision visible.
- Do not port the full desktop cockpit to phone.

## Mobile Library

What matches:

- Mobile Library has the right top-level pieces: stat chips, inbox, artifacts, notes, sources, suggestions, and bottom nav.
- It correctly frames Library as processing queue.

Gaps:

- The mobile Library screenshot is still too dense. It shows many actions per item and reads like a compressed desktop surface.
- The functional test currently fails when tapping the Library detail link. The link has the expected `href`, but Playwright remains on `/library` after `tap()`.
- Touch-target reliability and progressive disclosure need attention before this feels like the concept.

Implementation direction:

- Make rows more reactive and phone-native: title, metadata, best action, one secondary action, overflow.
- Use bottom sheets for link-to-project, tags, and extra actions.
- Fix the tap/navigation failure before calling mobile Library complete.

## Mobile Planner

What matches:

- Mobile Planner exposes Assistant handoff drafts and current execution state.
- The latest focused rerun passed the mobile Planner handoff test and produced a current screenshot.

Gaps:

- The concept wants a strong execution view: date controls, day strip, metric chips, vertical timeline, conflict card, next focus block, and compact planner composer.
- Current Planner still feels more like a scaled-down page than a phone-first execution surface.
- A prior same-session mobile Planner run briefly produced an April 29 vs April 28 handoff mismatch under parallel execution; the later focused rerun passed. This should be watched as a possible date-state/test isolation issue.

Implementation direction:

- Prioritize the day timeline and conflict repair card.
- Keep the Assistant handoff pattern but make the Planner itself more immediately scannable.

## Mobile Review

What matches:

- The underlying Review UI has the right ladder concepts and an active item flow.
- The screenshot shows ladder, active item, "why this now", source trace, project context, grade buttons, knowledge health, and queue ladder.

Gaps:

- The current mobile Review capture includes a red dev error badge, so it is evidence of current state, not a clean target screenshot.
- There is no dedicated mobile Review Playwright functional spec in `playwright.ui-functional.config.ts` yet.
- The page is very long and dense. The concept wants one review item at a time with thumb-friendly answer and grade controls.

Implementation direction:

- Add mobile Review functional coverage before UI polish.
- Keep explanation and "why this now" visible after answer, but collapse secondary queue health below the active item.

## Physical Phone

Current state:

- A fresh active-device pass captured Assistant, Library, Planner, and Review screenshots from physical phone serial `9dd62e84` under `artifacts/phone-current/2026-04-29/`.
- The captured app package was `com.starlog.app.dev`, so this is native dev-package evidence rather than signed release/preview APK evidence.
- The real native phone surfaces differ from the Playwright mobile-width PWA fallback screenshots. The native app is closer to the mobile concept in shell and navigation, while still needing major density and hierarchy work.

Implication:

- Physical phone screenshot proof currently requires waking the device before capture. ADB can wake the screen, but this device rejected persistent stay-awake settings from shell.
- Playwright mobile-width coverage is still useful for repeatable PWA fallback checks, but it is not a substitute for native phone visual QA.
- Native device automation remains a gap for final release confidence.

## Current Functional Evidence

Passing evidence from this pass:

- PWA Assistant, Library, and Review functional refresh: 15 passed.
- Production PWA dynamic panel renderer: 4 passed.
- Mobile Assistant functional refresh: 4 passed.
- Mobile Planner focused rerun: 1 passed.

Current failures observed:

- PWA Planner: 1 failed, 1 passed. The failing test expected an April 28 execution plan after date selection.
- Mobile Library: 1 failed. The detail link has the expected `href`, but tapping it did not navigate.

Important limitation:

- These tests prove that UI surfaces render and submit mocked assistant protocol/interrupt data. They do not prove that a live LLM or Codex agent can infer a command, emit the right dynamic panel, and complete the workflow end to end. That product loop still needs dedicated command-to-panel functional tests.

## Product Direction Assessment

The concept direction still makes sense and is compatible with the current stack. The backend and contract shape are strong enough for the UI direction: Assistant thread snapshots, assistant cards, interrupts, surface events, action cards, and conservative backend interrupt submit paths are already established.

The highest-leverage next UI work should be:

1. Mobile Assistant polish against the concept: less visible explanatory text, tighter hierarchy, one active decision.
2. Mobile Library rewrite: phone-native rows, reliable detail navigation, overflow/bottom-sheet action model.
3. Planner date-state and timeline polish.
4. Mobile Review coverage and one-item review flow.
5. Native phone screenshot automation that wakes the device, captures all four surfaces, and records evidence in dated artifact folders.
