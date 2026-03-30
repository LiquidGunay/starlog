#!/usr/bin/env python3
from __future__ import annotations

import json
import os
import shutil
import subprocess
import tempfile
from pathlib import Path

from fastapi import FastAPI, File, Form, HTTPException, UploadFile

def _env_int(name: str, default: int, *, minimum: int | None = None) -> int:
    raw_value = os.getenv(name, "").strip()
    if not raw_value:
        value = default
    else:
        try:
            value = int(raw_value)
        except ValueError:
            value = default
    if minimum is not None:
        return max(minimum, value)
    return value


DEFAULT_PORT = _env_int("STARLOG_LITEPARSE_PORT", 8830, minimum=1)
DEFAULT_LITEPARSE_BIN = os.getenv("STARLOG_LITEPARSE_BIN", "lit").strip() or "lit"
DEFAULT_MAX_PAGES = _env_int("STARLOG_LITEPARSE_MAX_PAGES", 16, minimum=1)
DEFAULT_DPI = _env_int("STARLOG_LITEPARSE_DPI", 170, minimum=110)
DEFAULT_TIMEOUT_SECONDS = _env_int("STARLOG_LITEPARSE_TIMEOUT_SECONDS", 180, minimum=10)
DEFAULT_LANGUAGE = os.getenv("STARLOG_LITEPARSE_LANGUAGE", "en").strip() or "en"
DEFAULT_PADDLE_OCR_SERVER_URL = os.getenv("STARLOG_LITEPARSE_OCR_SERVER_URL", "").strip()
DEFAULT_OCR_ENABLED = os.getenv("STARLOG_LITEPARSE_OCR_ENABLED", "1").strip().lower() not in {"0", "false", "no"}

app = FastAPI(title="Starlog LiteParse Server")


def _bool_field(value: str | None, default: bool) -> bool:
    if value is None or not value.strip():
        return default
    return value.strip().lower() not in {"0", "false", "no"}


def _run_liteparse(
    pdf_path: Path,
    *,
    language: str,
    max_pages: int,
    dpi: int,
    ocr_enabled: bool,
    ocr_server_url: str,
) -> dict[str, object]:
    liteparse_bin = shutil.which(DEFAULT_LITEPARSE_BIN) or DEFAULT_LITEPARSE_BIN
    with tempfile.TemporaryDirectory(prefix="starlog-liteparse-out-") as temp_dir:
        output_path = Path(temp_dir) / "result.json"
        command = [
            liteparse_bin,
            "parse",
            str(pdf_path),
            "--format",
            "json",
            "-o",
            str(output_path),
            "--ocr-language",
            language,
            "--max-pages",
            str(max_pages),
            "--dpi",
            str(dpi),
            "-q",
        ]
        if not ocr_enabled:
            command.append("--no-ocr")
        elif ocr_server_url:
            command.extend(["--ocr-server-url", ocr_server_url])

        try:
            subprocess.run(
                command,
                check=True,
                capture_output=True,
                text=True,
                timeout=DEFAULT_TIMEOUT_SECONDS,
            )
        except FileNotFoundError as exc:
            raise HTTPException(status_code=503, detail=f"LiteParse binary not found: {liteparse_bin}") from exc
        except subprocess.TimeoutExpired as exc:
            raise HTTPException(status_code=504, detail="LiteParse parse timed out") from exc
        except subprocess.CalledProcessError as exc:
            stderr = (exc.stderr or exc.stdout or "").strip()
            raise HTTPException(status_code=502, detail=f"LiteParse parse failed: {stderr or 'unknown error'}") from exc

        try:
            payload = json.loads(output_path.read_text(encoding="utf-8"))
        except (OSError, ValueError) as exc:
            raise HTTPException(status_code=502, detail="LiteParse output was not valid JSON") from exc

    if not isinstance(payload, dict):
        raise HTTPException(status_code=502, detail="LiteParse output had an unexpected shape")
    return payload


@app.get("/healthz")
def healthz() -> dict[str, object]:
    return {
        "ok": True,
        "liteparse_bin": shutil.which(DEFAULT_LITEPARSE_BIN) or DEFAULT_LITEPARSE_BIN,
        "ocr_enabled": DEFAULT_OCR_ENABLED,
        "ocr_server_url": DEFAULT_PADDLE_OCR_SERVER_URL or None,
    }


@app.post("/parse")
async def parse(
    file: UploadFile = File(...),
    language: str = Form(DEFAULT_LANGUAGE),
    max_pages: int = Form(DEFAULT_MAX_PAGES),
    dpi: int = Form(DEFAULT_DPI),
    ocr_enabled: str = Form(""),
    ocr_server_url: str = Form(""),
) -> dict[str, object]:
    suffix = Path(file.filename or "document.pdf").suffix or ".pdf"
    requested_ocr_enabled = _bool_field(ocr_enabled, DEFAULT_OCR_ENABLED)
    requested_ocr_server_url = ocr_server_url.strip() or DEFAULT_PADDLE_OCR_SERVER_URL

    with tempfile.NamedTemporaryFile(prefix="starlog-liteparse-", suffix=suffix, delete=False) as handle:
        temp_path = Path(handle.name)
        handle.write(await file.read())

    try:
        payload = _run_liteparse(
            temp_path,
            language=language.strip() or DEFAULT_LANGUAGE,
            max_pages=max(1, max_pages),
            dpi=max(110, dpi),
            ocr_enabled=requested_ocr_enabled,
            ocr_server_url=requested_ocr_server_url,
        )
    finally:
        temp_path.unlink(missing_ok=True)

    return {
        "text": str(payload.get("text") or ""),
        "pages": payload.get("pages") or [],
        "metadata": {
            "engine": "liteparse",
            "language": language.strip() or DEFAULT_LANGUAGE,
            "max_pages": max(1, max_pages),
            "dpi": max(110, dpi),
            "ocr_enabled": requested_ocr_enabled,
            "ocr_server_url": requested_ocr_server_url or None,
        },
    }


if __name__ == "__main__":
    import uvicorn

    uvicorn.run(app, host="127.0.0.1", port=DEFAULT_PORT)
