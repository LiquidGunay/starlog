# Current State

Last updated: 2026-05-15

This is the concise status page for what Starlog can be treated as working today versus what still
needs fresh proof. It is a synthesis of repo-local code, tests, and the latest local PWA/Android
functional evidence.

Use [PLAN.md](/home/ubuntu/starlog/PLAN.md) and [VISION.md](/home/ubuntu/starlog/VISION.md) for
where Starlog is going. Use this page for current implementation confidence.

## Post-Merge PR Status

- **Merged #202 (PDF import into Study Core):** trusted local PDF review-card JSONL is now imported into
  Study Core with topic-level gating, stable source/topic/chunk artifacts, and stale topic-link cleanup.
- **Merged #203 (assistant runtime recommendation hints):** Assistant runtime context includes
  `recommendation_hints` from assistant memory and exposes them through the same runtime contract used by
  the Assistant surfaces.
- **Merged #204 (briefing review pressure):** briefing service now uses deterministic, signal-scored review
  pressure (`due_card_count` + `low-review` + `study` signals) for scheduling pressure and ordered briefing
  card selection.
- **Merged #206 (live interview-prep validation):** deterministic `Sliding Window` interview-prep seeding
  now drives the live PWA functional harness and the Android fresh-local validation loop, including Assistant
  study commands, Review reveal/grade, briefing recommendation hints, and alarm scheduling evidence.

## Works Today

- **Core local stack:** the repo contains a FastAPI backend, Next.js PWA, native mobile app, desktop
  helper, browser extension scaffold, shared contracts, and AI runtime. Local startup is documented in
  [README.md](/home/ubuntu/starlog/README.md) and [docs/USER_GUIDE.md](/home/ubuntu/starlog/docs/USER_GUIDE.md).
- **Assistant-first product shape:** the current surface model is `Assistant`, `Library`, `Planner`,
  and `Review`, with the Assistant as the primary thread and the other surfaces as support views.
- **Assistant protocol direction:** Starlog's architecture decision is to use assistant-ui as the
  strategic web Assistant runtime while keeping the Starlog assistant protocol as the source of truth.
  This is documented in
  [docs/ASSISTANT_RUNTIME_ARCHITECTURE_DECISION.md](/home/ubuntu/starlog/docs/ASSISTANT_RUNTIME_ARCHITECTURE_DECISION.md).
- **Web assistant-ui migration:** the desktop web Assistant now has partial assistant-ui adapter/runtime
  coverage for supported Starlog assistant protocol snapshots and dynamic panel parts. Unsupported or
  not-yet-migrated message/tool shapes still use Starlog compatibility projections and existing
  fallback render paths, so this is partial coverage rather than full assistant-ui parity.
- **Mobile Assistant dynamic UI:** the React Native assistant-ui-style path is in progress. Mobile
  view-model and panel-state tests cover Assistant, Library, Planner, Review, and dynamic-panel shaping,
  while installed-device dynamic-panel proof is still required before treating native mobile
  assistant-ui parity as complete.
- **API stability baseline:** the API test harness now pins TestClient paths to Python 3.12 through
  [services/api/tests/conftest.py](/home/ubuntu/starlog/services/api/tests/conftest.py), and
  `httpx` is constrained to a compatible range for the current FastAPI/TestClient stack. Treat API
  tests as Python-3.12-local unless a newer runner is explicitly validated.
- **Study Core backend:** `/v1/study/*` routes and services exist for sources, topics, source chunks,
  card-topic links, practice items, practice attempts, question requests, and progress summary.
  Attempt creation and topic-read events can reflect into the Assistant event stream.
- **Study Assistant commands:** deterministic Assistant commands can mark topics read, unlock topics,
  and create topic-specific question requests. Covered commands include `I read ...`,
  `mark ... read`, `unlock Neetcode sliding window drills`, and
  `quiz me on application questions for embeddings`.
- **Event-backed recommendations and gated Review ordering:** due-card queries exclude unread gated
  cards, preserve due-date fallback, and now include deterministic study signals from topic reads,
  question requests, review grades, and practice attempts. PR #204 adds review-pressure signals to this
  same scoring path in the briefing flow.
- **Assistant recommendation context:** PR #203 adds `recommendation_hints` into the assistant runtime
  request context so clients can consume deterministic recommendation rationale from the same backend memory.
  Assistant Today also folds stored recommendation events into its `reason_stack`, so existing
  PWA/native "why now" UI can render recommendation-backed rationale without a separate surface
  contract.
