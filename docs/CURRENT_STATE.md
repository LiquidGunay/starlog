# Current State

Last updated: 2026-05-13

This is the concise status page for what Starlog can be treated as working today versus what still
needs fresh proof. It is a docs-only synthesis of repo-local code, tests, and recent workitem
evidence; this update did not run new product validation.

Use [PLAN.md](/home/ubuntu/starlog/PLAN.md) and [VISION.md](/home/ubuntu/starlog/VISION.md) for
where Starlog is going. Use this page for current implementation confidence.

## Works Today

- **Core local stack:** the repo contains a FastAPI backend, Next.js PWA, native mobile app, desktop
  helper, browser extension scaffold, shared contracts, and AI runtime. Local startup is documented in
  [README.md](/home/ubuntu/starlog/README.md) and [docs/USER_GUIDE.md](/home/ubuntu/starlog/docs/USER_GUIDE.md).
- **Assistant-first product shape:** the current surface model is `Assistant`, `Library`, `Planner`,
  and `Review`, with the Assistant as the primary thread and the other surfaces as support views.
- **API stability baseline:** the API test harness now pins TestClient paths to Python 3.12 through
  [services/api/tests/conftest.py](/home/ubuntu/starlog/services/api/tests/conftest.py), and
  `httpx` is constrained to a compatible range for the current FastAPI/TestClient stack. Treat API
  tests as Python-3.12-local unless a newer runner is explicitly validated.
- **Study Core backend:** `/v1/study/*` routes and services exist for sources, topics, source chunks,
  card-topic links, practice items, practice attempts, question requests, and progress summary.
  Attempt creation and topic-read events can reflect into the Assistant event stream.
- **ML Interviews Part II SRS deck import:** `data/ml_interviews_part_ii_qa_cards.jsonl` is the
  checked-in deck source. `scripts/bootstrap_ml_interview_srs.py` is idempotent: it reuses the named
  deck, bootstrap artifact, first card-set version, and deck note while preserving existing review
  scheduling state. Dry-run import is documented in [docs/srs/README.md](/home/ubuntu/starlog/docs/srs/README.md).
- **PDF deck preflight safety path:** `scripts/pdf_deck_preflight.py` calls
  `pdf_ingest_service.extract_pdf_text(Path(...))` directly. It does not boot FastAPI, does not use
  FastAPI `TestClient`, and only allows localhost parse/OCR server URLs. Manual PDF card generation
  is blocked when extraction is unavailable or rejected as noise unless reliable user notes exist.
- **NeetCode 150 source list and dry-run importer:** `data/neetcode_150.json` contains 150 factual
  practice entries with stable IDs, LeetCode URLs, difficulty, pattern, prerequisites, and empty user
  notes. `scripts/import_neetcode_150.py --dry-run` validates taxonomy counts and builds stable
  review-input payloads without proprietary problem text or generated answers.
- **Historical desktop/PWA/mobile foundations:** earlier evidence covers the PWA Assistant/Library/
  Review surfaces, native Android shell, desktop helper, local AI worker, briefings, alarms, and
  hosted PWA/Railway path. Treat this as implementation existence and historical proof, not current
  release proof.

## Current Interview-Prep Loop

The merged interview-prep slice currently supports this local loop:

1. Import or validate structured study material:
   - ML Interviews Part II deck via `scripts/bootstrap_ml_interview_srs.py`.
   - NeetCode 150 source validation via `scripts/import_neetcode_150.py --dry-run`.
2. Use Study Core APIs to model sources, topics, source chunks, practice items, attempts, question
   requests, and progress.
3. Review SRS cards through the existing Review/Card APIs.
4. Preflight local PDFs before creating cards from them.

Known outcome for `Inference Engineering.pdf`:

- Latest local preflight evidence from WI-PDF-DECK-PREP reported `provider=strings`,
  `mode=heuristic_fallback`, `usable=false`, `readable=false`, `rejected_as_noise=true`, and
  `cards_generated=0`.
- That PDF is therefore **unproven for deck generation** until local LiteParse/OCR/text-layer
  extraction or reliable notes provide readable source text.

## Unproven Or Pending

- **Recommendation loop:** recommendation ranking, proactive study prioritization, and "what should I
  do next?" UI behavior are still pending unless a later merged workitem adds fresh evidence.
- **Functional mobile interview-prep evidence:** no current phone run proves the full interview-prep
  loop end to end. Existing phone screenshots and Android validation are historical or route-specific.
- **Current UI proof for interview prep:** no fresh desktop/mobile UI proof was run for Study Core,
  NeetCode, ML deck review, or PDF preflight as part of this docs update.
- **NeetCode non-dry-run import into Study Core:** the checked-in list and dry-run payload generation
  work, but the non-dry-run adapter still depends on a concrete Study Core review-input upsert API.
- **`Inference Engineering.pdf` cards:** blocked by unreadable local extraction. Do not generate weak
  cards from the title or noisy `strings` output.
- **Fresh end-to-end release confidence:** re-run [docs/CROSS_SURFACE_PROOF.md](/home/ubuntu/starlog/docs/CROSS_SURFACE_PROOF.md)
  before claiming current web + phone + helper release readiness.
- **Production Android store readiness:** Android release-signing, signed production QA smoke, store
  packaging, and final screenshots still require
  [docs/ANDROID_STORE_DISTRIBUTION_CHECKLIST.md](/home/ubuntu/starlog/docs/ANDROID_STORE_DISTRIBUTION_CHECKLIST.md).
- **Railway production freshness:** hosted URLs and smoke results are historical. Re-run public health,
  hosted smoke, and release gate checks before relying on hosted deployment state.
- **On-device-first voice completeness:** on-device STT/TTS direction is established, but mobile-native
  provider polish and fallback behavior still need focused validation.

## Evidence Map

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
