#!/usr/bin/env python3
from __future__ import annotations

import argparse
import importlib.util
import json
import os
import sys
from datetime import datetime, timezone
from pathlib import Path
from urllib.parse import urlparse


LOCAL_HOSTS = {"localhost", "127.0.0.1", "::1", "0.0.0.0"}
SERVER_ENV_VARS = (
    "STARLOG_PDF_PARSE_SERVER_URL",
    "STARLOG_PDF_OCR_SERVER_URL",
    "STARLOG_PDF_PARSE_OCR_SERVER_URL",
)


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
        default="artifacts/pdf-deck-preflight",
        help="Directory where JSON and Markdown evidence should be written.",
    )
    parser.add_argument(
        "--fail-on-unproven",
        action="store_true",
        help="Return a non-zero exit code when extraction is unavailable or rejected as noise.",
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


def runtime_status() -> dict[str, bool]:
    return {
        "pypdf_available": importlib.util.find_spec("pypdf") is not None,
        "pymupdf_available": importlib.util.find_spec("fitz") is not None,
        "strings_available": importlib.util.find_spec("subprocess") is not None,
    }


def _status_label(usable: bool, readable: bool, rejected_as_noise: bool, provider: str) -> tuple[str, str]:
    if usable or readable:
        return "proven_local_text", "preflight_passed"
    if rejected_as_noise:
        return "unproven", "blocked_unreadable_extraction"
    if provider == "none":
        return "unproven", "blocked_extraction_unavailable"
    return "unproven", "blocked_extraction_not_readable"


def build_report(pdf_path: Path, output_dir: Path) -> dict[str, object]:
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
    extraction = pdf_ingest_service.extract_pdf_text(pdf_path)
    text = str(extraction.get("text") or "").strip()
    usable = bool(extraction.get("usable")) and bool(text)
    readable = bool(extraction.get("readable")) and bool(text)
    rejected_as_noise = bool(text) and not (usable or readable)
    provider = str(extraction.get("provider") or "none")
    evidence_status, deck_generation = _status_label(usable, readable, rejected_as_noise, provider)

    started_at = datetime.now(timezone.utc)
    run_id = started_at.strftime("%Y%m%dT%H%M%SZ")
    run_dir = output_dir / run_id
    run_dir.mkdir(parents=True, exist_ok=True)

    report: dict[str, object] = {
        "run_id": run_id,
        "pdf_path": str(pdf_path),
        "pdf_size_bytes": pdf_path.stat().st_size,
        "started_at": started_at.isoformat(),
        "cloud_ocr_policy": "disabled; only localhost parse/OCR server URLs are allowed",
        "server_env": server_env,
        "runtime": runtime_status(),
        "extraction": {
            "provider": provider,
            "mode": extraction.get("mode") or "unavailable",
            "characters": int(extraction.get("characters") or 0),
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
        "readable_excerpt": text[:1000] if usable or readable else "",
        "unproven_note": ""
        if usable or readable
        else "No deck cards were generated because local extraction did not prove readable source text.",
    }

    report_path = run_dir / "report.json"
    markdown_path = run_dir / "report.md"
    report_path.write_text(json.dumps(report, indent=2, sort_keys=True) + "\n", encoding="utf-8")
    markdown_path.write_text(_markdown_report(report), encoding="utf-8")
    report["report_path"] = str(report_path)
    report["markdown_path"] = str(markdown_path)
    return report


def _markdown_report(report: dict[str, object]) -> str:
    extraction = report["extraction"]
    assert isinstance(extraction, dict)
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
        "",
    ]
    note = str(report.get("unproven_note") or "")
    if note:
        lines.extend(["## Unproven Evidence", "", note, ""])
    excerpt = str(report.get("readable_excerpt") or "")
    if excerpt:
        lines.extend(["## Readable Excerpt", "", excerpt, ""])
    return "\n".join(lines) + "\n"


def main() -> int:
    args = parse_args()
    output_dir = Path(args.output_dir)
    if not output_dir.is_absolute():
        output_dir = Path(__file__).resolve().parents[1] / output_dir
    report = build_report(Path(args.pdf).expanduser().resolve(), output_dir.resolve())
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
            },
            sort_keys=True,
        )
    )
    if args.fail_on_unproven and report["evidence_status"] != "proven_local_text":
        return 2
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