- **ML Interviews Part II SRS deck import:** `data/ml_interviews_part_ii_qa_cards.jsonl` is the
  checked-in deck source. `scripts/bootstrap_ml_interview_srs.py` is idempotent: it reuses the named
  deck, bootstrap artifact, first card-set version, and deck note while preserving existing review
  scheduling state. Dry-run import is documented in [docs/srs/README.md](/home/ubuntu/starlog/docs/srs/README.md).
- **PDF deck preflight safety path:** `scripts/pdf_deck_preflight.py` calls
  `pdf_ingest_service.extract_pdf_text(Path(...))` directly. It does not boot FastAPI, does not use
  FastAPI `TestClient`, and only allows localhost parse/OCR server URLs. It now writes
  provenance-only `candidate_cards.jsonl` for proven local extraction and records blocked chunk
  hashes for unproven extraction; it does not persist source excerpts as card content.
- **PDF final-card safety path:** `scripts/build_pdf_review_cards.py` is the next step after preflight.
  It only writes final SRS-compatible review-card JSONL when extraction is proven and comes from
  trusted local providers (`liteparse_server`, `ocr_server`, or `pypdf`). `strings` and noisy scanned
  chunks are recorded as blocked evidence instead of weak review cards. `scripts/import_pdf_review_cards.py`
  repeatably upserts the generated JSONL into a source-scoped PDF deck plus Study Core
  source/topic/chunk records, with card-topic links gated until the PDF topic is marked read.
  It rejects untrusted or mixed-source JSONL and removes stale gated links when a card's imported
  PDF section is corrected.
- **NeetCode 150 Study Core importer:** `data/neetcode_150.json` contains 150 factual practice
  entries with stable IDs, LeetCode URLs, difficulty, pattern, prerequisites, and empty user notes.
  `scripts/import_neetcode_150.py` can validate dry-run payloads and perform an idempotent local
  Study Core/SRS import without proprietary problem text or generated answers.
- **Minimal PWA/native interview-prep UI:** the PWA Review surface has thin controls for topic
  unlock/read, question-mode requests, progress state, and recommendation rationale. Native Android
  Review shows study progress, can unlock/read topics, create question-mode requests, load/reveal
  backend-owned cards, and submit review grades on a physical-device local validation loop.
- **Live PWA interview-prep loop:** Playwright boots the local API and PWA, submits visible Assistant
  commands for `Sliding Window`, verifies due-card gating, reveals and grades a Review card, generates
  a recommendation-backed briefing, and creates an alarm.
- **Hosted PWA reachability:** `https://starlog-web-production.up.railway.app/login` currently serves
  the login page, and `https://starlog-api-production.up.railway.app/v1/health` returns an OK
  production health payload. This proves public reachability, not hosted passphrase login.
- **PWA and native alarm path:** PWA Planner can generate a briefing and create an API alarm plan.
  Native Android Planner can cache a briefing package and schedule local notification playback after
  granting notification permission.

## Current Interview-Prep Loop

Current status after PRs #202-#206:

1. Import or validate structured study material:
   - ML Interviews Part II deck via `scripts/bootstrap_ml_interview_srs.py`.
   - NeetCode 150 local Study Core/SRS import via `scripts/import_neetcode_150.py`.
   - `Inference Engineering.pdf` review cards via local LiteParse/OCR preflight, final-card build,
     and `scripts/import_pdf_review_cards.py`.
   - **Status:** works for Chapter 0 of `Inference Engineering.pdf` via trusted providers; full-chapter import still in proof.
2. Mark a topic read through the Assistant or the Review surface.
   - **Status:** works; mark/read state gates card release.
3. Unlock only cards linked to read/unlocked topics; unread gated cards stay out of due review.
   - **Status:** works end-to-end when linked card-topic progress is available.
4. Request question style preferences, such as application questions, against a topic.
   - **Status:** works as deterministic Assistant command flow into `study_question_requests`.
5. Review and grade cards through the PWA or Android native Review surface.
   - **Status:** works on both surfaces with live local PWA and Android physical-device grading evidence.
6. Feed review/question/practice events into deterministic recommendation scoring.
   - **Status:** works; PR #204 also injects these signals into briefing review pressure.
7. Preflight local PDFs before creating cards from them.
   - **Status:** works with `scripts/pdf_deck_preflight.py` and `scripts/build_pdf_review_cards.py`.

Key loop evidence path for this status:
- `/tmp/starlog-pdf-review-cards-final2/20260514T131342Z/` (builder/import artifacts for Chapter 0)
- `/tmp/starlog-live-functional-study-validation-reviewfix/` (live PWA API/web/browser flow evidence)
- `/tmp/starlog-android-local-validation/builds/20260514T200744Z/` (native validation API log + `latest.json` evidence)

