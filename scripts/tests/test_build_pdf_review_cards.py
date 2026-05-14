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

import build_pdf_review_cards as builder  # noqa: E402
from app.services import pdf_ingest_service  # noqa: E402


def _trusted_text() -> str:
    return (
        "Inference engineering turns model calls into reliable production systems. "
        "Teams evaluate quality, route requests, cache stable responses, monitor latency, "
        "and keep clear rollback paths so inference behavior remains observable. "
        "A source grounded card should preserve the local extraction provider and the "
        "chunk hash before it becomes a review item."
    )


def _write_pdf(tmp_path: Path) -> Path:
    pdf_path = tmp_path / "Inference Engineering.pdf"
    pdf_path.write_bytes(b"%PDF-1.4 local test payload")
    return pdf_path


def _patch_extraction(monkeypatch, *, provider: str, text: str, readable: bool = True) -> None:
    monkeypatch.setattr(
        pdf_ingest_service,
        "extract_pdf_text",
        lambda _path: {
            "text": text,
            "provider": provider,
            "mode": "liteparse" if provider == "liteparse_server" else "ocr_server" if provider == "ocr_server" else "heuristic_fallback",
            "characters": len(text),
            "usable": readable,
            "readable": readable,
            "alpha_ratio": 0.82 if readable else 0.34,
            "space_ratio": 0.13 if readable else 0.04,
            "unique_ratio": 0.43,
            "long_word_count": 30 if readable else 1,
            "word_count": len(text.split()),
            "common_word_count": 12 if readable else 0,
            "readability_score": 500 if readable else 10,
        },
    )


def test_review_card_builder_blocks_strings_even_when_readable(monkeypatch, tmp_path: Path) -> None:
    pdf_path = _write_pdf(tmp_path)
    _patch_extraction(monkeypatch, provider="strings", text=_trusted_text(), readable=True)

    report = builder.build_report(pdf_path, tmp_path / "cards")

    assert report["evidence_status"] == "unproven"
    assert report["deck_generation"] == "blocked_string_fallback"
    assert report["final_card_status"] == "blocked"
    assert report["cards_generated"] == 0
    assert report["cards_path"] == ""
    assert report["blocked_segments"]
    assert report["blocked_segments"][0]["reason"] == "Final review cards blocked: blocked_string_fallback"


def test_review_card_builder_accepts_liteparse_and_writes_final_cards(monkeypatch, tmp_path: Path) -> None:
    pdf_path = _write_pdf(tmp_path)
    _patch_extraction(monkeypatch, provider="liteparse_server", text=_trusted_text(), readable=True)

    report = builder.build_report(pdf_path, tmp_path / "cards")

    assert report["evidence_status"] == "proven_local_text"
    assert report["final_card_status"] == "ready"
    assert report["cards_generated"] == 1
    cards_path = Path(str(report["cards_path"]))
    assert cards_path.exists()
    cards = [json.loads(line) for line in cards_path.read_text(encoding="utf-8").splitlines()]
    assert cards[0]["card_type"] == "qa"
    assert cards[0]["prompt"].startswith("What is the source-backed takeaway")
    assert cards[0]["answer"].startswith("Inference engineering turns model calls")
    assert cards[0]["metadata"]["provider"] == "liteparse_server"
    assert cards[0]["metadata"]["answer_source"] == "trusted_local_pdf_extraction"


def test_review_card_builder_accepts_local_ocr(monkeypatch, tmp_path: Path) -> None:
    pdf_path = _write_pdf(tmp_path)
    _patch_extraction(monkeypatch, provider="ocr_server", text=_trusted_text(), readable=True)

    report = builder.build_report(pdf_path, tmp_path / "cards")

    assert report["evidence_status"] == "proven_local_text"
    assert report["final_card_status"] == "ready"
    assert report["cards_generated"] == 1
    cards = [json.loads(line) for line in Path(str(report["cards_path"])).read_text(encoding="utf-8").splitlines()]
    assert cards[0]["metadata"]["provider"] == "ocr_server"


def test_review_card_builder_records_noisy_scanned_segments_as_blocked(monkeypatch, tmp_path: Path) -> None:
    pdf_path = _write_pdf(tmp_path)
    noisy_scan_text = "SbbbQQQMMMaaaZZZLLLPP MTdcrLsZ|kzb{fJWnZw~ ?JP```@@p``\\\\llNvvuEEG{"
    _patch_extraction(monkeypatch, provider="ocr_server", text=noisy_scan_text, readable=False)

    report = builder.build_report(pdf_path, tmp_path / "cards")

    assert report["evidence_status"] == "unproven"
    assert report["deck_generation"] == "blocked_unreadable_extraction"
    assert report["final_card_status"] == "blocked"
    assert report["cards_generated"] == 0
    assert report["cards_path"] == ""
    assert report["blocked_segments"]
    assert all(segment["status"] == "blocked" for segment in report["blocked_segments"])
    assert report["blocked_segments"][0]["reason"] == "Final review cards blocked: blocked_unreadable_extraction"
