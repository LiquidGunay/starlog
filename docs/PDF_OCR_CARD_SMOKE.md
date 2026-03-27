# PDF OCR Card Smoke

Date: `2026-03-27`

This branch upgrades the manual PDF ingest path so Starlog stores extraction metadata plus any
available extracted PDF text on the artifact, rather than only the blob reference and title.

## What changed

- `POST /v1/research/manual-pdf` now attempts lightweight extraction during ingest.
- Extracted text, when available, is written into the artifact's `extracted_content`.
- Extraction provenance is stored under `metadata.pdf_extraction`.
- A runnable smoke script now exercises `manual-pdf -> summarize -> cards -> append_note` against
  the provided lecture-notes PDF and writes evidence under `artifacts/pdf-ocr-smoke/<timestamp>/`.

## Current extraction strategy

The implementation intentionally avoids a mandatory new API dependency.

Extraction order:

1. `pypdf` if it is present in the environment
2. `strings` fallback if no proper PDF parser is available

This is enough to move the workflow forward today without forcing a repo-wide dependency change.
It is not the final OCR architecture.

## Recommended v1 OCR shape

Use desktop-hosted OCR as an optional assistive path, not a hard API requirement:

- Keep API ingest tolerant when no OCR backend exists.
- Prefer direct PDF text-layer extraction when available.
- Add an optional desktop-local OCR server later for scanned PDFs and image-heavy lecture notes.
- LiteParse + PaddleOCR is a good fit for that optional server because it can stay laptop-local and
  only feed extracted text back into Starlog; it should not become a required hosted dependency for
  every deploy.

## Smoke command

Run from repo root:

```bash
./services/api/.venv/bin/python scripts/pdf_artifact_smoke.py
```

The script:

- downloads the user-provided lecture-notes PDF,
- boots the API in-process via `TestClient`,
- uploads the PDF as media,
- ingests it through `/v1/research/manual-pdf`,
- leaves `notes` empty by default so the smoke reflects the real extracted-text or rejection path,
- runs `summarize`, `cards`, and `append_note`,
- writes JSON + Markdown evidence in `artifacts/pdf-ocr-smoke/<timestamp>/`.

## Expected evidence

- `input.pdf` - downloaded source PDF
- `report.json` - machine-readable smoke output
- `report.md` - human-readable summary and quiz-preview output

## Validation

Focused regression:

```bash
cd services/api
PYTHONPATH=/home/ubuntu/starlog-worktrees/pdf-ocr-card-smoke/services/api ./.venv/bin/pytest -s tests/test_research.py -q
```
