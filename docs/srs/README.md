# SRS Bootstrap Decks

This directory stores reviewable card decks that can seed Starlog's spaced-repetition queue.
For the current works-today versus unproven interview-prep status, see
[docs/CURRENT_STATE.md](/home/ubuntu/starlog/docs/CURRENT_STATE.md).

Current deck:

- `data/ml_interviews_part_ii_qa_cards.jsonl`
- `data/neetcode_150.json`

Import the full Part II deck:

```bash
cd /home/ubuntu/starlog
python3 scripts/bootstrap_ml_interview_srs.py --deck data/ml_interviews_part_ii_qa_cards.jsonl
```

The importer is idempotent. Re-running it reuses the named `ML Interviews Part II` deck, the
bootstrap artifact, the first card-set version, and the deck note instead of appending duplicate
cards. Existing card review state (`due_at`, interval, repetitions, ease) is preserved while prompt,
answer, deck assignment, tags, and provenance note-block content are reconciled from the JSONL file.

Dry-run validation:

```bash
cd /home/ubuntu/starlog
python3 scripts/bootstrap_ml_interview_srs.py --deck data/ml_interviews_part_ii_qa_cards.jsonl --dry-run
python3 scripts/import_neetcode_150.py --source data/neetcode_150.json --dry-run
```

## NeetCode 150 source list

`data/neetcode_150.json` is the checked-in, user-editable prep source for NeetCode 150.
It stores only factual practice metadata: title, LeetCode URL, difficulty, pattern, prerequisites, and
an empty `notes` placeholder for user annotations. It intentionally excludes proprietary solution text,
problem statements, and generated answers.

`scripts/import_neetcode_150.py --dry-run` validates the list against the current NeetCode taxonomy
and builds deterministic practice-oriented review input payloads. The non-dry-run path is a narrow
adapter seam for WI-STUDY-CORE: once `app.services.study_core_service` exposes `upsert_review_inputs`
or `upsert_review_input`, the same stable `external_id` payloads can be idempotently upserted without
changing the source data format.

Regenerate the Part II deck:

```bash
cd /home/ubuntu/starlog
python3 scripts/build_ml_interview_srs_deck.py --output data/ml_interviews_part_ii_qa_cards.jsonl
```

The full deck is generated from the public Part II question index and aligned answers from the open `zafstojano/ml-interview-questions-and-answers` repository when available. Missing cards are retried with OpenAI-backed study answers, and only fall back to a short heuristic if both sources fail. Each imported card gets stable tags derived from section, difficulty, and answer source, plus a linked note block with import key, source URL/path, section, index, difficulty, answer provenance, and full source metadata.

For local PDF-based deck prep, preflight the source PDF before creating cards:

```bash
cd /home/ubuntu/starlog
PYTHONPATH=services/api ./services/api/.venv/bin/python scripts/pdf_deck_preflight.py \
  --pdf "/home/ubuntu/starlog/Inference Engineering.pdf"
```

The preflight writes evidence under `artifacts/pdf-deck-preflight/<timestamp>/` and generates no
cards. Treat `evidence_status: unproven` or `rejected_as_noise: true` as a blocker until local
LiteParse/OCR/text-layer extraction or reliable notes are available.
