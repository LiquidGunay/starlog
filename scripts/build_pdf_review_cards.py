#!/usr/bin/env python3
from __future__ import annotations

import argparse
import json
import re
import shutil
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
DEFAULT_OUTPUT_DIR = ROOT_DIR / ".localdata/pdf-review-cards/latest"
DEFAULT_MAX_CARDS = 14
DEFAULT_MIN_SEGMENT_WORDS = 24
DEFAULT_MAX_SCAN_CHUNKS = 80

FRONT_MATTER_PATTERNS = (
    r"\ball rights reserved\b",
    r"\bcopyright\b",
    r"\bisbn\b",
    r"\bcover art\b",
    r"\bedited by\b",
    r"\bpublished by\b",
    r"\bpublisher\b",
)
TOC_HEADING_PATTERN = re.compile(
    r"(?:\bchapter\s+\d+[\w.:\- ]{3,80}\s+\d+\b|\b\d+(?:\.\d+){1,4}\s+[A-Z][A-Za-z][A-Za-z /&,\-()]{2,80}\s+\d+\b)"
)
RESOURCE_LIST_PATTERNS = (
    r"\bappendix\b.{0,120}\b(resources?|references?|further reading|bibliography|links?)\b",
    r"\b(resources?|references?|further reading|bibliography|links?)\b.{0,120}\bappendix\b",
)
CHAPTER_BODY_PATTERN = re.compile(r"\bCHAPTER\s+\d+\b")
PAGE_HEADER_SECTION_PATTERN = re.compile(
    r"\bChapter\s+(\d+):\s+([A-Z][A-Za-z][A-Za-z &:/().,\-]{0,70}?)(?=\s{1,}(?:Figure|\d+\.\d+|[A-Z][a-z]|\W|$))"
)


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


def _chapter_section_title(text: str) -> str | None:
    normalized = re.sub(r"\s+", " ", text).strip()
    repeated = re.match(
        r"^CHAPTER\s+(\d+)\s+(?P<title>[A-Z][A-Za-z][A-Za-z &:/().,\-]{0,50}?)(?:\s+(?P=title))?(?:\s+\d+)?(?:\s+(?P=title))?\s+(?=(?P=title)\s+(?:is|are|adds|means|uses|requires|turns|starts)\b)",
        normalized,
    )
    if repeated:
        return f"Chapter {repeated.group(1)}: {repeated.group('title').strip()}"
    words = text.split()
    if len(words) < 4 or words[0] != "CHAPTER" or not words[1].isdigit():
        return None
    max_title_words = min(8, len(words) - 3)
    for title_words in range(max_title_words, 0, -1):
        title = " ".join(words[2 : 2 + title_words]).strip(" :-")
        candidate = " ".join(words[2 + title_words :]).strip()
        if not title or candidate[:1].islower():
            continue
        first_sentence = re.search(r"([^.!?]{40,}?[.!?])(?:\s+|$)", candidate)
        if first_sentence and first_sentence.start() == 0 and _sentence_is_reviewable(first_sentence.group(1).strip()):
            return f"Chapter {words[1]}: {title}"
    return None


def _page_header_section_title(text: str) -> str | None:
    normalized = re.sub(r"\s+", " ", text).strip()
    for match in PAGE_HEADER_SECTION_PATTERN.finditer(normalized):
        title = match.group(2).strip(" :-")
        title = re.sub(r"\s+\d+$", "", title).strip(" :-")
        title_words: list[str] = []
        for word in title.split():
            if title_words and word[:1].islower():
                break
            title_words.append(word)
        title = " ".join(title_words).strip(" :-")
        if title and len(title.split()) <= 8:
            return f"Chapter {match.group(1)}: {title}"
    return None


def _first_sentence(text: str) -> str:
    normalized = _strip_chapter_heading(re.sub(r"\s+", " ", text).strip())
    for match in re.finditer(r"([^.!?]{40,}?[.!?])(?:\s+|$)", normalized):
        sentence = match.group(1).strip()
        if _sentence_is_reviewable(sentence):
            return sentence
    return normalized[:520].strip()


def _strip_chapter_heading(text: str) -> str:
    words = text.split()
    if len(words) < 4 or words[0].lower() != "chapter" or not words[1].isdigit():
        return text.strip()
    max_title_words = min(8, len(words) - 3)
    for title_words in range(max_title_words, 0, -1):
        candidate = " ".join(words[2 + title_words :]).strip()
        if candidate[:1].islower():
            continue
        first_sentence = re.search(r"([^.!?]{40,}?[.!?])(?:\s+|$)", candidate)
        if first_sentence and first_sentence.start() == 0 and _sentence_is_reviewable(first_sentence.group(1).strip()):
            return candidate
    return text.strip()


