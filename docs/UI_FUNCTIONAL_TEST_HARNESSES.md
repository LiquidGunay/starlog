# UI Functional Test Harnesses

Starlog has repeatable Playwright smoke coverage for the new assistant-first UI concept through `playwright.ui-functional.config.ts`. The harness starts the Next dev server so it remains fast enough for feature-branch iteration; release packaging checks still use the existing PWA release-gate scripts.

This is functional UI coverage, not a live-agent evaluation. Most tests mock API responses and assistant protocol snapshots so the UI can be validated deterministically.

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

## Dynamic UI Coverage Boundary

The current tests prove that Starlog can render and operate dynamic UI when the assistant protocol already contains the right structured parts.

Covered:

- `AssistantThreadSnapshot` with `interrupt_request` parts renders in chat.
- `AssistantInterrupt` fields render for text, date/time-like choices, priority, toggles, selects, review grades, defer choices, and entity search/project picker.
- User actions submit expected values to mocked interrupt endpoints.
- Resolved panels leave the UI in a settled state.
- Raw labels such as `tool_call`, `tool_result`, protocol, runtime, and diagnostics are hidden from the default user-facing UI.

Not yet covered:

- A live LLM/Codex agent interpreting a natural-language command and deciding to emit a dynamic panel.
- End-to-end command control of all surfaces from phone/PWA without clicks.
- Voice command to assistant run to dynamic panel to confirmed mutation.
- Native Android/iOS automation of the React Native app with dynamic panels.
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

This is not native Android/iOS automation. The current Expo mobile app cannot run as an Expo web harness without adding `react-native-web` and `@expo/metro-runtime`, and this workitem does not add a native automation stack such as Maestro or Detox. Native device coverage remains the next gap for the primary mobile app.

Physical phone screenshot proof also requires the attached Android device to be awake and unlocked. A fresh active-device pass on 2026-04-29 captured native Assistant, Library, Planner, and Review screenshots under `artifacts/phone-current/2026-04-29/`. On this device, `adb shell svc power stayon true` exited with code `137`, and changing `stay_on_while_plugged_in` is blocked by Android's `WRITE_SECURE_SETTINGS` permission, so current repeatable phone proof should wake the device immediately before capture.
