# UI Functional Test Harnesses

This document is a dated runbook and evidence snapshot (not evergreen product status). Use it as
validation history, with the latest run status checked in newer dated artifacts before treating anything
as current behavior.

Starlog has repeatable Playwright smoke coverage for the clean assistant-first PWA shell through
`playwright.ui-functional.config.ts`. The harness starts the Next dev server so it remains fast enough
for feature-branch iteration; release packaging checks still use the existing PWA release-gate scripts.
The assistant concept proof now focuses on the centered conversation thread, quiet context strip,
inline dynamic panels, ambient rows, cards, and compact tool activity instead of the older Today
cockpit layout.

The native app is the primary phone client. These browser/mobile-viewport harnesses are still useful for
fast layout and protocol checks, but they do not replace installed Android validation for voice,
share capture, briefing cache/playback, alarms, or local runtime work. Treat the mobile PWA as a
fallback surface, not the main phone implementation target.

This is functional UI coverage, not a live-agent evaluation. Most tests mock API responses and
assistant protocol snapshots so the UI can be validated deterministically. For hosted-path discovery,
`https://starlog-web-production.up.railway.app/login` is the intended user entry URL, and the hosted API
base is `https://starlog-api-production.up.railway.app`. Fresh public unauthenticated checks on
2026-05-19 returned Railway fallback `HTTP 404` with `x-railway-fallback: true` for hosted `/login`,
`/assistant`, and `/v1/health`, so the configured hosted domains should be treated as broken/unproven
until deployment/domain routing is fixed. Authenticated hosted login was last proven on 2026-05-15 and
requires the operator-held passphrase/token, which must not be pasted into docs or committed artifacts.
Desktop web and native mobile chat surfaces have partial assistant-ui adapter/runtime coverage with
compatibility fallbacks. Web has partial `ExternalStoreRuntime` data/tool UI paths; native mobile
currently uses the assistant-ui React Native `server-owned-local-protocol-bridge` path over
server-owned Starlog messages.
These browser/viewport harnesses validate the supported structured protocol path and fallback-hidden
user experience, not full installed-device assistant-ui parity or complete server-owned runtime
migration.

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
./node_modules/.bin/playwright test --config=playwright.web.config.ts apps/web/tests/pwa-assistant-study-command.web-functional.spec.ts
./node_modules/.bin/playwright test --config=playwright.web.config.ts apps/web/tests/pwa-dynamic-panel-renderer.spec.ts
./node_modules/.bin/playwright test --config=playwright.web.config.ts apps/web/tests/assistant-dynamic-ui-e2e.spec.ts
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

Public hosted reachability can be checked without secrets:

```bash
curl -I -L --max-time 20 https://starlog-web-production.up.railway.app/login
curl -I -L --max-time 20 https://starlog-web-production.up.railway.app/assistant
curl -sS --max-time 20 https://starlog-api-production.up.railway.app/v1/health
```

As of the 2026-05-19 sweep, those commands return Railway fallback `HTTP 404`, so they are a routing
preflight rather than a passing hosted smoke. For authenticated checks, use the hosted smoke or
cross-surface proof runbooks with locally supplied environment variables only after public routes serve
Starlog again, and keep tokens redacted from saved output.

## Coverage

- `test:ui:pwa-functional` runs the desktop PWA clean assistant concept smoke against the real Next `/assistant` route with mocked AssistantThreadSnapshot and AssistantInterrupt API responses. Screenshot proof from the assistant concept spec is written through Playwright `testInfo.outputPath()` under the ignored test output tree, not tracked `artifacts/ui-functional` paths.
- `test:ui:mobile-functional` runs the same route under a Pixel 7 Playwright device profile to validate the
  mobile viewport assistant equivalent for inline dynamic-panel grammar (browser-only viewport coverage).
- Both tests submit the dynamic panel to mocked assistant interrupt endpoints and assert the posted values plus the resolved UI state.

Current functional areas:

| Area | Spec | What it proves |
| --- | --- | --- |
| PWA Assistant concept | `apps/web/tests/ui-functional/pwa-assistant-concept.functional.spec.ts` | Clean centered Assistant thread, quiet context strip with useful today/weekly context, recommended starter prompt, ambient rows, cards, inline dynamic panel submission, compact tool activity, and hidden raw protocol labels against mocked assistant snapshots. |
| Mobile Assistant concept | `apps/web/tests/ui-functional/mobile-assistant-concept.functional.spec.ts` | Phone-width Assistant thread behavior with one active inline panel, schedule-conflict decision, task details, capture triage, review grade, clarification, defer, project picker, compact activity, and no raw protocol labels. |
| PWA Assistant study-command | `apps/web/tests/pwa-assistant-study-command.web-functional.spec.ts` | Assistant study-command and due-date task creation paths against mocked API responses; current due-date coverage is 5/5 passing. |
| PWA dynamic panel renderer | `apps/web/tests/pwa-dynamic-panel-renderer.spec.ts` | Production-rendered dynamic panel field behavior, interrupt submit/dismiss APIs, field-id reuse, due-date task panel controls, and hidden diagnostic labels; current coverage is 4/4 passing. |
| Assistant dynamic-ui e2e | `apps/web/tests/assistant-dynamic-ui-e2e.spec.ts` | Deterministic web/API due-date dynamic panel flow creates a Planner task end to end; current coverage is 1/1 passing. |
| PWA Library | `apps/web/tests/ui-functional/pwa-library.functional.spec.ts` | Capture pipeline, conversion actions, offline queued actions, assistant event sync behavior, artifact detail, provenance, source layers, generated outputs, and timeline. |
| Mobile Library viewport | `apps/web/tests/ui-functional/mobile-library.functional.spec.ts` | Compact mobile Library main surface, tab layout, horizontal overflow guard, and attempted artifact detail reachability. |
| PWA Planner | `apps/web/tests/ui-functional/pwa-planner.functional.spec.ts` | Planner summary, blocks, calendar events, conflict repair actions, and Assistant handoff drafts against mocked planner/calendar APIs. |
| Mobile Planner viewport | `apps/web/tests/ui-functional/mobile-planner.functional.spec.ts` | Phone-width Planner Assistant handoff drafts and conflict review link behavior. |
| PWA Review | `apps/web/tests/ui-functional/pwa-review.functional.spec.ts` | Clean Review shell/study-loop surface, queue health, reveal answer, grading, assistant event emission on reveal, learning insights, recommended drill, and quiet compatibility when learning fields are missing. |
| Mobile view-model tests | `apps/mobile/tests/*.test.ts` | React Native view-model and panel-state shaping for Assistant, Library, Planner, Review, and mobile dynamic panels. These are not browser screenshots or device automation. |
| Native Android fresh-local SRS validation | `scripts/android_fresh_local_srs_validation.sh` | Physical-device evidence for login, assistant-ui shell/thread/composer markers, Assistant dynamic UI capability prompt, Assistant command submission, due-date task creation, Study Core unlock/read/question controls, Review reveal/grade evidence, Assistant-hosted review-grade dynamic UI controls, briefing cache generation, notification permission, and Planner cache-first alarm scheduling. The current proof is `.localdata/android-local-validation/builds/20260521T111452Z/latest.json` with `validation_passed: true`; it includes `assistant_due_date_dynamic_ui_verified`, `planner_briefing_cache_generated`, `planner_alarm_scheduled`, and `planner_alarm_briefing_path_verified`. |
| Native Android interview functional capture | `scripts/android_interview_functional_capture.sh` | Lightweight installed-device capture path for the interview-prep loop. It keeps the phone awake, opens Assistant/Review/Planner deeplinks, records screenshots and UI XML, and pauses for manual checkpoints around topic unlock/read, Review reveal/grade, and progress/recommendation verification. |

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
- The due-date dynamic UI path creates a Planner task and keeps the user-facing panel free of raw
  protocol/fallback labels and `create_time_block` or time-block controls; the expected copy says
  "Time blocking can be handled next."
