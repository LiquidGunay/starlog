#!/usr/bin/env python3
from __future__ import annotations

import argparse
import json
import re
import sys
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

ROOT_DIR = Path(__file__).resolve().parents[1]
API_DIR = ROOT_DIR / "services/api"
SCRIPTS_DIR = ROOT_DIR / "scripts"
for path in (API_DIR, SCRIPTS_DIR):
    if str(path) not in sys.path:
        sys.path.insert(0, str(path))

import pdf_deck_preflight as preflight  # noqa: E402
from app.services import pdf_ingest_service  # noqa: E402

TRUSTED_FINAL_CARD_PROVIDERS = {"liteparse_server", "ocr_server", "pypdf"}
DEFAULT_OUTPUT_DIR = ROOT_DIR / "artifacts/pdf-review-cards"
DEFAULT_MAX_CARDS = 14
DEFAULT_MIN_SEGMENT_WORDS = 24


def _quality_for_text(text: str, provider: str, mode: str) -> dict[str, Any]:
    quality = pdf_ingest_service._quality_flags(text[:20000])  # type: ignore[attr-defined]
    candidate = {
        "text": text[:20000],
        "provider": provider,
        "mode": mode,
        **quality,
    }
    candidate["readable"] = pdf_ingest_service._candidate_is_readable(candidate)  # type: ignore[attr-defined]
    return candidate


def _source_title(pdf_path: Path) -> str:
    return re.sub(r"\s+", " ", pdf_path.stem.replace("_", " ")).strip() or "PDF source"


def _first_sentence(text: str) -> str:
    normalized = re.sub(r"\s+", " ", text).strip()
    match = re.search(r"(.{80,}?[.!?])\s+[A-Z0-9]", normalized)
    if match:
        return match.group(1).strip()
    return normalized[:520].strip()


def _build_review_card(
    *,
    pdf_path: Path,
    run_id: str,
    source_sha: str,
    provider: str,
    mode: str,
    chunk_index: int,
    word_start: int,
    word_end: int,
    chunk_text: str,
) -> dict[str, Any]:
    title = _source_title(pdf_path)
    chunk_hash = preflight._sha256_text(chunk_text)  # type: ignore[attr-defined]
    question_index = f"{chunk_index + 1:04d}"
    prompt = f"What is the source-backed takeaway from {title} chunk {question_index}?"
    answer = _first_sentence(chunk_text)
    return {
        "answer": answer,
        "card_type": "qa",
        "difficulty": "M",
        "metadata": {
            "answer_source": "trusted_local_pdf_extraction",
            "chunk_content_sha256": chunk_hash,
            "chunk_index": chunk_index,
            "evidence_run_id": run_id,
            "mode": mode,
            "pdf_sha256": source_sha,
            "provider": provider,
            "source_path": str(pdf_path),
            "word_end": word_end,
            "word_start": word_start,
        },
        "prompt": prompt,
        "question": prompt,
        "question_index": question_index,
        "section": title,
        "source_url": f"file://{pdf_path}",
    }


def _blocked_segment(
    *,
    run_id: str,
    reason: str,
    chunk_index: int,
    word_start: int,
    word_end: int,
    chunk_text: str,
) -> dict[str, Any]:
    return {
        "chunk_index": chunk_index,
        "content_sha256": preflight._sha256_text(chunk_text),  # type: ignore[attr-defined]
        "reason": reason,
        "segment_id": f"source-block-{run_id[:6]}-{chunk_index:02d}",
        "status": "blocked",
        "word_count": max(0, word_end - word_start),
        "word_end": word_end,
        "word_start": word_start,
    }


def _write_jsonl(path: Path, records: list[dict[str, Any]]) -> None:
    path.write_text("\n".join(json.dumps(item, sort_keys=True) for item in records) + "\n", encoding="utf-8")