def _sentence_is_reviewable(sentence: str) -> bool:
    words = re.findall(r"[A-Za-z]+(?:'[A-Za-z]+)?", sentence)
    if len(words) < 8:
        return False
    if not sentence[:1].isalpha() or sentence[:1].islower():
        return False
    lower = sentence.lower()
    if any(re.search(pattern, lower) for pattern in FRONT_MATTER_PATTERNS):
        return False
    if "table of contents" in lower:
        return False
    numeric_tokens = re.findall(r"\b\d+(?:\.\d+)*\b", sentence)
    return len(numeric_tokens) <= max(2, len(words) // 6)


def _content_sentence_count(text: str) -> int:
    count = 0
    for sentence in re.split(r"[.!?]+", text):
        words = re.findall(r"[A-Za-z]+(?:'[A-Za-z]+)?", sentence)
        if len(words) < 8:
            continue
        lowercase_words = sum(1 for word in words if word[:1].islower())
        if lowercase_words >= 4:
            count += 1
    return count


def _content_block_reason(text: str) -> str | None:
    normalized = re.sub(r"\s+", " ", text).strip()
    lower = normalized.lower()
    if any(re.search(pattern, lower) for pattern in FRONT_MATTER_PATTERNS):
        return "Segment blocked: front matter is not a final review-card source."
    if "table of contents" in lower or len(TOC_HEADING_PATTERN.findall(normalized)) >= 4:
        return "Segment blocked: table-of-contents text is not a final review-card source."
    if any(re.search(pattern, lower) for pattern in RESOURCE_LIST_PATTERNS):
        return "Segment blocked: appendix/resource-list text is not a final review-card source."
    if len(re.findall(r"https?://|www\.|[A-Za-z0-9.-]+\.(?:com|org|net|io|ai|edu)\b", lower)) >= 3:
        return "Segment blocked: resource-list text is not a final review-card source."
    if _content_sentence_count(normalized) < 2:
        return "Segment blocked: source chunk does not contain enough prose content for a final card."
    return None


def _word_offset_for_char(text: str, char_index: int) -> int:
    return len(re.findall(r"\S+", text[:char_index]))


def _trim_structural_front_matter(text: str) -> tuple[str, dict[str, Any]]:
    normalized = re.sub(r"\s+", " ", text).strip()
    toc_index = normalized.lower().find("table of contents")
    if toc_index < 0 or toc_index > 3000:
        return normalized, {
            "trimmed": False,
            "reason": "",
            "character_start": 0,
            "word_start": 0,
            "section": _chapter_section_title(normalized),
        }

    for match in CHAPTER_BODY_PATTERN.finditer(normalized):
        if match.start() <= toc_index + 500:
            continue
        tail = normalized[match.start() : match.start() + 900]
        if _content_block_reason(tail) is None:
            trimmed = normalized[match.start() :].strip()
            word_start = _word_offset_for_char(normalized, match.start())
            return trimmed, {
                "trimmed": True,
                "reason": "Skipped structural front matter, table of contents, and preface before first detected chapter body.",
                "character_start": match.start(),
                "word_start": word_start,
                "section": _chapter_section_title(trimmed),
            }
    return normalized, {
        "trimmed": False,
        "reason": "No post-TOC chapter body anchor found.",
        "character_start": 0,
        "word_start": 0,
        "section": None,
    }


def _build_review_card(
    *,
    pdf_path: Path,
    run_id: str,
    source_sha: str,
    provider: str,
    mode: str,
    section_title: str,
    card_number: int,
    chunk_index: int,
    word_start: int,
    word_end: int,
    chunk_text: str,
) -> dict[str, Any]:
    chunk_hash = preflight._sha256_text(chunk_text)  # type: ignore[attr-defined]
    question_index = f"{card_number:04d}"
    prompt = f"What is the source-backed takeaway from {section_title} chunk {question_index}?"
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
        "section": section_title,
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


def _is_relative_to(path: Path, root: Path) -> bool:
    try:
        path.relative_to(root)
    except ValueError:
        return False
    return True


def _has_suffix(path: Path, suffix: Path) -> bool:
    return tuple(path.parts[-len(suffix.parts) :]) == suffix.parts


def _validate_safe_output_dir(output_dir: Path, label: str) -> None:
    lane_suffix = Path(".localdata/pdf-review-cards/latest")
    localdata_root = ROOT_DIR / ".localdata"
    lane_root = localdata_root / "pdf-review-cards"
    artifacts_root = ROOT_DIR / "artifacts"
    tmp_root = Path("/tmp")
    unsafe_dirs = {Path("/"), tmp_root, ROOT_DIR, localdata_root, ROOT_DIR.parent}
    if not output_dir.is_absolute() or output_dir in unsafe_dirs:
        raise ValueError(f"refusing unsafe PDF review cards output dir ({label}): {output_dir}")
    if output_dir == artifacts_root or _is_relative_to(output_dir, artifacts_root):
        raise ValueError(f"refusing PDF review cards output dir under tracked artifacts root ({label}): {output_dir}")
    if output_dir == tmp_root or _is_relative_to(output_dir, tmp_root):
        raise ValueError(f"refusing PDF review cards output dir under /tmp ({label}): {output_dir}")
    if not _has_suffix(output_dir, lane_suffix):
        raise ValueError(f"PDF review cards output dir must end with {lane_suffix.as_posix()} ({label}): {output_dir}")
    if not _is_relative_to(output_dir, lane_root):
        raise ValueError(f"PDF review cards output dir must stay under {lane_root} ({label}): {output_dir}")


def safe_output_dir(output_dir: Path) -> Path:
    lexical_dir = output_dir if output_dir.is_absolute() else ROOT_DIR / output_dir
    lexical_dir = lexical_dir.expanduser()
    resolved_dir = lexical_dir.resolve()
    _validate_safe_output_dir(lexical_dir, "lexical")
    _validate_safe_output_dir(resolved_dir, "resolved")
    return resolved_dir


def build_report(
    pdf_path: Path,
    output_dir: Path,
    *,
    max_cards: int = DEFAULT_MAX_CARDS,
    min_segment_words: int = DEFAULT_MIN_SEGMENT_WORDS,
    max_scan_chunks: int = DEFAULT_MAX_SCAN_CHUNKS,
    parse_max_pages: int = 16,
    extract_max_chars: int = 20000,
    spread_cards: bool = False,
) -> dict[str, Any]:
    if not pdf_path.exists():
        raise FileNotFoundError(f"PDF not found: {pdf_path}")
    if not pdf_path.is_file():
        raise ValueError(f"PDF path is not a file: {pdf_path}")

    server_env = preflight.disable_nonlocal_pdf_server_env()
    parse_max_pages = max(1, min(parse_max_pages, 512))
    previous_page_limit = preflight.os.environ.get("STARLOG_PDF_PARSE_MAX_PAGE_LIMIT")
    previous_pages = preflight.os.environ.get("STARLOG_PDF_PARSE_MAX_PAGES")
    preflight.os.environ["STARLOG_PDF_PARSE_MAX_PAGE_LIMIT"] = str(parse_max_pages)
    preflight.os.environ["STARLOG_PDF_PARSE_MAX_PAGES"] = str(parse_max_pages)
    try:
        extraction = pdf_ingest_service.extract_pdf_text(pdf_path, max_characters=max(1000, extract_max_chars))
    finally:
        if previous_page_limit is None:
            preflight.os.environ.pop("STARLOG_PDF_PARSE_MAX_PAGE_LIMIT", None)
        else:
            preflight.os.environ["STARLOG_PDF_PARSE_MAX_PAGE_LIMIT"] = previous_page_limit
        if previous_pages is None:
            preflight.os.environ.pop("STARLOG_PDF_PARSE_MAX_PAGES", None)
        else:
            preflight.os.environ["STARLOG_PDF_PARSE_MAX_PAGES"] = previous_pages
    raw_text = str(extraction.get("text") or "").strip()
    text, front_matter = _trim_structural_front_matter(raw_text)
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
    if output_dir.exists():
        shutil.rmtree(output_dir)
    run_dir = output_dir
    run_dir.mkdir(parents=True, exist_ok=True)

    source_sha = preflight._sha256_path(pdf_path)  # type: ignore[attr-defined]
    cards: list[dict[str, Any]] = []
    blocked_segments: list[dict[str, Any]] = []
    cards_path = ""

    trusted_extraction = evidence_status == "proven_local_text" and provider in TRUSTED_FINAL_CARD_PROVIDERS
    if trusted_extraction:
        section_title = str(front_matter.get("section") or _chapter_section_title(text) or _source_title(pdf_path))
        scan_limit = max(max_cards, max_scan_chunks)
        chunks = preflight._segment_text(text, max_segments=scan_limit)  # type: ignore[attr-defined]
        word_offset = int(front_matter.get("word_start") or 0)
        card_candidates: list[dict[str, Any]] = []
        for chunk_index, (word_start, word_end, chunk_text) in enumerate(chunks):
            detected_section = _chapter_section_title(chunk_text) or _page_header_section_title(chunk_text)
            if detected_section is not None:
                section_title = detected_section
            source_word_start = word_start + word_offset
            source_word_end = word_end + word_offset
            segment_quality = _quality_for_text(chunk_text, provider, mode)
            word_count = max(0, word_end - word_start)
            block_reason = _content_block_reason(chunk_text)
            if word_count < min_segment_words:
                block_reason = "Segment blocked: trusted extraction chunk was too thin."
            elif not bool(segment_quality.get("readable")):
                block_reason = "Segment blocked: trusted extraction chunk was unreadable."
            elif block_reason is None and not _sentence_is_reviewable(_first_sentence(chunk_text)):
                block_reason = "Segment blocked: source chunk did not contain a clean reviewable answer sentence."
            if block_reason is not None:
                blocked_segments.append(
                    _blocked_segment(
                        run_id=run_id,
                        reason=block_reason,
                        chunk_index=chunk_index,
                        word_start=source_word_start,
                        word_end=source_word_end,
                        chunk_text=chunk_text,
                    )
                )
                continue
            card_candidates.append(
                {
                    "pdf_path": pdf_path,
                    "run_id": run_id,
                    "source_sha": source_sha,
                    "provider": provider,
                    "mode": mode,
                    "section_title": section_title,
                    "chunk_index": chunk_index,
                    "word_start": source_word_start,
                    "word_end": source_word_end,
                    "chunk_text": chunk_text,
                }
            )
            if not spread_cards and len(card_candidates) >= max_cards:
                break

        selected_candidates = card_candidates
        if spread_cards and len(card_candidates) > max_cards:
            if max_cards == 1:
                selected_candidates = [card_candidates[0]]
            else:
                selected_indices = sorted(
                    {
                        round(index * (len(card_candidates) - 1) / (max_cards - 1))
                        for index in range(max_cards)
                    }
                )
                selected_candidates = [card_candidates[index] for index in selected_indices]

        for card_number, candidate in enumerate(selected_candidates[:max_cards], start=1):
            cards.append(
                _build_review_card(
                    pdf_path=candidate["pdf_path"],
                    run_id=candidate["run_id"],
                    source_sha=candidate["source_sha"],
                    provider=candidate["provider"],
                    mode=candidate["mode"],
                    section_title=candidate["section_title"],
                    card_number=len(cards) + 1,
                    chunk_index=candidate["chunk_index"],
                    word_start=candidate["word_start"],
                    word_end=candidate["word_end"],
                    chunk_text=candidate["chunk_text"],
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
        "final_card_status": final_status,
        "cards_generated": len(cards),
        "cards_path": cards_path,
        "trusted_final_card_providers": sorted(TRUSTED_FINAL_CARD_PROVIDERS),
        "blocked_segments": blocked_segments,
        "front_matter": front_matter,
        "card_window": {
            "chunk_words": preflight.DEFAULT_CHUNK_WORDS,
            "chunk_overlap": preflight.DEFAULT_CHUNK_OVERLAP,
            "max_cards": max_cards,
            "max_scan_chunks": max(max_cards, max_scan_chunks),
            "min_segment_words": min_segment_words,
            "parse_max_pages": parse_max_pages,
            "extract_max_chars": max(1000, extract_max_chars),
            "spread_cards": spread_cards,
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
    parser.add_argument("--max-scan-chunks", type=int, default=DEFAULT_MAX_SCAN_CHUNKS)
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
        help="Maximum extracted characters to inspect for final-card generation.",
    )
    parser.add_argument(
        "--spread-cards",
        action="store_true",
        help="Evenly select cards across scanned chunks instead of taking the first valid chunks.",
    )
    parser.add_argument(
        "--fail-on-blocked",
        action="store_true",
        help="Return a non-zero exit code when no trusted final cards were produced.",
    )
    args = parser.parse_args()
    output_dir = safe_output_dir(args.output_dir)
    report = build_report(
        args.pdf.expanduser().resolve(),
        output_dir,
        max_cards=max(1, args.max_cards),
        max_scan_chunks=max(1, args.max_scan_chunks),
        parse_max_pages=max(1, args.parse_max_pages),
        extract_max_chars=max(1000, args.extract_max_chars),
        spread_cards=args.spread_cards,
    )
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
