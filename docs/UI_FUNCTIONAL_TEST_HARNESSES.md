# UI Functional Test Harnesses

Starlog has repeatable Playwright smoke coverage for the new assistant-first UI concept through `playwright.ui-functional.config.ts`. The harness starts the Next dev server so it remains fast enough for feature-branch iteration; release packaging checks still use the existing PWA release-gate scripts.

The native app is the primary phone client. These browser/mobile-viewport harnesses are still useful for
fast layout and protocol checks, but they do not replace installed Android validation for voice,
share capture, briefing cache/playback, alarms, or local runtime work. Treat the mobile PWA as a
fallback surface, not the main phone implementation target.

This is functional UI coverage, not a live-agent evaluation. Most tests mock API responses and
assistant protocol snapshots so the UI can be validated deterministically. For hosted-path discovery,
`https://starlog-web-production.up.railway.app/login` is the user entry URL (followed by assistant
flows under `/assistant`). The desktop web
Assistant has partial assistant-ui adapter/runtime coverage with compatibility fallbacks; these
harnesses validate the supported structured protocol path and fallback-hidden user experience, not
full assistant-ui parity.

## Commands

```bash
pnpm test:ui:pwa-functional
pnpm test:ui:mobile-functional
pnpm test:ui:functional
```

Use `corepack pnpm ...` on hosts where global `pnpm` is unavailable.

Targeted commands that are useful during UI work:

```bash
./node_modules/.bin/playwright test --config=playwright.ui-functional.config.ts --project=pwa-chromium apps/web/tests/ui-functional/pwa-assistant-concept.functional.spec.ts
./node_modules/.bin/playwright test --config=playwright.ui-functional.config.ts --project=mobile-chromium apps/web/tests/ui-functional/mobile-assistant-concept.functional.spec.ts
./node_modules/.bin/playwright test --config=playwright.web.config.ts apps/web/tests/pwa-dynamic-panel-renderer.spec.ts
```

Live functional PWA smoke for the actual click path:

```bash
TMPDIR=/tmp STARLOG_LIVE_FUNCTIONAL_API_PORT=8042 STARLOG_LIVE_FUNCTIONAL_WEB_PORT=3024 \
  ./node_modules/.bin/playwright test -c playwright.live-functional.config.ts \
  --project=pwa-live-chromium apps/web/tests/live-functional/pwa-live-user-flow.spec.ts --headed
```

That browser smoke should be paired with native Android proof for phone-owned flows.
The live PWA smoke now keeps Assistant-tab and Review-tab evidence distinct: Review only reveals the
card, then `/assistant` must show the assistant-ui shell/composer plus the generated review-grade
dynamic UI before the grade is submitted.

## Coverage

- `test:ui:pwa-functional` runs the desktop PWA assistant concept smoke against the real Next `/assistant` route with mocked AssistantThreadSnapshot and AssistantInterrupt API responses.
- `test:ui:mobile-functional` runs the same route under a Pixel 7 Playwright device profile to validate the mobile viewport assistant equivalent for inline dynamic-panel grammar.
- Both tests submit the dynamic panel to mocked assistant interrupt endpoints and assert the posted values plus the resolved UI state.

Current functional areas:

| Area | Spec | What it proves |
| --- | --- | --- |
| PWA Assistant concept | `apps/web/tests/ui-functional/pwa-assistant-concept.functional.spec.ts` | Today cockpit, recommended next move, reason stack, ambient rows, cards, strategic context, weekly systems review, dynamic panel submission, and compact tool activity against mocked assistant snapshots. |
| Mobile Assistant concept | `apps/web/tests/ui-functional/mobile-assistant-concept.functional.spec.ts` | Phone-width Assistant thread behavior with one active inline panel, schedule-conflict decision, task details, capture triage, review grade, clarification, defer, project picker, compact activity, and no raw protocol labels. |
| PWA dynamic panel renderer | `apps/web/tests/pwa-dynamic-panel-renderer.spec.ts` | Production-rendered dynamic panel field behavior, interrupt submit/dismiss APIs, field-id reuse, and hidden diagnostic labels. |
| PWA Library | `apps/web/tests/ui-functional/pwa-library.functional.spec.ts` | Capture pipeline, conversion actions, offline queued actions, assistant event sync behavior, artifact detail, provenance, source layers, generated outputs, and timeline. |
| Mobile Library viewport | `apps/web/tests/ui-functional/mobile-library.functional.spec.ts` | Compact mobile Library main surface, tab layout, horizontal overflow guard, and attempted artifact detail reachability. |
| PWA Planner | `apps/web/tests/ui-functional/pwa-planner.functional.spec.ts` | Planner summary, blocks, calendar events, conflict repair actions, and Assistant handoff drafts against mocked planner/calendar APIs. |
| Mobile Planner viewport | `apps/web/tests/ui-functional/mobile-planner.functional.spec.ts` | Phone-width Planner Assistant handoff drafts and conflict review link behavior. |
| PWA Review | `apps/web/tests/ui-functional/pwa-review.functional.spec.ts` | Learning ladder, queue health, reveal answer, grading, assistant event emission on reveal, learning insights, recommended drill, and quiet compatibility when learning fields are missing. |
| Mobile view-model tests | `apps/mobile/tests/*.test.ts` | React Native view-model and panel-state shaping for Assistant, Library, Planner, Review, and mobile dynamic panels. These are not browser screenshots or device automation. |
| Native Android fresh-local SRS validation | `scripts/android_fresh_local_srs_validation.sh` | Physical-device login, assistant-ui shell/thread/composer markers, Assistant dynamic UI capability prompt, Assistant command submission, Study Core unlock/read/question controls, Review reveal/grade evidence, Assistant-hosted review-grade dynamic UI controls, briefing recommendation hints, notification permission, and Planner alarm scheduling. |

