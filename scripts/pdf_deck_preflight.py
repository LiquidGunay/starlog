#!/usr/bin/env python3
from __future__ import annotations

import argparse
import hashlib
import importlib.util
import json
import os
import re
import shutil
import sys
from datetime import datetime, timezone
from pathlib import Path
from urllib.error import URLError
from urllib.parse import urlparse, urlunparse
from urllib.request import Request, urlopen


LOCAL_HOSTS = {"localhost", "127.0.0.1", "::1", "0.0.0.0"}
SERVER_ENV_VARS = (
    "STARLOG_PDF_PARSE_SERVER_URL",
    "STARLOG_PDF_OCR_SERVER_URL",
    "STARLOG_PDF_PARSE_OCR_SERVER_URL",
)
LITEPARSE_SERVER_MODULES = ("fastapi", "uvicorn", "multipart")
PADDLEOCR_SERVER_MODULES = (
    "fastapi",
    "uvicorn",
    "multipart",
    "numpy",
    "PIL",
    "paddle",
    "paddleocr",
)
DEFAULT_CHUNK_WORDS = 160
DEFAULT_CHUNK_OVERLAP = 30
DEFAULT_MAX_CANDIDATE_CHUNKS = 14
UNKNOWN_PAGE_LABEL = "scan-unknown"


def parse_args() -> argparse.Namespace:
    repo_root = Path(__file__).resolve().parents[1]
    parser = argparse.ArgumentParser(
        description="Preflight a local PDF for deck work using Starlog's PDF text extraction only."
    )
    parser.add_argument(
        "--pdf",
        default=str(repo_root / "Inference Engineering.pdf"),
        help="Local PDF path to preflight.",
    )
    parser.add_argument(
        "--output-dir",
        default=str(repo_root / ".localdata/pdf-deck-preflight/latest"),
        help="Directory where JSON and Markdown evidence should be written.",
    )
    parser.add_argument(
        "--fail-on-unproven",
        action="store_true",
        help="Return a non-zero exit code when extraction is unavailable or rejected as noise.",
    )
    parser.add_argument(
        "--parse-max-pages",
        type=int,
        default=16,
        help="Maximum pages to request from a configured local LiteParse server.",
    )
    parser.add_argument(
        "--extract-max-chars",
        type=int,
        default=20000,
        help="Maximum extracted characters to inspect for this local preflight report.",
    )
    return parser.parse_args()


def _is_local_url(value: str) -> bool:
    parsed = urlparse(value)
    host = (parsed.hostname or "").strip().lower()
    return parsed.scheme in {"http", "https"} and host in LOCAL_HOSTS


def disable_nonlocal_pdf_server_env() -> dict[str, dict[str, str | bool]]:
    status: dict[str, dict[str, str | bool]] = {}
    for name in SERVER_ENV_VARS:
        value = os.getenv(name, "").strip()
        if not value:
            status[name] = {"configured": False, "allowed": False, "value": ""}
            continue
        allowed = _is_local_url(value)
        status[name] = {"configured": True, "allowed": allowed, "value": value}
        if not allowed:
            os.environ.pop(name, None)
    return status


def _module_status(names: tuple[str, ...]) -> dict[str, bool]:
    return {name: importlib.util.find_spec(name) is not None for name in names}


def _resolve_executable(command: str) -> str:
    resolved = shutil.which(command)
    if resolved:
        return resolved
    candidate = Path(command).expanduser()
    if candidate.is_file() and os.access(candidate, os.X_OK):
        return str(candidate)
    return ""


def _liteparse_binary_status(repo_root: Path) -> dict[str, object]:
    configured = os.getenv("STARLOG_LITEPARSE_BIN", "").strip()
    candidates = [configured] if configured else ["lit", str(repo_root / "node_modules/.bin/lit")]
    for candidate in candidates:
        if not candidate:
            continue
        resolved = _resolve_executable(candidate)
        if resolved:
            return {
                "configured": bool(configured),
                "command": configured or "lit",
                "available": True,
                "path": resolved,
            }
    return {
        "configured": bool(configured),
        "command": configured or "lit",
        "available": False,
        "path": "",
    }


def _healthz_url(value: str) -> str:
    parsed = urlparse(value)
    path = parsed.path or "/"
    if path.rstrip("/").endswith(("/parse", "/ocr")):
        path = path.rstrip("/").rsplit("/", 1)[0] or "/"
    path = f"{path.rstrip('/')}/healthz"
    return urlunparse(parsed._replace(path=path, params="", query="", fragment=""))


