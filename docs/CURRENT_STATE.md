# Current State

Last updated: 2026-05-20

This is the concise status page for what Starlog can be treated as working today versus what still
needs fresh proof. It is a synthesis of repo-local code, tests, and the latest local PWA/Android
functional evidence.

Use [PLAN.md](/home/ubuntu/starlog/PLAN.md) and [VISION.md](/home/ubuntu/starlog/VISION.md) for
where Starlog is going. Use this page for current implementation confidence.

## Access + Validation Snapshot

- **Local PWA access paths:** laptop primary path is `http://localhost:3000`; phone browser fallback is
  `http://<LAN_IP>:3000` after `./scripts/dev_stack.sh --lan`.
- **Hosted Railway access paths:** hosted browser entry is
  `https://starlog-web-production.up.railway.app/login`; hosted API base is
  `https://starlog-api-production.up.railway.app`.
- **Hosted reachability known on 2026-05-19:** fresh public no-secret checks for `/login`,
  `/assistant`, and `/v1/health` returned Railway fallback `HTTP 404` responses with
  `x-railway-fallback: true`. Treat the configured Railway domains as not currently serving the
  Starlog web/API apps until deployment/domain routing is fixed and revalidated.
- **Hosted login status known:** authenticated hosted passphrase login was last proven on 2026-05-15,
  but that historical proof is superseded for current access confidence by the 2026-05-19 Railway
  fallback responses. Do not claim hosted authenticated Starlog session behavior until the public
  routes serve the app again and an authenticated smoke is rerun without exposing token material.
- **Native vs PWA priority:** native mobile is the primary phone surface; PWA is fallback-only on phone and
  remains supported for browser checks or when the app is unavailable.
- **assistant-ui migration status:** desktop web and native assistant-ui migration are partial. Web has
  assistant-ui `ExternalStoreRuntime` coverage for supported protocol snapshots plus data/tool UI
  rendering paths. Native currently uses an assistant-ui React Native `LocalRuntime` read-only host
  over server-owned Starlog messages; it is not yet the full visible phone chat/runtime replacement.
  Full server-owned runtime migration is still pending on both surfaces, and fallback renderers remain
  compatibility paths for unsupported/non-migrated protocol shapes, not the target runtime.
- **Clean PWA assistant/dynamic UI proof known on 2026-05-20:** `corepack pnpm test:ui:pwa-functional`
  passed with 14 tests, the full web Playwright config passed with 42 tests, and the live PWA
  interview flow spec passed with 1 test.
- **Mobile viewport/native-code UI proof known on 2026-05-20:** `corepack pnpm test:ui:mobile-functional`
  passed with 6 tests, and `apps/mobile` `test:assistant-ui-render`, `test:assistant-aui`, and
  `test:assistant-thread-actions` passed.
- **Native Android connected-phone proof known on 2026-05-20:** current physical-phone validation remains
  blocked because neither Linux `adb` nor Windows `adb.exe` listed a device row. The repo preflight
  `scripts/android_fresh_local_srs_validation.sh --adb-preflight-only` exited 2 with no visible device.
  Local-only evidence lives under `.localdata/android-local-validation/builds/20260520T172710Z/` and is
  not committed.
- **Validation cleanup known on 2026-05-20:** after proof cleanup, the canonical checkout was clean on
  `master` at `53d5597f8a7491c97d08b939f5ec88276382a501`, completed validation worktrees were
  pruned/removed, and the registered worktree list contained only `/home/ubuntu/starlog`.

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
- **Merged #231 (mobile dynamic panel host):** native Assistant dynamic-panel placement now uses a shared panel
  host path with `assistant-ui` metadata, while unsupported panel shapes still use fallback renderers.
- **Merged #233 (assistant runtime docs alignment):** current docs now document assistant-ui as the
  cross-surface target direction while keeping web/native migration boundaries explicit.
- **Merged #234 (objective evidence workflow):** added `scripts/agent_objective_evidence.py` and documented
  evidence-first supervisor flow in `docs/PARALLEL_AGENT_WORKFLOW.md` and `AGENTS.md`.
- **Merged #235 (PDF ingestion manifest evidence):** PDF preflight now emits `ingestion_manifest.json` with
  segment/page labels and `ocr_needed`, and import evidence writes `ocr_needed` into chunk/source metadata.

## Works Today

- **Core local stack:** the repo contains a FastAPI backend, Next.js PWA, native mobile app, desktop
  helper, browser extension scaffold, shared contracts, and AI runtime. Local startup is documented in
  [README.md](/home/ubuntu/starlog/README.md) and [docs/USER_GUIDE.md](/home/ubuntu/starlog/docs/USER_GUIDE.md).
- **Assistant-first product shape:** the current surface model is `Assistant`, `Library`, `Planner`,
  and `Review`, with the Assistant as the primary thread and the other surfaces as support views.
