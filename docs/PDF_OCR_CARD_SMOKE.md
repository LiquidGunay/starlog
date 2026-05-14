# PDF OCR Card Smoke

Date: `2026-03-30`

For the current PDF deck-prep status and `Inference Engineering.pdf` outcome, see
[docs/CURRENT_STATE.md](/home/ubuntu/starlog/docs/CURRENT_STATE.md).

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

1. `STARLOG_PDF_PARSE_SERVER_URL` if a local LiteParse parse server is configured
2. `STARLOG_PDF_OCR_SERVER_URL` if an OCR server is configured and the API environment can render PDF pages
3. `pypdf` if it is present in the environment
4. `strings` fallback if no proper PDF parser is available

This is enough to move the workflow forward today without forcing a repo-wide dependency change.
It is not the final OCR architecture.

## Recommended v1 OCR shape

Use desktop-hosted OCR as an optional assistive path, not a hard API requirement:

- Keep API ingest tolerant when no OCR backend exists.
- Prefer direct PDF text-layer extraction when available.
- Add an optional desktop-local OCR server for scanned PDFs and image-heavy lecture notes.
- LiteParse + PaddleOCR is a good fit for that optional server because it can stay laptop-local and
  only feed extracted text back into Starlog; it should not become a required hosted dependency for
  every deploy.

## LiteParse + PaddleOCR local path

This branch now includes two optional local runtime seams:

- `scripts/liteparse_parse_server.py`
- `scripts/paddleocr_gpu_server.py`
- `STARLOG_PDF_PARSE_SERVER_URL`
- `STARLOG_PDF_OCR_SERVER_URL`
- `STARLOG_PDF_OCR_LANGUAGE`

Recommended local setup on this host from the canonical checkout:

```bash
cd /home/ubuntu/starlog
uv venv .venv-paddleocr-gpu --python 3.12
uv venv .venv-liteparse --python 3.12
uv pip install --python .venv-paddleocr-gpu/bin/python paddlepaddle-gpu==3.3.0 -i https://www.paddlepaddle.org.cn/packages/stable/cu130/
uv pip install --python .venv-paddleocr-gpu/bin/python 'paddleocr>=3.4.0' fastapi uvicorn pillow python-multipart pymupdf httpx
uv pip install --python .venv-liteparse/bin/python liteparse fastapi uvicorn python-multipart
uv pip install --python services/api/.venv/bin/python pymupdf
npm i -g @llamaindex/liteparse
```

Run the local PaddleOCR server first:

```bash
cd /home/ubuntu/starlog
STARLOG_PADDLEOCR_USE_GPU=1 .venv-paddleocr-gpu/bin/python scripts/paddleocr_gpu_server.py
```

Then run the LiteParse parse server and point it at PaddleOCR:

```bash
cd /home/ubuntu/starlog
STARLOG_LITEPARSE_OCR_SERVER_URL=http://127.0.0.1:8829/ocr \
  .venv-liteparse/bin/python scripts/liteparse_parse_server.py
```

The API smoke can then target the LiteParse server, which in turn can call PaddleOCR:

```bash
cd /home/ubuntu/starlog
./services/api/.venv/bin/python scripts/pdf_artifact_smoke.py \
  --parse-server-url http://127.0.0.1:8830/parse \
  --ocr-server-url http://127.0.0.1:8829/ocr
```