- Supported web and native chat paths can render structured protocol parts while unsupported
  shapes remain covered by Starlog compatibility/fallback rendering. The fallback renderers are
  transitional compatibility paths, not the target runtime.
- React Native view-model tests cover mobile dynamic-panel shaping. The native assistant-ui-style
  path currently uses `server-owned-local-protocol-bridge` over server-owned Starlog messages.
  Historical Android fresh-local evidence has been refreshed by
  `.localdata/android-local-validation/builds/20260521T111452Z/latest.json` for shell/thread/composer
  markers, due-date and review-grade dynamic-panel controls, native Study controls, Review reveal/grade,
  briefing cache generation, and alarm scheduling. Full server-owned native runtime migration is still
  pending.
- Raw labels such as `tool_call`, `tool_result`, protocol, runtime, and diagnostics are hidden from the default user-facing UI.

Not yet covered:

- A live LLM/Codex agent interpreting a natural-language command and deciding to emit a dynamic panel.
- End-to-end command control of all surfaces from phone/PWA without clicks.
- Voice command to assistant run to dynamic panel to confirmed mutation.
- Native iOS automation of dynamic panels.
- Repeatable Android functional automation for the full native assistant-ui runtime.
- Full server-owned assistant-ui runtime migration across web and native mobile.
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
the long-term web and native runtime, but the proof gaps are whether a command can produce the right
Starlog protocol parts and complete the workflow end to end across web and native mobile, and whether
the native surface can run that path repeatably through Android automation.

## Historical Screenshot Comparisons

The old 2026-04-29 screenshot comparison folders were removed from git. Use this document for
repeatable harness commands, `docs/CURRENT_STATE.md` for current confidence, and
`artifacts/ui-concept/**` plus `docs/ASSISTANT_UI_REFERENCE.md` for target UI references.

When a visual pass needs evidence, write fresh output to the harness default output location,
`.localdata/`, `/tmp`, or a single explicitly requested latest proof bundle. Do not commit dated
historical comparison folders as ongoing source of truth.

## Native Mobile Gap

The browser viewport harness is not native Android/iOS automation. The current Expo mobile app cannot run
as an Expo web harness without adding `react-native-web` and `@expo/metro-runtime`, and this workitem does
not add a native automation stack such as Maestro or Detox.

For native Android product-flow evidence, use `scripts/android_fresh_local_srs_validation.sh` with a
ready, unlocked physical Android phone. The preflight reports absent/unauthorized/offline phone gates
clearly. A passing run writes its final manifest to
`.localdata/android-local-validation/builds/latest.json` with `validation_passed: true` and includes
Assistant evidence such as `assistant-capability-shell-thread.png`, `assistant-capability-composer.png`,
`assistant-dynamic-ui-capability-prompt.png`, `assistant-due-date-dynamic-ui.png`,
`assistant-due-date-created.png`, `assistant-command-shell-thread.png`,
`assistant-command-composer.png`, `assistant-review-grade-controls.png`, and
`assistant-review-grade-dynamic-ui.png`. Failed runs write
their own build-local `latest.json` and publish `.localdata/android-local-validation/builds/latest.json`
with `validation_passed: false`; environmental preflight gates publish `validation_stage: blocked`,
while in-flow script/app failures publish `validation_stage: failed`. Partial screenshots/XML remain
under the ignored latest build directory for debugging; they do not publish a passed final manifest.
The latest physical proof is `.localdata/android-local-validation/builds/20260521T111452Z/latest.json`,
which passed the bounded interview-prep path, Assistant due-date dynamic UI path, and Planner
cache-first briefing/alarm path. Treat it as current installed-device evidence for those flows, not as
complete proof of the full server-owned native assistant-ui runtime.

Physical phone screenshot proof also requires the attached Android device to be awake and unlocked. On this device, `adb shell svc power stayon true` has exited with code `137`, and changing `stay_on_while_plugged_in` is blocked by Android's `WRITE_SECURE_SETTINGS` permission, so current repeatable phone proof should wake the device immediately before capture and publish only the latest requested evidence bundle.

## Native Android Interview Functional Capture

