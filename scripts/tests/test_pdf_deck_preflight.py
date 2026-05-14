from __future__ import annotations

import json
import sys
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[2]
SCRIPTS_DIR = REPO_ROOT / "scripts"
SERVICES_API_DIR = REPO_ROOT / "services/api"
for path in (SCRIPTS_DIR, SERVICES_API_DIR):
    if str(path) not in sys.path:
        sys.path.insert(0, str(path))

import pdf_deck_preflight as preflight  # noqa: E402
from app.services import pdf_ingest_service  # noqa: E402


def test_preflight_disables_nonlocal_pdf_server_env(monkeypatch) -> None:
    monkeypatch.setenv("STARLOG_PDF_PARSE_SERVER_URL", "https://example.test/parse")
    monkeypatch.setenv("STARLOG_PDF_OCR_SERVER_URL", "http://127.0.0.1:8829/ocr")

    status = preflight.disable_nonlocal_pdf_server_env()

    assert status["STARLOG_PDF_PARSE_SERVER_URL"]["allowed"] is False
    assert status["STARLOG_PDF_OCR_SERVER_URL"]["allowed"] is True
    assert "STARLOG_PDF_PARSE_SERVER_URL" not in preflight.os.environ
    assert preflight.os.environ["STARLOG_PDF_OCR_SERVER_URL"] == "http://127.0.0.1:8829/ocr"


def test_runtime_status_reports_local_liteparse_and_paddle_paths(monkeypatch) -> None:
    available_modules = {
        "fastapi",
        "uvicorn",
        "multipart",
        "numpy",
        "PIL",
        "paddle",
        "paddleocr",
        "pypdf",
        "fitz",
    }
    monkeypatch.setattr(
        preflight.importlib.util,
        "find_spec",
        lambda name: object() if name in available_modules else None,
    )
    monkeypatch.setattr(
        preflight.shutil,
        "which",
        lambda command: (
            "/usr/local/bin/lit"
            if command == "lit"
            else "/usr/bin/strings"
            if command == "strings"
            else None
        ),
    )
    monkeypatch.setenv("STARLOG_PDF_PARSE_SERVER_URL", "http://127.0.0.1:8830/parse")
    monkeypatch.setenv("STARLOG_PDF_OCR_SERVER_URL", "http://127.0.0.1:8829/ocr")
    monkeypatch.setenv("STARLOG_PDF_PARSE_OCR_SERVER_URL", "http://127.0.0.1:8829/ocr")
    monkeypatch.setattr(
        preflight,
        "_probe_local_server",
        lambda value: {
            "reachable": True,
            "healthz_url": value.replace("/parse", "/healthz").replace("/ocr", "/healthz"),
        },
    )

    runtime = preflight.runtime_status(preflight.disable_nonlocal_pdf_server_env())

    direct_text = runtime["direct_text_layer"]
    liteparse = runtime["liteparse"]
    paddleocr = runtime["paddleocr"]
    assert isinstance(direct_text, dict)
    assert isinstance(liteparse, dict)
    assert isinstance(paddleocr, dict)
    assert direct_text["pypdf_available"] is True
    assert direct_text["pymupdf_available"] is True
    assert liteparse["binary"] == {
        "configured": False,
        "command": "lit",
        "available": True,
        "path": "/usr/local/bin/lit",
    }
    assert liteparse["server_modules_ready"] is True
    assert paddleocr["server_modules_ready"] is True
    assert runtime["strings_available"] is True


def test_preflight_marks_unreadable_extraction_unproven(monkeypatch, tmp_path: Path) -> None:
    pdf_path = tmp_path / "Inference Engineering.pdf"
    pdf_path.write_bytes(b"%PDF-1.4 local test payload")
    monkeypatch.setattr(
        pdf_ingest_service,
        "extract_pdf_text",
        lambda _path: {
            "text": "SbbbQQQMMMaaaZZZLLLPP MTdcrLsZ|kzb{fJWnZw~ ?JP```@@p``\\\\llNvvuEEG{",
            "provider": "strings",
            "mode": "heuristic_fallback",
            "characters": 76,
            "usable": False,
            "readable": False,
            "alpha_ratio": 0.34,
            "space_ratio": 0.04,
            "unique_ratio": 0.07,
            "long_word_count": 1,
        },
    )

    report = preflight.build_report(pdf_path, tmp_path / "evidence")

    extraction = report["extraction"]
    assert isinstance(extraction, dict)
    assert extraction["provider"] == "strings"
    assert extraction["rejected_as_noise"] is True
    assert report["evidence_status"] == "unproven"
    assert report["deck_generation"] == "blocked_string_fallback"
    assert report["cards_generated"] == 0
    assert report["candidate_count"] == 0
    assert report["candidate_cards_path"] == ""
    blocked_chunks = report["blocked_chunks"]
    assert isinstance(blocked_chunks, list)
    assert blocked_chunks
    assert blocked_chunks[0]["reason"] == "Card candidates blocked: blocked_string_fallback"
    assert str(report["markdown_path"]).endswith(".md")
    assert "Do not generate cards from this run" in " ".join(
        str(step) for step in report["next_local_steps"]
    )
    assert "Do not use `strings` output for card prep" in " ".join(
        str(step) for step in report["next_local_steps"]
    )
    assert Path(str(report["report_path"])).exists()
    assert Path(str(report["markdown_path"])).exists()