def _probe_local_server(value: str, *, timeout: float = 0.5) -> dict[str, object]:
    if not value:
        return {"reachable": False, "healthz_url": "", "error": "not_configured"}
    if not _is_local_url(value):
        return {"reachable": False, "healthz_url": "", "error": "nonlocal_url_blocked"}
    healthz_url = _healthz_url(value)
    request = Request(healthz_url, headers={"User-Agent": "Starlog/0.1 pdf-deck-preflight"})
    try:
        with urlopen(request, timeout=timeout) as response:
            body = response.read(4096).decode("utf-8", errors="replace")
    except (OSError, TimeoutError, URLError) as exc:
        return {"reachable": False, "healthz_url": healthz_url, "error": exc.__class__.__name__}
    try:
        payload = json.loads(body)
    except ValueError:
        payload = body[:300]
    return {"reachable": True, "healthz_url": healthz_url, "response": payload}


def _sha256_text(value: str) -> str:
    return hashlib.sha256(value.encode("utf-8")).hexdigest()


def _sha256_path(path: Path) -> str:
    hasher = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            hasher.update(chunk)
    return hasher.hexdigest()


def _source_slug(path: Path) -> str:
    slug = re.sub(r"[^a-z0-9]+", "-", path.stem.lower())
    return slug.strip("-") or "pdf"