`scripts/liteparse_parse_server.py` shells out to the official LiteParse CLI (`lit parse ... --format json`)
and exposes a stable `/parse` endpoint for Starlog. `scripts/paddleocr_gpu_server.py` stays compatible with
LiteParse's published OCR API (`POST /ocr`, multipart `file` + `language`, JSON `results` array). Sources:
[LiteParse README](https://github.com/run-llama/LiteParse) and [LiteParse OCR API spec](https://raw.githubusercontent.com/run-llama/LiteParse/main/OCR_API_SPEC.md).

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
- optionally routes the PDF through `STARLOG_PDF_PARSE_SERVER_URL`,
- optionally routes page images through `STARLOG_PDF_OCR_SERVER_URL`,
- runs `summarize`, `cards`, and `append_note`,
- writes JSON + Markdown evidence in `artifacts/pdf-ocr-smoke/<timestamp>/`.

## Expected evidence

- `input.pdf` - downloaded source PDF
- `report.json` - machine-readable smoke output
- `report.md` - human-readable summary and quiz-preview output

## Local deck preflight for `Inference Engineering.pdf`

Before making SRS cards from the local `Inference Engineering.pdf`, run the extraction-only preflight:

```bash
cd /home/ubuntu/starlog
PYTHONPATH=services/api ./services/api/.venv/bin/python scripts/pdf_deck_preflight.py \
  --pdf "/home/ubuntu/starlog/Inference Engineering.pdf"
```

This path calls `pdf_ingest_service.extract_pdf_text(Path(...))` directly. It does not boot FastAPI,
does not use `TestClient`, and only allows PDF parse/OCR server URLs on localhost. The report is
written under `artifacts/pdf-deck-preflight/<timestamp>/` and includes provider, mode, usable,
readable, `rejected_as_noise`, local runtime diagnostics, and next local steps.

If local LiteParse/OCR/text-layer extraction is unavailable or unreadable, the report marks the
evidence as `unproven`, writes `cards_generated: 0`, and blocks deck generation. The artifact action
path also blocks review-card generation for manual PDFs whose extraction was rejected as noise unless
the user supplied reliable notes.

After preflight passes with trusted local extraction, build final review-card JSONL with:

```bash
cd /home/ubuntu/starlog
PYTHONPATH=services/api ./services/api/.venv/bin/python scripts/build_pdf_review_cards.py \
  --pdf "/home/ubuntu/starlog/Inference Engineering.pdf" \
  --fail-on-blocked
```

This final-card builder reuses the same local URL restrictions and trust gate. It only writes
`review_cards.jsonl` when the provider is `liteparse_server`, `ocr_server`, or `pypdf` and the
individual source chunk is readable and content-like. Front matter, table-of-contents chunks,
appendix/resource-list chunks, `strings` fallback output, and noisy/scanned chunks are written as
blocked segment evidence rather than converted into weak cards. Do not commit generated
`review_cards.jsonl` files when they contain source excerpts from local PDFs.

Latest canonical-checkout result on 2026-05-13:

- Command:
  `/tmp/starlog-liteparse-cli/node_modules/.bin/lit parse "Inference Engineering.pdf" --format json -o /tmp/inference-engineering-liteparse-noocr.json --max-pages 20 --no-ocr -q`
- LiteParse direct CLI output:
  top-level JSON only had `pages`; 16 of the first 20 pages had `pages[].text`, with no top-level
  `text`.
- Server adapter fix:
  `scripts/liteparse_parse_server.py` now uses top-level `text` when present and otherwise
  aggregates cleaned `pages[].text`.
- Preflight validation command:
  `STARLOG_PDF_PARSE_SERVER_URL=http://127.0.0.1:8891/parse PYTHONPATH=services/api ./services/api/.venv/bin/python scripts/pdf_deck_preflight.py --pdf "/home/ubuntu/starlog/Inference Engineering.pdf"`
- Evidence:
  local preflight report `20260513T151430Z` confirmed the metrics below; do not commit generated
  readable-excerpt reports when they contain book text.
- Extraction:
  `provider=liteparse_server`, `mode=liteparse`, `usable=true`, `readable=true`,
  `rejected_as_noise=false`, `evidence_status=proven_local_text`, `cards_generated=0`
- Runtime diagnostics:
  the canonical API venv still lacks `pypdf`, `pymupdf`, LiteParse server deps, and PaddleOCR deps;
  the successful preflight used a temporary localhost parse-server shim backed by the local
  `/tmp` LiteParse CLI output.
- Next safe import step:
  run the real `scripts/liteparse_parse_server.py` with a local LiteParse CLI environment, rerun
  preflight with `STARLOG_PDF_PARSE_SERVER_URL=http://127.0.0.1:8830/parse`, then run
  `scripts/build_pdf_review_cards.py` against the same trusted extraction path. OCR is not required
  for this PDF when LiteParse `--no-ocr` succeeds.

## Validation

Focused regression:

```bash
cd services/api
PYTHONPATH=/home/ubuntu/starlog/services/api ./.venv/bin/pytest -q tests/test_pdf_ingest_service.py tests/test_research.py
```
