# SRS Bootstrap Decks

This directory stores reviewable card decks that can seed Starlog's spaced-repetition queue.

Current deck:

- [ML Interviews Book Part II, 5.2.1.2 Questions](/home/ubuntu/starlog-worktrees/ml-interview-srs-bootstrap/docs/srs/ml-interviews-part-ii-probability-deck.json)
- [ML Interviews Book Part II, full question set](/home/ubuntu/starlog-worktrees/ml-interview-srs-bootstrap/data/ml_interviews_part_ii_qa_cards.jsonl)

Import locally:

```bash
cd /home/ubuntu/starlog-worktrees/ml-interview-srs-bootstrap
python3 scripts/import_srs_deck.py --deck docs/srs/ml-interviews-part-ii-probability-deck.json
```

Import the full Part II deck:

```bash
cd /home/ubuntu/starlog-worktrees/ml-interview-srs-bootstrap
python3 scripts/bootstrap_ml_interview_srs.py --deck data/ml_interviews_part_ii_qa_cards.jsonl
```

Dry-run validation:

```bash
cd /home/ubuntu/starlog-worktrees/ml-interview-srs-bootstrap
python3 scripts/import_srs_deck.py --deck docs/srs/ml-interviews-part-ii-probability-deck.json --dry-run
```

Regenerate the Part II deck:

```bash
cd /home/ubuntu/starlog-worktrees/ml-interview-srs-bootstrap
python3 scripts/build_ml_interview_srs_deck.py --output data/ml_interviews_part_ii_qa_cards.jsonl
```

The deck uses concise paraphrased answers and explicit source provenance so it can be extended to other chapters without losing traceability.