Known outcome for `Inference Engineering.pdf`:

- Latest LiteParse direct CLI evidence used
  `/tmp/starlog-liteparse-cli/node_modules/.bin/lit parse "Inference Engineering.pdf" --format json -o /tmp/inference-engineering-liteparse-noocr.json --max-pages 20 --no-ocr -q`.
  LiteParse returned `pages[].text` and no top-level `text`, so `scripts/liteparse_parse_server.py`
  now aggregates cleaned page text when top-level text is absent.
- Latest local preflight evidence with a localhost LiteParse parse endpoint reported
  `provider=liteparse_server`, `mode=liteparse`, `usable=true`, `readable=true`,
  `rejected_as_noise=false`, `evidence_status=proven_local_text`, and `cards_generated=0`.
- Fresh local builder/import evidence on 2026-05-14 generated 8 Chapter 0 review cards from
  LiteParse extraction into `/tmp/starlog-pdf-review-cards-final2/20260514T131342Z/`, then imported
  them into a temp DB with 8 cards, 8 gated card-topic links, 8 source-backed answer chunks, one
  Study source, and one Study topic. Due review was empty before marking `Chapter 0: Inference`
  read and contained all 8 cards after the read marker.

## Unproven Or Pending

- **Full-book `Inference Engineering.pdf` coverage:** Chapter 0 final-card generation/import is proven
  through the guarded local path. Broader chapter coverage still needs a larger trusted extraction
  run and human review of generated local JSONL before import.
- **Persisted native briefing-date cleanup:** fresh native alarm flows default and schedule against
  the current day, and stale persisted briefing-date normalization is now covered by a focused mobile
  unit test. A device that already carries stale persisted briefing-date state still needs physical
  state-migration/reset proof before release.
- **Fresh end-to-end release confidence:** re-run [docs/CROSS_SURFACE_PROOF.md](/home/ubuntu/starlog/docs/CROSS_SURFACE_PROOF.md)
  before claiming current web + phone + helper release readiness.
- **Production Android store readiness:** Android release-signing, signed production QA smoke, store
  packaging, and final screenshots still require
  [docs/ANDROID_STORE_DISTRIBUTION_CHECKLIST.md](/home/ubuntu/starlog/docs/ANDROID_STORE_DISTRIBUTION_CHECKLIST.md).
- **Railway production freshness:** hosted page/API reachability was checked on 2026-05-15, but hosted
  passphrase login, hosted smoke, and release gate checks still need a fresh run before relying on
  hosted deployment state.
- **On-device-first voice completeness:** on-device STT/TTS direction is established, but mobile-native
  provider polish and fallback behavior still need focused validation.
- **Full assistant-ui runtime parity:** web assistant-ui coverage is partial and intentionally keeps
  compatibility fallbacks for unsupported Starlog protocol parts. Native mobile React Native
  assistant-ui parity remains in progress and still needs installed-device dynamic-panel proof.
- **Raw protocol label cleanup:** current UI harnesses check that labels such as `tool_call`,
  `tool_result`, protocol, runtime, and diagnostics stay out of default user-facing flows, but this
  remains a cleanup risk across older fallback renderer paths until assistant-ui coverage is complete.

## Evidence Map

- Latest local functional evidence:
  [artifacts/interview-prep-functional-2026-05-13](/home/ubuntu/starlog/artifacts/interview-prep-functional-2026-05-13)
- Fresh Android native functional proof: `/tmp/starlog-android-local-validation/builds/20260514T200744Z/`
  contains indexed screenshots in `latest.json` plus API evidence in `local-api.log` for Assistant
  command submission, native Study Core unlock/read/question writes, Review reveal and `Good` grade
  submission, briefing cache generation, notification permission, and Planner alarm scheduling on
  the connected Android device.
- Fresh focused backend validation: Python 3.12 API/study/assistant tests passed with
  `STARLOG_AI_RUNTIME_BASE_URL` set to a bogus localhost URL. NeetCode script tests pass under a
  clean Python 3.12 `uv` environment and prove that marking `Sliding Window` read releases a linked
  gated card only after prerequisites/read state are satisfied.
- Fresh frontend/native validation: the Next.js production build passed,
  `corepack pnpm --filter mobile test:study-mutations` passed, and the focused Playwright PWA
  Assistant study-command test passed against a local production web server with mocked API routes.
- Assistant-ui/dynamic UI status evidence is bounded by mocked protocol and view-model harnesses:
  desktop web assistant-ui rendering is partial with compatibility fallbacks, and mobile React Native
  dynamic panel shaping is in progress but not yet equivalent to native device automation.
