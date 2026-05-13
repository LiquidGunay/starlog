# SRS Bootstrap Decks

This directory stores reviewable card decks that can seed Starlog's spaced-repetition queue.

Current deck:

- `data/ml_interviews_part_ii_qa_cards.jsonl`

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
```

Regenerate the Part II deck:

```bash
cd /home/ubuntu/starlog
python3 scripts/build_ml_interview_srs_deck.py --output data/ml_interviews_part_ii_qa_cards.jsonl
```

The full deck is generated from the public Part II question index and aligned answers from the open `zafstojano/ml-interview-questions-and-answers` repository when available. Missing cards are retried with OpenAI-backed study answers, and only fall back to a short heuristic if both sources fail. Each imported card gets stable tags derived from section, difficulty, and answer source, plus a linked note block with import key, source URL/path, section, index, difficulty, answer provenance, and full source metadata.
