# PDF OCR Card Smoke

Date: `2026-03-30`

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

Recommended local setup on this host:

```bash
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
cd /home/ubuntu/starlog-worktrees/pdf-ocr-liteparse-paddle
STARLOG_PADDLEOCR_USE_GPU=1 .venv-paddleocr-gpu/bin/python scripts/paddleocr_gpu_server.py
```

Then run the LiteParse parse server and point it at PaddleOCR:

```bash
cd /home/ubuntu/starlog-worktrees/pdf-ocr-liteparse-paddle
.venv-liteparse/bin/python scripts/liteparse_parse_server.py
```

The API smoke can then target the LiteParse server, which in turn can call PaddleOCR:

```bash
cd /home/ubuntu/starlog-worktrees/pdf-ocr-liteparse-paddle
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

## Validation

Focused regression:

```bash
cd services/api
PYTHONPATH=/home/ubuntu/starlog-worktrees/pdf-ocr-liteparse-paddle/services/api ./.venv/bin/pytest -q tests/test_pdf_ingest_service.py tests/test_research.py
```