Use this path when the goal is repeatable evidence for the installed native Android interview-prep
loop without rebuilding the app or rewriting mobile UI. It is an operator-assisted harness: the
script handles device launch, surface deeplinks, screenshots, UI hierarchy dumps, optional API
snapshots, deterministic interview-prep due-card seeding, and checkpoint prompts; the tester
performs the actual Review grading actions on the phone.

```bash
cd /home/ubuntu/starlog
ADB_SERIAL=<SERIAL> bash scripts/android_interview_functional_capture.sh
```

Useful no-device and planning modes:

```bash
bash scripts/android_interview_functional_capture.sh --help
bash scripts/android_interview_functional_capture.sh --no-device
bash scripts/android_interview_functional_capture.sh --dry-run
```

`--no-device` is metadata-only: it writes `run.env` and `manual-checkpoints.md`, then exits before
running the API seed path even when API credentials are present.

When `STARLOG_API_BASE` and `STARLOG_ACCESS_TOKEN` are set, the harness runs
`scripts/interview_prep_api_seed.py` before device capture and writes
`api/interview-prep-seed.json`. The seed path uses only public Starlog API calls: it reuses or
creates one tagged interview-prep source/topic/deck/card, links the card behind the topic-read gate,
marks the seeded topic read by default, refreshes the card due date, and verifies the card appears in
the same first page the native phone Review path loads: `/v1/cards/due?limit=20`. If the seeded card
is not already in that first page, the seed script uses public review APIs to add priority review
signals for that card, forces it due again, and rechecks the first page. Without credentials, the seed
summary is written with `status: skipped`; in `--dry-run`, it records planned API requests without
network access.

Seed-only checks:

```bash
python3 scripts/interview_prep_api_seed.py --dry-run
STARLOG_API_BASE=http://127.0.0.1:8000 \
STARLOG_ACCESS_TOKEN=<redacted> \
STARLOG_TEST_USER=phone-functional \
python3 scripts/interview_prep_api_seed.py --summary-path /tmp/interview-prep-seed.json
```

Common overrides:

```bash
ADB=/mnt/c/Temp/android-platform-tools/platform-tools/adb.exe \
ADB_SERIAL=<SERIAL> \
APP_VARIANT=preview \
STARLOG_API_BASE=http://127.0.0.1:8000 \
STARLOG_ACCESS_TOKEN=<redacted> \
STARLOG_TEST_USER=phone-functional \
ADB_REVERSE_PORTS=8000 \
bash scripts/android_interview_functional_capture.sh
```

The script defaults to Windows `adb.exe` when present, wakes the phone at the start, and writes
evidence under:

```text
.localdata/android-interview-functional/artifacts/<UTC timestamp>/
```

That root is ignored by `.gitignore`, so generated screenshots, XML dumps, API snapshots, seed
summaries, and operator metadata are not accidentally committed. Do not paste real access tokens
into docs or commit them in run artifacts; run metadata only records whether a token was provided.

Useful seed controls:

- `STARLOG_INTERVIEW_SEED=off` skips API seeding and writes a skipped seed summary.
- `STARLOG_INTERVIEW_SEED_ID=<stable-id>` changes the idempotence tag (`seed:<stable-id>`).
- `STARLOG_INTERVIEW_SEED_TOPIC_TITLE=<title>` changes the seeded topic title.
- `STARLOG_INTERVIEW_SEED_MARK_READ=0` leaves the seeded topic unread. This proves setup and
  link creation, but Review will not show the seeded card until the topic is marked read through
  Assistant or the study API.

Manual checkpoints captured by the harness:

- Assistant topic/read context: open Assistant, verify the interview-prep topic/read history and
  controls remain user-facing. If `STARLOG_INTERVIEW_SEED_MARK_READ=0`, mark the seeded topic read
  before continuing.
- Review reveal/grade: open Review, load due cards if needed, reveal the interview card answer, and
  submit a grade such as `Good`.
- Progress/recommendation verification: confirm Review progress changed and Assistant or Planner
  shows recommendation/progress context for the next study move.