def build_report(
    pdf_path: Path,
    output_dir: Path,
    *,
    max_cards: int = DEFAULT_MAX_CARDS,
    min_segment_words: int = DEFAULT_MIN_SEGMENT_WORDS,
) -> dict[str, Any]:
    if not pdf_path.exists():
        raise FileNotFoundError(f"PDF not found: {pdf_path}")
    if not pdf_path.is_file():
        raise ValueError(f"PDF path is not a file: {pdf_path}")

    server_env = preflight.disable_nonlocal_pdf_server_env()
    extraction = pdf_ingest_service.extract_pdf_text(pdf_path)
    text = str(extraction.get("text") or "").strip()
    provider = str(extraction.get("provider") or "none")
    mode = str(extraction.get("mode") or "unavailable")
    usable = bool(extraction.get("usable")) and bool(text)
    readable = bool(extraction.get("readable")) and bool(text)
    rejected_as_noise = bool(text) and not (usable or readable)
    evidence_status, deck_generation = preflight._status_label(  # type: ignore[attr-defined]
        usable,
        readable,
        rejected_as_noise,
        provider,
    )

    started_at = datetime.now(timezone.utc)
    run_id = started_at.strftime("%Y%m%dT%H%M%SZ")
    run_dir = output_dir / run_id
    run_dir.mkdir(parents=True, exist_ok=True)

    source_sha = preflight._sha256_path(pdf_path)  # type: ignore[attr-defined]
    cards: list[dict[str, Any]] = []
    blocked_segments: list[dict[str, Any]] = []
    cards_path = ""

    trusted_extraction = evidence_status == "proven_local_text" and provider in TRUSTED_FINAL_CARD_PROVIDERS
    if trusted_extraction:
        chunks = preflight._segment_text(text, max_segments=max_cards)  # type: ignore[attr-defined]
        for chunk_index, (word_start, word_end, chunk_text) in enumerate(chunks):
            segment_quality = _quality_for_text(chunk_text, provider, mode)
            word_count = max(0, word_end - word_start)
            if word_count < min_segment_words or not bool(segment_quality.get("readable")):
                blocked_segments.append(
                    _blocked_segment(
                        run_id=run_id,
                        reason="Segment blocked: trusted extraction chunk was too thin or unreadable.",
                        chunk_index=chunk_index,
                        word_start=word_start,
                        word_end=word_end,
                        chunk_text=chunk_text,
                    )
                )
                continue
            cards.append(
                _build_review_card(
                    pdf_path=pdf_path,
                    run_id=run_id,
                    source_sha=source_sha,
                    provider=provider,
                    mode=mode,
                    chunk_index=chunk_index,
                    word_start=word_start,
                    word_end=word_end,
                    chunk_text=chunk_text,
                )
            )
        if cards:
            cards_path = str(run_dir / "review_cards.jsonl")
            _write_jsonl(Path(cards_path), cards)
    elif text:
        blocked_segments = preflight._build_blocked_segments(  # type: ignore[attr-defined]
            text,
            run_id,
            f"Final review cards blocked: {deck_generation}",
            max_segments=max_cards,
        )

    final_status = "ready" if cards else "blocked"
    report: dict[str, Any] = {
        "run_id": run_id,
        "pdf_path": str(pdf_path),
        "pdf_sha256": source_sha,
        "started_at": started_at.isoformat(),
        "cloud_ocr_policy": "disabled; only localhost parse/OCR server URLs are allowed",
        "server_env": server_env,
        "runtime": preflight.runtime_status(server_env),
        "extraction": {
            "provider": provider,
            "mode": mode,
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
        "final_card_status": final_status,
        "cards_generated": len(cards),
        "cards_path": cards_path,
        "trusted_final_card_providers": sorted(TRUSTED_FINAL_CARD_PROVIDERS),
        "blocked_segments": blocked_segments,
        "card_window": {
            "chunk_words": preflight.DEFAULT_CHUNK_WORDS,
            "chunk_overlap": preflight.DEFAULT_CHUNK_OVERLAP,
            "max_cards": max_cards,
            "min_segment_words": min_segment_words,
        },
    }
    report["report_path"] = str(run_dir / "report.json")
    report["markdown_path"] = str(run_dir / "report.md")
    Path(report["report_path"]).write_text(json.dumps(report, indent=2, sort_keys=True) + "\n", encoding="utf-8")
    Path(report["markdown_path"]).write_text(_markdown_report(report), encoding="utf-8")
    return report


def _markdown_report(report: dict[str, Any]) -> str:
    extraction = report["extraction"]
    lines = [
        f"# PDF Review Cards {report['run_id']}",
        "",
        f"- PDF path: `{report['pdf_path']}`",
        f"- Provider: `{extraction.get('provider')}`",
        f"- Mode: `{extraction.get('mode')}`",
        f"- Evidence status: `{report['evidence_status']}`",
        f"- Deck generation: `{report['deck_generation']}`",
        f"- Final card status: `{report['final_card_status']}`",
        f"- Cards generated: `{report['cards_generated']}`",
        f"- Cards file: `{report.get('cards_path')}`",
        "",
    ]
    blocked = report.get("blocked_segments")
    if isinstance(blocked, list) and blocked:
        lines.extend(["## Blocked Segments", ""])
        for segment in blocked:
            lines.append(
                f"- segment={segment.get('segment_id')} reason={segment.get('reason')} "
                f"words={segment.get('word_count')}"
            )
        lines.append("")
    if report["final_card_status"] == "blocked":
        lines.extend(
            [
                "## Next Local Step",
                "",
                "- Rerun with trusted local text-layer, LiteParse, or local OCR extraction before importing review cards.",
                "",
            ]
        )
    return "\n".join(lines) + "\n"


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Build source-grounded PDF review cards only from trusted local extraction evidence."
    )
    parser.add_argument("--pdf", type=Path, default=ROOT_DIR / "Inference Engineering.pdf")
    parser.add_argument("--output-dir", type=Path, default=DEFAULT_OUTPUT_DIR)
    parser.add_argument("--max-cards", type=int, default=DEFAULT_MAX_CARDS)
    parser.add_argument(
        "--fail-on-blocked",
        action="store_true",
        help="Return a non-zero exit code when no trusted final cards were produced.",
    )
    args = parser.parse_args()
    output_dir = args.output_dir
    if not output_dir.is_absolute():
        output_dir = ROOT_DIR / output_dir
    report = build_report(args.pdf.expanduser().resolve(), output_dir.resolve(), max_cards=max(1, args.max_cards))
    print(
        json.dumps(
            {
                "cards_generated": report["cards_generated"],
                "cards_path": report["cards_path"],
                "deck_generation": report["deck_generation"],
                "evidence_status": report["evidence_status"],
                "final_card_status": report["final_card_status"],
                "markdown_path": report["markdown_path"],
                "provider": report["extraction"]["provider"],
                "report_path": report["report_path"],
            },
            sort_keys=True,
        )
    )
    if args.fail_on_blocked and report["final_card_status"] != "ready":
        return 2
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