- **Assistant protocol direction:** Starlog's architecture decision is to use assistant-ui as the
  long-term chat runtime for desktop web and native mobile while keeping the Starlog assistant protocol
  as the source of truth.
  This is documented in
  [docs/ASSISTANT_RUNTIME_ARCHITECTURE_DECISION.md](/home/ubuntu/starlog/docs/ASSISTANT_RUNTIME_ARCHITECTURE_DECISION.md).
- **Web assistant-ui migration:** desktop web has partial assistant-ui `ExternalStoreRuntime` adapter
  coverage for supported Starlog assistant protocol snapshots. The adapter maps text, sources, tool
  calls, data parts, and selected dynamic-ui metadata/tool-result renderers; unsupported or not-yet
  migrated message/tool shapes still use Starlog compatibility projections and fallback render paths.
  This is partial coverage rather than full assistant-ui parity.
- **Mobile Assistant assistant-ui path:** native mobile has a React Native assistant-ui host and adapter
  coverage, but the current runtime is `server-owned-local-read-only`: a `LocalRuntime` seeded from
  server-owned Starlog messages with a read-only adapter. It is useful for rendering/transcript slices
  and selected dynamic-panel host integration, but it is not yet the full visible phone chat/runtime
  replacement unless the pending mobile runtime work lands and is validated.
- **Current local UI harness proof:** as of 2026-05-20, the clean PWA assistant/dynamic UI harness,
  full web Playwright config, live PWA interview flow spec, mobile viewport functional harness, and
  focused native assistant-ui rendering/thread-action tests passed. These prove current local web and
  native-code UI behavior; they do not replace physical connected-phone Android proof.
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
- **Minimal PWA interview-prep UI:** the PWA Review surface has thin controls for topic unlock/read,
  question-mode requests, progress state, and recommendation rationale.
- **Historical native interview-prep evidence:** older physical-device Android evidence showed Review
  study progress, topic unlock/read controls, question-mode requests, backend-owned card reveal, and
  review grading. Keep that as historical context only; current repeatable Android validation is blocked
  by ADB bridge/device-control instability until a fresh passing device run exists.
- **Live PWA interview-prep loop:** Playwright boots the local API and PWA, submits visible Assistant
  commands for `Sliding Window`, verifies due-card gating, reveals a Review card, returns to the
  Assistant to grade the generated review-grade dynamic UI, generates a recommendation-backed briefing,
  and creates an alarm.
- **Hosted PWA/API reachability:** `https://starlog-web-production.up.railway.app/login` is the intended
  hosted browser entry point and `https://starlog-api-production.up.railway.app` is the intended hosted
  API base. Fresh public checks on 2026-05-19 returned Railway fallback `HTTP 404` for hosted `/login`,
  `/assistant`, and `/v1/health`, so hosted Starlog access is currently unproven/broken. Authenticated
  hosted passphrase login was last proven on 2026-05-15, but that old proof should not be used for
  current readiness. Do not copy passphrases, bearer tokens, or token-bearing command output from local
  verification artifacts into docs.
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
   - **Status:** works in the live local PWA path. Android physical-device grading has historical
     evidence, but current repeatable validation is blocked on ADB bridge/device-control stability.
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
- **Railway production access:** public hosted page/API checks on 2026-05-19 returned Railway fallback
  `HTTP 404` for the configured web and API domains. Hosted smoke, release-gate checks, and any
  authenticated login claims are blocked until Railway deployment/domain routing serves Starlog again.
- **On-device-first voice completeness:** on-device STT/TTS direction is established, but mobile-native
  provider polish and fallback behavior still need focused validation.
- **Dynamic-panel parity status:** web and native assistant-ui coverage is partial and intentionally keeps
  compatibility fallbacks for unsupported Starlog protocol parts. Web has partial data/tool UI and
  dynamic-ui metadata paths. Native mobile currently uses a read-only assistant-ui `LocalRuntime` host
  over Starlog messages, so broader dynamic-panel host behavior, full server-owned runtime migration, and
  repeatable Android functional automation are still pending.
- **Android validation stability:** current Android validation is blocked until a physical phone is
  visible as a ready ADB `device`. On 2026-05-20, both Linux ADB and Windows ADB showed no device rows,
  and `scripts/android_fresh_local_srs_validation.sh --adb-preflight-only` exited 2 with no visible
  device. The local-only evidence directory for that blocked run is
  `.localdata/android-local-validation/builds/20260520T172710Z/`, which is intentionally uncommitted.
  Historical screenshots/manifests remain useful context, but they are not current release proof.
- **Raw protocol label cleanup:** most harnesses continue to hide protocol/runtime labels by default.
  Review-grade flow now has an installed-device assertion for raw `interview.review_grade` and
  `grade_review_recall`; older fallback renderer paths still need periodic evidence refresh.