- Fresh PDF deck-script validation proves `strings` cannot pass preflight/final-card generation,
  trusted LiteParse/local OCR extraction can produce final review-card JSONL, and noisy scanned
  extraction records blocked segments instead of weak cards. Temp DB validation of
  `scripts/import_pdf_review_cards.py` proves generated PDF cards remain gated until the imported
  Study topic is marked read. The importer is an upsert path for reviewed JSONL; it does not delete
  absent cards from earlier imports.
- Recommendation-hints and briefing-pressure regression coverage from merged PRs:
  [services/api/tests/test_assistant_api.py](/home/ubuntu/starlog/services/api/tests/test_assistant_api.py),
  [services/api/tests/test_storage_legacy_migrations.py](/home/ubuntu/starlog/services/api/tests/test_storage_legacy_migrations.py),
  [services/api/tests/test_briefing_memory.py](/home/ubuntu/starlog/services/api/tests/test_briefing_memory.py), and
  [services/api/app/services/memory_service.py](/home/ubuntu/starlog/services/api/app/services/memory_service.py).
- Focused Assistant recommendation surfacing validation: Python 3.12
  `tests/test_surface_summaries.py` coverage verifies recommendation events appear in Assistant Today
  `reason_stack`, and `/tmp/starlog-pwa-reason-stack/` contains a Playwright browser proof that the
  PWA Assistant renders those "Why now" reasons.

- Study Core backend and tests:
  [services/api/app/services/study_service.py](/home/ubuntu/starlog/services/api/app/services/study_service.py),
  [services/api/app/api/routes/study.py](/home/ubuntu/starlog/services/api/app/api/routes/study.py), and
  [services/api/tests/test_study.py](/home/ubuntu/starlog/services/api/tests/test_study.py)
- ML deck and SRS import:
  [docs/srs/README.md](/home/ubuntu/starlog/docs/srs/README.md),
  [scripts/bootstrap_ml_interview_srs.py](/home/ubuntu/starlog/scripts/bootstrap_ml_interview_srs.py), and
  [scripts/tests/test_ml_interview_srs.py](/home/ubuntu/starlog/scripts/tests/test_ml_interview_srs.py)
- PDF extraction/preflight:
  [docs/PDF_OCR_CARD_SMOKE.md](/home/ubuntu/starlog/docs/PDF_OCR_CARD_SMOKE.md),
  [scripts/pdf_deck_preflight.py](/home/ubuntu/starlog/scripts/pdf_deck_preflight.py), and
  [scripts/build_pdf_review_cards.py](/home/ubuntu/starlog/scripts/build_pdf_review_cards.py),
  [scripts/import_pdf_review_cards.py](/home/ubuntu/starlog/scripts/import_pdf_review_cards.py),
  [scripts/tests/test_build_pdf_review_cards.py](/home/ubuntu/starlog/scripts/tests/test_build_pdf_review_cards.py),
  [scripts/tests/test_import_pdf_review_cards.py](/home/ubuntu/starlog/scripts/tests/test_import_pdf_review_cards.py), and
  [services/api/tests/test_artifacts_pdf_cards.py](/home/ubuntu/starlog/services/api/tests/test_artifacts_pdf_cards.py)
- NeetCode source/import:
  [data/neetcode_150.json](/home/ubuntu/starlog/data/neetcode_150.json),
  [scripts/import_neetcode_150.py](/home/ubuntu/starlog/scripts/import_neetcode_150.py), and
  [scripts/tests/test_neetcode_prep.py](/home/ubuntu/starlog/scripts/tests/test_neetcode_prep.py)
- API stability baseline:
  [services/api/tests/conftest.py](/home/ubuntu/starlog/services/api/tests/conftest.py) and
  [services/api/pyproject.toml](/home/ubuntu/starlog/services/api/pyproject.toml)
- Current UI comparison and known visual/function gaps:
  [docs/UI_CONCEPT_COMPARISON_2026-04-29.md](/home/ubuntu/starlog/docs/UI_CONCEPT_COMPARISON_2026-04-29.md)
- Repeatable web/mobile functional harnesses:
  [docs/UI_FUNCTIONAL_TEST_HARNESSES.md](/home/ubuntu/starlog/docs/UI_FUNCTIONAL_TEST_HARNESSES.md)
- Cross-surface proof runner:
  [docs/CROSS_SURFACE_PROOF.md](/home/ubuntu/starlog/docs/CROSS_SURFACE_PROOF.md)
- Historical implementation log:
  [docs/IMPLEMENTATION_STATUS.md](/home/ubuntu/starlog/docs/IMPLEMENTATION_STATUS.md)