def test_preflight_blocks_strings_even_when_readable(monkeypatch, tmp_path: Path) -> None:
    pdf_path = tmp_path / "Inference Engineering.pdf"
    pdf_path.write_bytes(b"%PDF-1.4 local test payload")
    extracted = "Readable words from strings should still be blocked for card preparation."
    monkeypatch.setattr(
        pdf_ingest_service,
        "extract_pdf_text",
        lambda _path: {
            "text": extracted,
            "provider": "strings",
            "mode": "heuristic_fallback",
            "characters": len(extracted),
            "usable": False,
            "readable": True,
            "alpha_ratio": 0.86,
            "space_ratio": 0.12,
            "unique_ratio": 0.4,
            "long_word_count": 3,
        },
    )

    report = preflight.build_report(pdf_path, tmp_path / "evidence")

    assert report["evidence_status"] == "unproven"
    assert report["deck_generation"] == "blocked_string_fallback"
    assert report["candidate_count"] == 0
    assert report["candidate_cards_path"] == ""
    assert report["unproven_note"]
    assert "Do not use `strings` output for card prep" in " ".join(
        str(step) for step in report["next_local_steps"]
    )


def test_preflight_produces_candidate_cards_from_proven_local_text(monkeypatch, tmp_path: Path) -> None:
    pdf_path = tmp_path / "Inference Engineering.pdf"
    pdf_path.write_bytes(b"%PDF-1.4 local test payload")
    extracted = "Inference engineering uses evaluations, routing, caching, and monitoring to make model systems reliable."
    monkeypatch.setattr(
        pdf_ingest_service,
        "extract_pdf_text",
        lambda _path: {
            "text": extracted,
            "provider": "pypdf",
            "mode": "text_layer",
            "characters": len(extracted),
            "usable": False,
            "readable": True,
            "alpha_ratio": 0.85,
            "space_ratio": 0.12,
            "unique_ratio": 0.38,
            "long_word_count": 8,
        },
    )

    report = preflight.build_report(pdf_path, tmp_path / "evidence")

    assert report["evidence_status"] == "proven_local_text"
    assert report["deck_generation"] == "preflight_passed"
    assert report["cards_generated"] == 0
    assert report["candidate_count"] >= 1
    assert isinstance(report["candidate_cards_path"], str)
    candidate_cards_path = Path(str(report["candidate_cards_path"]))
    assert candidate_cards_path.exists()
    candidate_cards = [
        json.loads(line)
        for line in candidate_cards_path.read_text(encoding="utf-8").splitlines()
        if line.strip()
    ]
    assert len(candidate_cards) == report["candidate_count"]
    candidate = candidate_cards[0]
    assert candidate["status"] == "candidate"
    assert candidate["card_type"] == "qa"
    assert "content" not in candidate
    assert candidate["provenance"]["source"]["provider"] == "pypdf"
    assert candidate["provenance"]["source"]["run_id"] == report["run_id"]
    assert candidate["provenance"]["chunk"]["word_count"] > 0


def test_preflight_records_unproven_chunks(monkeypatch, tmp_path: Path) -> None:
    pdf_path = tmp_path / "Inference Engineering.pdf"
    pdf_path.write_bytes(b"%PDF-1.4 local test payload")
    extracted = "SbbbQQQMMMaaaZZZLLLPP MTdcrLsZ|kzb{fJWnZw~ ?JP```@@p``\\\\llNvvuEEG{"
    monkeypatch.setattr(
        pdf_ingest_service,
        "extract_pdf_text",
        lambda _path: {
            "text": extracted,
            "provider": "pypdf",
            "mode": "text_layer",
            "characters": 76,
            "usable": False,
            "readable": False,
            "alpha_ratio": 0.34,
            "space_ratio": 0.04,
            "unique_ratio": 0.07,
            "long_word_count": 1,
        },
    )

    report = preflight.build_report(pdf_path, tmp_path / "evidence")

    assert report["evidence_status"] == "unproven"
    assert report["deck_generation"] == "blocked_unreadable_extraction"
    assert report["candidate_count"] == 0
    blocked_chunks = report["blocked_chunks"]
    assert isinstance(blocked_chunks, list)
    assert blocked_chunks
    assert blocked_chunks[0]["reason"] == "Card candidates blocked: blocked_unreadable_extraction"
    assert all(item.get("status") == "blocked" for item in blocked_chunks)