def _segment_text(
    text: str,
    *,
    chunk_words: int = DEFAULT_CHUNK_WORDS,
    overlap_words: int = DEFAULT_CHUNK_OVERLAP,
    max_segments: int | None = None,
) -> list[tuple[int, int, str]]:
    normalized = re.sub(r"\s+", " ", text).strip()
    if not normalized:
        return []

    words = normalized.split()
    chunk_words = max(1, chunk_words)
    overlap_words = max(0, overlap_words)
    if overlap_words >= chunk_words:
        overlap_words = max(0, chunk_words // 3)
    step = max(1, chunk_words - overlap_words)

    segments: list[tuple[int, int, str]] = []
    start = 0
    while start < len(words):
        end = min(start + chunk_words, len(words))
        chunk = " ".join(words[start:end])
        if not chunk:
            break
        segments.append((start, end, chunk))
        if end >= len(words):
            break
        if max_segments is not None and len(segments) >= max_segments:
            break
        start += step
    return segments


def _build_candidate_cards(
    pdf_path: Path,
    run_id: str,
    extraction: dict[str, object],
    text: str,
    *,
    chunk_words: int = DEFAULT_CHUNK_WORDS,
    overlap_words: int = DEFAULT_CHUNK_OVERLAP,
    max_cards: int = DEFAULT_MAX_CANDIDATE_CHUNKS,
) -> list[dict[str, object]]:
    source_slug = _source_slug(pdf_path)
    source_sha = _sha256_path(pdf_path)
    chunks = _segment_text(
        text,
        chunk_words=chunk_words,
        overlap_words=overlap_words,
        max_segments=max_cards,
    )
    if not chunks:
        return []

    candidates: list[dict[str, object]] = []
    for index, (start_word, end_word, chunk_text) in enumerate(chunks):
        chunk_hash = _sha256_text(chunk_text)
        candidates.append(
            {
                "candidate_id": f"{source_slug}-{chunk_hash[:16]}",
                "status": "candidate",
                "card_type": "qa",
                "prompt": "Draft a single high-signal QA flashcard from this source chunk.",
                "answer": "",
                "provenance": {
                    "source": {
                        "run_id": run_id,
                        "pdf_path": str(pdf_path),
                        "pdf_sha256": source_sha,
                        "provider": extraction.get("provider") or "none",
                        "mode": extraction.get("mode") or "unavailable",
                    },
                    "readability": {
                        "readable": bool(extraction.get("readable")),
                        "usable": bool(extraction.get("usable")),
                        "readability_score": extraction.get("readability_score"),
                    },
                    "chunk": {
                        "index": index,
                        "word_start": start_word,
                        "word_end": end_word,
                        "word_count": max(0, end_word - start_word),
                        "character_count": len(chunk_text),
                        "content_sha256": chunk_hash,
                    },
                },
            }
        )
    return candidates


def _build_blocked_segments(
    text: str,
    run_id: str,
    reason: str,
    *,
    page_status: str = "unproven",
    ocr_needed: bool = False,
    chunk_words: int = DEFAULT_CHUNK_WORDS,
    overlap_words: int = DEFAULT_CHUNK_OVERLAP,
    max_segments: int = DEFAULT_MAX_CANDIDATE_CHUNKS,
) -> list[dict[str, object]]:
    chunks = _segment_text(
        text,
        chunk_words=chunk_words,
        overlap_words=overlap_words,
        max_segments=max_segments,
    )
    if not chunks:
        return [
            {
                "segment_id": f"source-block-{run_id[:6]}",
                "reason": reason,
                "status": "blocked",
                "chunk_index": 0,
                "word_start": 0,
                "word_end": 0,
                "word_count": 0,
                "content_sha256": "",
                "page_status": page_status,
                "ocr_needed": ocr_needed,
                "page_label": UNKNOWN_PAGE_LABEL,
                "page_start": None,
                "page_end": None,
            }
        ]

    blocked: list[dict[str, object]] = []
    for index, (start_word, end_word, chunk_text) in enumerate(chunks):
        blocked.append(
            {
                "segment_id": f"source-block-{run_id[:6]}-{index:02d}",
                "reason": reason,
                "status": "blocked",
                "chunk_index": index,
                "word_start": start_word,
                "word_end": end_word,
                "word_count": max(0, end_word - start_word),
                "content_sha256": _sha256_text(chunk_text),
                "character_count": len(chunk_text),
                "page_status": page_status,
                "ocr_needed": ocr_needed,
                "page_label": UNKNOWN_PAGE_LABEL,
                "page_start": None,
                "page_end": None,
            }
        )
    return blocked


def _build_ingestion_manifest(
    run_id: str,
    text: str,
    *,
    candidate_cards: list[dict[str, object]] | None = None,
    blocked_segments: list[dict[str, object]] | None = None,
    default_page_status: str = "unproven",
    default_ocr_needed: bool = False,
    reason: str | None = None,
) -> dict[str, object]:
    segments: list[dict[str, object]] = []
    if candidate_cards:
        for card in candidate_cards:
            chunk = card.get("provenance", {})
            chunk = chunk.get("chunk") if isinstance(chunk, dict) else {}
            chunk_index = int(chunk.get("index") or 0)
            segments.append(
                {
                    "segment_id": str(card.get("candidate_id") or f"candidate-{run_id[:6]}-{chunk_index:02d}"),
                    "status": str(card.get("status") or "candidate"),
                    "chunk_index": chunk_index,
                    "word_start": int(chunk.get("word_start") or 0),
                    "word_end": int(chunk.get("word_end") or 0),
                    "word_count": int(chunk.get("word_count") or 0),
                    "content_sha256": str(chunk.get("content_sha256") or ""),
                    "character_count": int(chunk.get("character_count") or 0),
                    "reason": "Trusted local extraction candidate.",
                    "page_status": "ready",
                    "ocr_needed": False,
                    "page_label": UNKNOWN_PAGE_LABEL,
                    "page_start": None,
                    "page_end": None,
                }
            )
    elif blocked_segments:
        for segment in blocked_segments:
            if not isinstance(segment, dict):
                continue
            segment_record = dict(segment)
            segment_record.setdefault("status", "blocked")
            segment_record.setdefault("reason", reason or "Blocked by preflight extraction policy.")
            segment_record.setdefault("page_status", default_page_status)
            segment_record.setdefault("ocr_needed", default_ocr_needed)
            segment_record.setdefault("page_label", UNKNOWN_PAGE_LABEL)
            segment_record.setdefault("page_start", None)
            segment_record.setdefault("page_end", None)
            segment_record.setdefault("character_count", 0)
            segment_record.setdefault("chunk_index", 0)
            segments.append(segment_record)
    else:
        segments.append(
            {
                "segment_id": f"manifest-{run_id[:6]}",
                "status": "blocked",
                "chunk_index": 0,
                "word_start": 0,
                "word_end": 0,
                "word_count": 0,
                "content_sha256": "",
                "character_count": len(text.strip()),
                "reason": reason or "No extractable text available for page/chunk manifest.",
                "page_status": default_page_status,
                "ocr_needed": default_ocr_needed,
                "page_label": UNKNOWN_PAGE_LABEL,
                "page_start": None,
                "page_end": None,
            }
        )
    return {
        "run_id": run_id,
        "status": "ready",
        "page_labeling": {
            "default_label": UNKNOWN_PAGE_LABEL,
            "page_tracking": "not-available-in-local-extraction-hook",
            "ocr_needed_flag": bool(default_ocr_needed),
        },
        "segments": segments,
    }


def runtime_status(server_env: dict[str, dict[str, str | bool]] | None = None) -> dict[str, object]:
    repo_root = Path(__file__).resolve().parents[1]
    server_env = server_env or disable_nonlocal_pdf_server_env()
    liteparse_modules = _module_status(LITEPARSE_SERVER_MODULES)
    paddleocr_modules = _module_status(PADDLEOCR_SERVER_MODULES)
    text_modules = _module_status(("pypdf", "fitz"))
    parse_server_env = server_env["STARLOG_PDF_PARSE_SERVER_URL"]
    ocr_server_env = server_env["STARLOG_PDF_OCR_SERVER_URL"]
    parse_ocr_server_env = server_env["STARLOG_PDF_PARSE_OCR_SERVER_URL"]

    return {
        "direct_text_layer": {
            "pypdf_available": text_modules["pypdf"],
            "pymupdf_available": text_modules["fitz"],
        },
        "liteparse": {
            "binary": _liteparse_binary_status(repo_root),
            "server_modules": liteparse_modules,
            "server_modules_ready": all(liteparse_modules.values()),
            "parse_server_url": parse_server_env,
            "parse_server_probe": _probe_local_server(str(parse_server_env["value"]))
            if parse_server_env["allowed"]
            else {"reachable": False, "healthz_url": "", "error": "not_configured_or_blocked"},
        },
        "paddleocr": {
            "server_modules": paddleocr_modules,
            "server_modules_ready": all(paddleocr_modules.values()),
            "ocr_server_url": ocr_server_env,
            "parse_ocr_server_url": parse_ocr_server_env,
            "ocr_server_probe": _probe_local_server(str(ocr_server_env["value"]))
            if ocr_server_env["allowed"]
            else {"reachable": False, "healthz_url": "", "error": "not_configured_or_blocked"},
            "parse_ocr_server_probe": _probe_local_server(str(parse_ocr_server_env["value"]))
            if parse_ocr_server_env["allowed"]
            else {"reachable": False, "healthz_url": "", "error": "not_configured_or_blocked"},
        },
        "strings_available": shutil.which("strings") is not None,
    }


def _status_label(usable: bool, readable: bool, rejected_as_noise: bool, provider: str) -> tuple[str, str]:
    if provider == "strings":
        return "unproven", "blocked_string_fallback"
    if usable or readable:
        return "proven_local_text", "preflight_passed"
    if rejected_as_noise:
        return "unproven", "blocked_unreadable_extraction"
    if provider == "none":
        return "unproven", "blocked_extraction_unavailable"
    return "unproven", "blocked_extraction_not_readable"


def _manifest_status(provider: str, deck_generation: str) -> tuple[str, bool]:
    if deck_generation == "blocked_string_fallback" or provider == "strings":
        return "ocr_needed", True
    if deck_generation == "blocked_extraction_unavailable":
        return "unavailable", False
    if deck_generation in {"blocked_extraction_not_readable", "blocked_unreadable_extraction"}:
        return "unproven", False
    if deck_generation == "preflight_passed":
        return "ready", False
    return "unproven", False


def _next_local_steps(report: dict[str, object]) -> list[str]:
    extraction = report["extraction"]
    runtime = report["runtime"]
    assert isinstance(extraction, dict)
    assert isinstance(runtime, dict)
    if report["evidence_status"] == "proven_local_text":
        return [
            "Use the readable local extraction as the source for the next deck import step; keep cards_generated at 0 in this preflight-only report.",
        ]

    steps: list[str] = []
    liteparse = runtime.get("liteparse") if isinstance(runtime.get("liteparse"), dict) else {}
    paddleocr = runtime.get("paddleocr") if isinstance(runtime.get("paddleocr"), dict) else {}
    direct_text = runtime.get("direct_text_layer") if isinstance(runtime.get("direct_text_layer"), dict) else {}
    liteparse_binary = liteparse.get("binary") if isinstance(liteparse, dict) else {}
    parse_server_url = liteparse.get("parse_server_url") if isinstance(liteparse, dict) else {}
    parse_server_probe = liteparse.get("parse_server_probe") if isinstance(liteparse, dict) else {}

    if not bool(direct_text.get("pypdf_available")):
        steps.append(
            "Optional fast path: install `pypdf` in the API Python environment and rerun the "
            "preflight to try the PDF text layer."
        )
    if not bool(direct_text.get("pymupdf_available")):
        steps.append(
            "Optional OCR render path: install `pymupdf` in the API Python environment before "
            "using `STARLOG_PDF_OCR_SERVER_URL` directly."
        )

    if not bool(liteparse_binary.get("available")):
        steps.append(
            "LiteParse CLI is not available as `lit`; install `@llamaindex/liteparse` or set "
            "`STARLOG_LITEPARSE_BIN` to a local executable."
        )
    if not bool(liteparse.get("server_modules_ready")):
        steps.append(
            "LiteParse server Python deps are incomplete; install `fastapi`, `uvicorn`, and "
            "`python-multipart` in the LiteParse server environment."
        )
    if not bool(paddleocr.get("server_modules_ready")):
        steps.append(
            "PaddleOCR server deps are incomplete; install local GPU-capable "
            "`paddlepaddle-gpu`, `paddleocr`, `pillow`, `numpy`, `fastapi`, `uvicorn`, "
            "`python-multipart`, and `pymupdf` as documented."
        )

    parse_configured = bool(parse_server_url.get("configured")) if isinstance(parse_server_url, dict) else False
    parse_reachable = bool(parse_server_probe.get("reachable")) if isinstance(parse_server_probe, dict) else False
    if not parse_configured:
        steps.append(
            "Start `scripts/paddleocr_gpu_server.py`, then `scripts/liteparse_parse_server.py`, "
            "and rerun with `STARLOG_PDF_PARSE_SERVER_URL=http://127.0.0.1:8830/parse`."
        )
    elif not parse_reachable:
        steps.append(
            "The configured LiteParse parse server is not reachable on `/healthz`; start it "
            "locally or fix `STARLOG_PDF_PARSE_SERVER_URL` before rerunning."
        )

    if extraction.get("rejected_as_noise"):
        steps.append("Do not generate cards from this run; the current extraction was rejected as noisy/unreadable.")
    if extraction.get("provider") == "strings":
        steps.append(
            "Do not use `strings` output for card prep; rerun with local LiteParse or direct text-layer extraction."
        )
    return steps


def _remove_stale_output_files(output_dir: Path) -> None:
    for name in ("report.json", "report.md", "ingestion_manifest.json", "candidate_cards.jsonl"):
        path = output_dir / name
        if path.exists():
            path.unlink()


def _is_relative_to(path: Path, root: Path) -> bool:
    try:
        path.relative_to(root)
    except ValueError:
        return False
    return True


def _has_suffix(path: Path, suffix: Path) -> bool:
    return tuple(path.parts[-len(suffix.parts) :]) == suffix.parts


def _validate_safe_output_dir(output_dir: Path, repo_root: Path, label: str) -> None:
    lane_suffix = Path(".localdata/pdf-deck-preflight/latest")
    localdata_root = repo_root / ".localdata"
    lane_root = localdata_root / "pdf-deck-preflight"
    artifacts_root = repo_root / "artifacts"
    tmp_root = Path("/tmp")
    unsafe_dirs = {Path("/"), tmp_root, repo_root, localdata_root, repo_root.parent}
    if not output_dir.is_absolute() or output_dir in unsafe_dirs:
        raise ValueError(f"refusing unsafe PDF preflight output dir ({label}): {output_dir}")
    if output_dir == artifacts_root or _is_relative_to(output_dir, artifacts_root):
        raise ValueError(f"refusing PDF preflight output dir under tracked artifacts root ({label}): {output_dir}")
    if output_dir == tmp_root or _is_relative_to(output_dir, tmp_root):
        raise ValueError(f"refusing PDF preflight output dir under /tmp ({label}): {output_dir}")
    if not _has_suffix(output_dir, lane_suffix):
        raise ValueError(
            "PDF preflight output dir must end with "
            f"{lane_suffix.as_posix()} ({label}): {output_dir}"
        )
    if not _is_relative_to(output_dir, lane_root):
        raise ValueError(f"PDF preflight output dir must stay under {lane_root} ({label}): {output_dir}")


def _replace_stable_output_dir(output_dir: Path, repo_root: Path) -> Path:
    lexical_dir = output_dir.expanduser()
    resolved_dir = lexical_dir.resolve()
    _validate_safe_output_dir(lexical_dir, repo_root, "lexical")
    _validate_safe_output_dir(resolved_dir, repo_root, "resolved")
    if resolved_dir.exists():
        shutil.rmtree(resolved_dir)
    resolved_dir.mkdir(parents=True, exist_ok=True)
    return resolved_dir


def build_report(
    pdf_path: Path,
    output_dir: Path,
    *,
    parse_max_pages: int = 16,
    extract_max_chars: int = 20000,
) -> dict[str, object]:
    repo_root = Path(__file__).resolve().parents[1]
    services_api = repo_root / "services/api"
    if str(services_api) not in sys.path:
        sys.path.insert(0, str(services_api))

    from app.services import pdf_ingest_service

    if not pdf_path.exists():
        raise FileNotFoundError(f"PDF not found: {pdf_path}")
    if not pdf_path.is_file():
        raise ValueError(f"PDF path is not a file: {pdf_path}")

    server_env = disable_nonlocal_pdf_server_env()
    parse_max_pages = max(1, min(parse_max_pages, 512))
    previous_page_limit = os.environ.get("STARLOG_PDF_PARSE_MAX_PAGE_LIMIT")
    previous_pages = os.environ.get("STARLOG_PDF_PARSE_MAX_PAGES")
    os.environ["STARLOG_PDF_PARSE_MAX_PAGE_LIMIT"] = str(parse_max_pages)
    os.environ["STARLOG_PDF_PARSE_MAX_PAGES"] = str(parse_max_pages)
    try:
        extraction = pdf_ingest_service.extract_pdf_text(pdf_path, max_characters=max(1000, extract_max_chars))
    finally:
        if previous_page_limit is None:
            os.environ.pop("STARLOG_PDF_PARSE_MAX_PAGE_LIMIT", None)
        else:
            os.environ["STARLOG_PDF_PARSE_MAX_PAGE_LIMIT"] = previous_page_limit
        if previous_pages is None:
            os.environ.pop("STARLOG_PDF_PARSE_MAX_PAGES", None)
        else:
            os.environ["STARLOG_PDF_PARSE_MAX_PAGES"] = previous_pages
    text = str(extraction.get("text") or "").strip()
    usable = bool(extraction.get("usable")) and bool(text)
    readable = bool(extraction.get("readable")) and bool(text)
    rejected_as_noise = bool(text) and not (usable or readable)
    provider = str(extraction.get("provider") or "none")
    evidence_status, deck_generation = _status_label(usable, readable, rejected_as_noise, provider)

    started_at = datetime.now(timezone.utc)
    run_id = started_at.strftime("%Y%m%dT%H%M%SZ")
    run_dir = output_dir
    run_dir.mkdir(parents=True, exist_ok=True)
    _remove_stale_output_files(run_dir)

    candidate_count = 0
    blocked_chunks: list[dict[str, object]] = []
    ingestion_manifest_path = ""
    candidate_cards_path = ""
    candidate_cards: list[dict[str, object]] = []
    manifest_page_status, manifest_ocr_needed = _manifest_status(provider, deck_generation)
    if evidence_status == "proven_local_text" and provider != "strings":
        candidate_cards = _build_candidate_cards(
            pdf_path,
            run_id,
            {
                "provider": provider,
                "mode": extraction.get("mode") or "unavailable",
                "readable": readable,
                "usable": usable,
                "readability_score": extraction.get("readability_score"),
            },
            text,
        )
        candidate_count = len(candidate_cards)
        if candidate_cards:
            candidate_cards_path = str((run_dir / "candidate_cards.jsonl"))
            (run_dir / "candidate_cards.jsonl").write_text(
                "\n".join(json.dumps(item, sort_keys=True) for item in candidate_cards) + "\n",
                encoding="utf-8",
            )
    elif text:
        blocked_chunks = _build_blocked_segments(
            text,
            run_id,
            f"Card candidates blocked: {deck_generation}",
            page_status=manifest_page_status,
            ocr_needed=manifest_ocr_needed,
        )
    ingestion_manifest = _build_ingestion_manifest(
        run_id,
        text,
        candidate_cards=candidate_cards if candidate_cards else None,
        blocked_segments=blocked_chunks if blocked_chunks else None,
        default_page_status=manifest_page_status,
        default_ocr_needed=manifest_ocr_needed,
        reason=f"Preflight {deck_generation}",
    )
    if not candidate_cards and not blocked_chunks and evidence_status == "proven_local_text":
        ingestion_manifest["status"] = "manifest-empty"
    ingestion_manifest_path = str((run_dir / "ingestion_manifest.json"))
    (run_dir / "ingestion_manifest.json").write_text(
        json.dumps(ingestion_manifest, indent=2, sort_keys=True) + "\n",
        encoding="utf-8",
    )

    report: dict[str, object] = {
        "run_id": run_id,
        "pdf_path": str(pdf_path),
        "pdf_size_bytes": pdf_path.stat().st_size,
        "started_at": started_at.isoformat(),
        "cloud_ocr_policy": "disabled; only localhost parse/OCR server URLs are allowed",
        "server_env": server_env,
        "runtime": runtime_status(server_env),
        "extraction": {
            "provider": provider,
            "mode": extraction.get("mode") or "unavailable",
            "characters": int(extraction.get("characters") or 0),
            "source_characters": int(extraction.get("source_characters") or extraction.get("characters") or 0),
            "truncated": bool(extraction.get("truncated")),
            "text_limit": int(extraction.get("text_limit") or max(1000, extract_max_chars)),
            "usable": usable,
            "readable": readable,
            "rejected_as_noise": rejected_as_noise,
            "alpha_ratio": extraction.get("alpha_ratio"),
            "space_ratio": extraction.get("space_ratio"),
            "unique_ratio": extraction.get("unique_ratio"),
            "long_word_count": extraction.get("long_word_count"),
            "word_count": extraction.get("word_count"),
            "common_word_count": extraction.get("common_word_count"),
            "readability_score": extraction.get("readability_score"),
        },
        "evidence_status": evidence_status,
        "deck_generation": deck_generation,
        "cards_generated": 0,
        "candidate_cards_path": candidate_cards_path,
        "candidate_count": candidate_count,
        "ingestion_manifest_path": ingestion_manifest_path,
        "candidate_window": {
            "chunk_words": DEFAULT_CHUNK_WORDS,
            "chunk_overlap": DEFAULT_CHUNK_OVERLAP,
            "max_candidates": DEFAULT_MAX_CANDIDATE_CHUNKS,
            "parse_max_pages": parse_max_pages,
            "extract_max_chars": max(1000, extract_max_chars),
        },
        "blocked_chunks": blocked_chunks,
        "unproven_note": ""
        if evidence_status == "proven_local_text"
        else "No deck cards were generated because local extraction did not prove safe readable source text.",
    }
    report["next_local_steps"] = _next_local_steps(report)

    report_path = run_dir / "report.json"
    markdown_path = run_dir / "report.md"
    report_path.write_text(json.dumps(report, indent=2, sort_keys=True) + "\n", encoding="utf-8")
    markdown_path.write_text(_markdown_report(report), encoding="utf-8")
    report["report_path"] = str(report_path)
    report["markdown_path"] = str(markdown_path)
    return report


def _markdown_report(report: dict[str, object]) -> str:
    extraction = report["extraction"]
    runtime = report["runtime"]
    assert isinstance(extraction, dict)
    assert isinstance(runtime, dict)
    lines = [
        f"# PDF Deck Preflight {report['run_id']}",
        "",
        f"- PDF path: `{report['pdf_path']}`",
        f"- Cloud OCR policy: `{report['cloud_ocr_policy']}`",
        f"- Provider: `{extraction.get('provider')}`",
        f"- Mode: `{extraction.get('mode')}`",
        f"- Usable: `{extraction.get('usable')}`",
        f"- Readable: `{extraction.get('readable')}`",
        f"- Rejected as noise: `{extraction.get('rejected_as_noise')}`",
        f"- Evidence status: `{report['evidence_status']}`",
        f"- Deck generation: `{report['deck_generation']}`",
        f"- Cards generated: `{report['cards_generated']}`",
        f"- Candidate cards generated: `{report['candidate_count']}`",
        f"- Candidate file: `{report.get('candidate_cards_path')}`",
        f"- Ingestion manifest: `{report.get('ingestion_manifest_path')}`",
        "",
    ]
    lines.extend(_markdown_runtime(runtime))
    next_steps = report.get("next_local_steps")
    if isinstance(next_steps, list) and next_steps:
        lines.extend(["## Next Local Steps", ""])
        lines.extend(f"- {step}" for step in next_steps)
        lines.append("")
    note = str(report.get("unproven_note") or "")
    if note:
        lines.extend(["## Unproven Evidence", "", note, ""])
    blocked_chunks = report.get("blocked_chunks")
    if isinstance(blocked_chunks, list) and blocked_chunks:
        lines.extend(["## Blocked Segments", ""])
        for segment in blocked_chunks:
            lines.append(
                f"- segment={segment.get('segment_id')} reason={segment.get('reason')} "
                f"words={segment.get('word_count')}"
            )
        lines.append("")
    return "\n".join(lines) + "\n"


def _markdown_runtime(runtime: dict[str, object]) -> list[str]:
    direct_text = runtime.get("direct_text_layer") if isinstance(runtime.get("direct_text_layer"), dict) else {}
    liteparse = runtime.get("liteparse") if isinstance(runtime.get("liteparse"), dict) else {}
    paddleocr = runtime.get("paddleocr") if isinstance(runtime.get("paddleocr"), dict) else {}
    liteparse_binary = liteparse.get("binary") if isinstance(liteparse, dict) else {}
    parse_probe = liteparse.get("parse_server_probe") if isinstance(liteparse, dict) else {}
    ocr_probe = paddleocr.get("ocr_server_probe") if isinstance(paddleocr, dict) else {}
    parse_ocr_probe = paddleocr.get("parse_ocr_server_probe") if isinstance(paddleocr, dict) else {}
    return [
        "## Local Runtime Diagnostics",
        "",
        f"- Direct `pypdf`: `{direct_text.get('pypdf_available')}`",
        f"- Direct `pymupdf`/`fitz`: `{direct_text.get('pymupdf_available')}`",
        f"- LiteParse CLI available: `{liteparse_binary.get('available')}`"
        + (f" (`{liteparse_binary.get('path')}`)" if liteparse_binary.get("path") else ""),
        f"- LiteParse server Python deps ready: `{liteparse.get('server_modules_ready')}`",
        f"- LiteParse parse server reachable: `{parse_probe.get('reachable')}`"
        + (f" (`{parse_probe.get('healthz_url')}`)" if parse_probe.get("healthz_url") else ""),
        f"- PaddleOCR server Python deps ready: `{paddleocr.get('server_modules_ready')}`",
        f"- PaddleOCR OCR server reachable: `{ocr_probe.get('reachable')}`"
        + (f" (`{ocr_probe.get('healthz_url')}`)" if ocr_probe.get("healthz_url") else ""),
        f"- Parse-server OCR endpoint reachable: `{parse_ocr_probe.get('reachable')}`"
        + (f" (`{parse_ocr_probe.get('healthz_url')}`)" if parse_ocr_probe.get("healthz_url") else ""),
        f"- `strings` fallback available: `{runtime.get('strings_available')}`",
        "",
    ]


def main() -> int:
    args = parse_args()
    repo_root = Path(__file__).resolve().parents[1]
    output_dir = _replace_stable_output_dir(Path(args.output_dir), repo_root)
    report = build_report(
        Path(args.pdf).expanduser().resolve(),
        output_dir,
        parse_max_pages=args.parse_max_pages,
        extract_max_chars=args.extract_max_chars,
    )
    print(
        json.dumps(
            {
                "report_path": report["report_path"],
                "markdown_path": report["markdown_path"],
                "provider": report["extraction"]["provider"],  # type: ignore[index]
                "mode": report["extraction"]["mode"],  # type: ignore[index]
                "usable": report["extraction"]["usable"],  # type: ignore[index]
                "readable": report["extraction"]["readable"],  # type: ignore[index]
                "rejected_as_noise": report["extraction"]["rejected_as_noise"],  # type: ignore[index]
                "evidence_status": report["evidence_status"],
                "deck_generation": report["deck_generation"],
                "cards_generated": report["cards_generated"],
                "candidate_count": report["candidate_count"],  # type: ignore[index]
                "candidate_cards_path": report["candidate_cards_path"],  # type: ignore[index]
                "ingestion_manifest_path": report["ingestion_manifest_path"],  # type: ignore[index]
            },
            sort_keys=True,
        )
    )
    if args.fail_on_unproven and report["evidence_status"] != "proven_local_text":
        return 2
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