## Evidence Map

- Current UI proof from 2026-05-20:
  - Clean PWA assistant/dynamic UI: `corepack pnpm test:ui:pwa-functional` passed 14 tests, the full
    web Playwright config passed 42 tests, and the live PWA interview flow spec passed 1 test.
  - Mobile viewport/native-code: `corepack pnpm test:ui:mobile-functional` passed 6 tests, and
    `apps/mobile` `test:assistant-ui-render`, `test:assistant-aui`, and
    `test:assistant-thread-actions` passed.
  - Connected-phone Android proof remains blocked: Linux ADB and Windows ADB both showed no device rows,
    and `scripts/android_fresh_local_srs_validation.sh --adb-preflight-only` exited 2. The associated
    local evidence remains under `.localdata/android-local-validation/builds/20260520T172710Z/` and is
    not committed.
- Hosted Railway access evidence:
  fresh public no-secret `curl` checks on 2026-05-19 returned Railway fallback `HTTP 404` with
  `x-railway-fallback: true` for `https://starlog-web-production.up.railway.app/login`,
  `https://starlog-web-production.up.railway.app/assistant`, and
  `https://starlog-api-production.up.railway.app/v1/health`. These checks intentionally did not use or
  expose the hosted passphrase or bearer token, and token material from local authenticated checks must
  not be copied into this document.
- Latest local functional evidence: regenerate from the relevant harness before claiming current
  confidence. Keep run output in `.localdata/`, `/tmp`, ignored build folders, or a single explicitly
  requested latest proof bundle; do not treat removed dated artifact folders as current evidence.
- Android native evidence should be written by `scripts/android_fresh_local_srs_validation.sh` and
  indexed in `.localdata/android-local-validation/builds/latest.json` (and companion artifact files
  listed there). On 2026-05-20, the latest preflight was blocked because neither Linux `adb` nor the
  documented Windows `adb.exe` route listed a ready device. Phone-level migration claims must wait for
  a fresh `validation_passed: true` run after the phone is attached, unlocked, and authorized. Older
  evidence remains historical context only.
- Fresh focused backend validation: Python 3.12 API/study/assistant tests passed with
  `STARLOG_AI_RUNTIME_BASE_URL` set to a bogus localhost URL. NeetCode script tests pass under a
  clean Python 3.12 `uv` environment and prove that marking `Sliding Window` read releases a linked
  gated card only after prerequisites/read state are satisfied.
- Recent frontend/native validation: the Next.js production build passed,
  `corepack pnpm --filter mobile test:study-mutations` passed, and the focused Playwright PWA
  Assistant study-command test passed against a local production web server with mocked API routes.
- Assistant-ui/dynamic UI status evidence is still bounded: desktop web assistant-ui rendering is
  partial with compatibility fallbacks, and mobile React Native uses a read-only assistant-ui
  `LocalRuntime` host over Starlog messages. Functional harnesses should require the actual Assistant
  surface for capability and review-grade dynamic UI proof, but current Android reruns are blocked until
  ADB bridge/device-control preflight is stable.
- The PDF pipeline now uses manifest-driven preflight evidence:
  `ingestion_manifest.json`, `candidate_cards.jsonl`, and blocked segment entries in the preflight report/
  manifest are the first pass for trusted extraction before final card import.
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
- Current UI targets and known visual/function gaps:
  [docs/ASSISTANT_UI_REFERENCE.md](/home/ubuntu/starlog/docs/ASSISTANT_UI_REFERENCE.md),
  [apps/web/app/design/assistant-runtime-reference/page.tsx](/home/ubuntu/starlog/apps/web/app/design/assistant-runtime-reference/page.tsx),
  [artifacts/ui-concept/pwa/EXPLANATION_OF_SCREENS_PWA.md](/home/ubuntu/starlog/artifacts/ui-concept/pwa/EXPLANATION_OF_SCREENS_PWA.md), and
  [artifacts/ui-concept/mobile/EXPLANATION_OF_SCREENS_MOBILE.md](/home/ubuntu/starlog/artifacts/ui-concept/mobile/EXPLANATION_OF_SCREENS_MOBILE.md)
- Repeatable web/mobile functional harnesses:
  [docs/UI_FUNCTIONAL_TEST_HARNESSES.md](/home/ubuntu/starlog/docs/UI_FUNCTIONAL_TEST_HARNESSES.md)
- Cross-surface proof runner:
  [docs/CROSS_SURFACE_PROOF.md](/home/ubuntu/starlog/docs/CROSS_SURFACE_PROOF.md)
- Historical implementation log:
  [docs/IMPLEMENTATION_STATUS.md](/home/ubuntu/starlog/docs/IMPLEMENTATION_STATUS.md)