## Dynamic UI Coverage Boundary

The current tests prove that Starlog can render and operate dynamic UI when the assistant protocol already contains the right structured parts.

Covered:

- `AssistantThreadSnapshot` with `interrupt_request` parts renders in the Assistant thread.
- `AssistantInterrupt` fields render for text, date/time-like choices, priority, toggles, selects, review grades, defer choices, and entity search/project picker.
- User actions submit expected values to mocked interrupt endpoints.
- Resolved panels leave the UI in a settled state.
- The live PWA harness sends `show me what UI actions you can take`, requires the Assistant capability
  prompt to describe dynamic UI actions without raw protocol labels, reveals a card from Review, then
  returns to Assistant to submit the generated review-grade dynamic panel.
- Supported desktop web assistant-ui paths can render structured protocol parts while unsupported
  shapes remain covered by Starlog compatibility/fallback rendering.
- React Native view-model tests cover mobile dynamic-panel shaping. The native assistant-ui-style
  path is validated by the Android fresh-local harness through assistant-ui shell/composer markers,
  the dynamic UI capability prompt, and the Assistant-hosted review-grade panel controls.
- Raw labels such as `tool_call`, `tool_result`, protocol, runtime, and diagnostics are hidden from the default user-facing UI.

Not yet covered:

- A live LLM/Codex agent interpreting a natural-language command and deciding to emit a dynamic panel.
- End-to-end command control of all surfaces from phone/PWA without clicks.
- Voice command to assistant run to dynamic panel to confirmed mutation.
- Native iOS automation of dynamic panels.
- Real provider credentials or production Codex bridge behavior.

The missing product-level test should look like:

```text
User command
  -> assistant run starts
  -> deterministic mocked model or mocked Codex bridge emits tool call / interrupt
  -> dynamic panel appears in chat
  -> user resolves through panel or command
  -> backend mutation completes
  -> card or ambient event confirms the result
```

This should be added with a mocked model/bridge first so CI does not require Codex credentials.

This missing test is separate from the current partial assistant-ui adapter coverage: assistant-ui is
the strategic web runtime, but the proof gap is whether a command can produce the right Starlog
protocol parts and complete the workflow end to end across web and native mobile.

## 2026-04-29 Run Notes

Screenshot comparison artifacts for this pass are in:

```text
artifacts/ui-comparison/2026-04-29/
```

Runs completed during the comparison pass:

- PWA Assistant + Library + Review targeted functional refresh: `15 passed`.
- Production PWA dynamic panel renderer: `4 passed`.
- Mobile Assistant targeted functional refresh: `4 passed`.
- Mobile Planner focused rerun: `1 passed`.
- PWA Planner targeted run: `1 failed, 1 passed`.
- Mobile Library + Planner focused rerun: `1 failed, 1 passed`.

Observed current failures:

- PWA Planner first test expected the April 28 execution plan after date selection, but did not find the expected April 28 heading.
- Mobile Library main test found the expected detail link `href`, but `tap()` did not navigate to `/library/captures/art_capture_focus`.

These are current-state findings, not expected behavior.

## Native Mobile Gap

The browser viewport harness is not native Android/iOS automation. The current Expo mobile app cannot run as an Expo web harness without adding `react-native-web` and `@expo/metro-runtime`, and this workitem does not add a native automation stack such as Maestro or Detox.

For native Android product-flow proof, use `scripts/android_fresh_local_srs_validation.sh`. A passing
run writes its final manifest to
`.localdata/android-local-validation/builds/latest.json` with `validation_passed: true` and includes
Assistant evidence such as `assistant-capability-shell-thread-composer.png`,
`assistant-dynamic-ui-capability-prompt.png`, `assistant-command-shell-thread-composer.png`,
`assistant-review-grade-controls.png`, and `assistant-review-grade-dynamic-ui.png`. Failed runs write
their own build-local `latest.json` and publish `.localdata/android-local-validation/builds/latest.json`
with `validation_passed: false`, `validation_stage: failed`, and any partial screenshots/XML for debugging;
they do not publish a passed final manifest.

Physical phone screenshot proof also requires the attached Android device to be awake and unlocked. A fresh active-device pass on 2026-04-29 captured native Assistant, Library, Planner, and Review screenshots under `artifacts/phone-current/2026-04-29/`. On this device, `adb shell svc power stayon true` exited with code `137`, and changing `stay_on_while_plugged_in` is blocked by Android's `WRITE_SECURE_SETTINGS` permission, so current repeatable phone proof should wake the device immediately before capture.
