# SRS Bootstrap Decks

This directory stores reviewable card decks that can seed Starlog's spaced-repetition queue.

Current deck:

- `data/ml_interviews_part_ii_qa_cards.jsonl`

Import the full Part II deck:

```bash
cd /home/ubuntu/starlog
python3 scripts/bootstrap_ml_interview_srs.py --deck data/ml_interviews_part_ii_qa_cards.jsonl
```

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

The full deck is generated from the public Part II question index and aligned answers from the open `zafstojano/ml-interview-questions-and-answers` repository when available. Missing cards are retried with OpenAI-backed study answers, and only fall back to a short heuristic if both sources fail. Each imported card gets a linked note block with source URL, section, index, and answer provenance.
