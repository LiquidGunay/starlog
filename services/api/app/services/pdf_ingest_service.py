from __future__ import annotations

import importlib.util
import json
import os
import re
import subprocess
import uuid
from collections import Counter
from pathlib import Path
from typing import Any
from urllib.error import URLError
from urllib.request import Request, urlopen


def _normalize_text(value: str) -> str:
    collapsed = re.sub(r"\s+", " ", value).strip()
    return collapsed


def _ocr_server_url() -> str | None:
    value = os.getenv("STARLOG_PDF_OCR_SERVER_URL", "").strip()
    return value or None


def _env_int(name: str, default: int) -> int:
    raw_value = os.getenv(name, "").strip()
    if not raw_value:
        return default
    try:
        return int(raw_value)
    except ValueError:
        return default


def _extract_with_ocr_server(path: Path) -> str | None:
    server_url = _ocr_server_url()
    if not server_url or importlib.util.find_spec("fitz") is None:
        return None

    import fitz  # type: ignore[import-not-found]

    language = os.getenv("STARLOG_PDF_OCR_LANGUAGE", "en").strip() or "en"
    dpi = max(110, _env_int("STARLOG_PDF_OCR_DPI", 170))
    max_pages = max(1, min(_env_int("STARLOG_PDF_OCR_MAX_PAGES", 12), 24))
    timeout = max(10, _env_int("STARLOG_PDF_OCR_TIMEOUT_SECONDS", 90))

    try:
        document = fitz.open(str(path))
    except Exception:
        return None

    parts: list[str] = []
    try:
        for page_index in range(min(len(document), max_pages)):
            page = document.load_page(page_index)
            pixmap = page.get_pixmap(dpi=dpi, alpha=False)
            image_bytes = pixmap.tobytes("png")
            boundary = f"starlog-{uuid.uuid4().hex}"
            body = bytearray()
            body.extend(f"--{boundary}\r\n".encode("utf-8"))
            body.extend(b'Content-Disposition: form-data; name="file"; filename="page.png"\r\n')
            body.extend(b"Content-Type: image/png\r\n\r\n")
            body.extend(image_bytes)
            body.extend(b"\r\n")
            body.extend(f"--{boundary}\r\n".encode("utf-8"))
            body.extend(b'Content-Disposition: form-data; name="language"\r\n\r\n')
            body.extend(language.encode("utf-8"))
            body.extend(b"\r\n")
            body.extend(f"--{boundary}--\r\n".encode("utf-8"))

            request = Request(
                server_url,
                data=bytes(body),
                headers={
                    "Content-Type": f"multipart/form-data; boundary={boundary}",
                    "User-Agent": "Starlog/0.1 pdf-ocr",
                },
            )
            with urlopen(request, timeout=timeout) as response:
                payload = json.loads(response.read().decode("utf-8"))
            results = payload.get("results") or []
            page_text = _normalize_text(" ".join(str(item.get("text") or "") for item in results))
            if page_text:
                parts.append(page_text)
    except (OSError, ValueError, URLError, TimeoutError):
        return None
    finally:
        document.close()

    text = _normalize_text("\n".join(parts))
    return text or None


def _extract_with_pypdf(path: Path) -> str | None:
    if importlib.util.find_spec("pypdf") is None:
        return None

    from pypdf import PdfReader  # type: ignore[import-not-found]

    reader = PdfReader(str(path))
    parts: list[str] = []
    for page in reader.pages:
        page_text = page.extract_text() or ""
        if page_text.strip():
            parts.append(page_text)
    text = _normalize_text("\n".join(parts))
    return text or None


def _extract_with_strings(path: Path) -> str | None:
    try:
        result = subprocess.run(
            ["strings", "-n", "8", str(path)],
            check=True,
            capture_output=True,
            text=True,
        )
    except (FileNotFoundError, subprocess.CalledProcessError):
        return None

    lines = []
    for raw_line in result.stdout.splitlines():
        line = _normalize_text(raw_line)
        if len(line) < 20:
            continue
        if line.startswith("<<") or line.startswith(">>"):
            continue
        if any(token in line for token in ("/Type", "/Filter", "/Length", "/Root", "/XRef", "endobj", "stream", "xref", "trailer")):
            continue
        letter_count = sum(char.isalpha() for char in line)
        symbol_count = sum(char in "<>/[]{}" for char in line)
        if letter_count < 12:
            continue
        if symbol_count and symbol_count * 3 > max(letter_count, 1):
            continue
        lines.append(line)

    text = _normalize_text("\n".join(lines[:400]))
    return text or None


def _quality_flags(text: str) -> dict[str, Any]:
    stripped = text.strip()
    characters = len(stripped)
    words = re.findall(r"[A-Za-z]+(?:'[A-Za-z]+)?", stripped)
    normalized_words = [word.lower() for word in words]
    word_counts = Counter(normalized_words)
    word_count = len(words)
    unique_words = len(word_counts)
    common_word_count = sum(word_counts[word] for word in word_counts if word in _COMMON_WORDS)
    sentence_marks = sum(stripped.count(char) for char in ".!?")
    clause_marks = stripped.count(",")
    repeated_token_count = max(word_counts.values()) if word_counts else 0
    alpha = sum(char.isalpha() for char in stripped)
    spaces = sum(char.isspace() for char in stripped)
    unique_chars = len(set(stripped))
    long_words = sum(1 for token in stripped.split() if len(token) >= 4)
    alpha_ratio = alpha / characters if characters else 0.0
    space_ratio = spaces / characters if characters else 0.0
    unique_ratio = unique_chars / characters if characters else 0.0
    readability_score = (
        sentence_marks * 1000
        + clause_marks * 120
        + common_word_count * 50
        + unique_words * 12
        + min(word_count, 120) * 4
        + long_words * 2
        + min(characters, 400) // 5
        + (20 if alpha_ratio >= 0.55 else 0)
        + (10 if space_ratio >= 0.08 else 0)
        - repeated_token_count * 10
    )
    usable = (
        characters >= 120
        and alpha_ratio >= 0.55
        and space_ratio >= 0.08
        and long_words >= 12
        and unique_chars >= 24
    )
    return {
        "usable": usable,
        "characters": characters,
        "alpha_ratio": round(alpha_ratio, 3),
        "space_ratio": round(space_ratio, 3),
        "unique_ratio": round(unique_ratio, 3),
        "unique_characters": unique_chars,
        "long_word_count": long_words,
        "word_count": word_count,
        "unique_word_count": unique_words,
        "common_word_count": common_word_count,
        "sentence_mark_count": sentence_marks,
        "clause_mark_count": clause_marks,
        "repeated_token_count": repeated_token_count,
        "readability_score": readability_score,
    }


_COMMON_WORDS = {
    "a",
    "about",
    "after",
    "also",
    "an",
    "and",
    "are",
    "as",
    "at",
    "be",
    "because",
    "but",
    "by",
    "can",
    "do",
    "for",
    "from",
    "had",
    "has",
    "have",
    "how",
    "if",
    "in",
    "into",
    "is",
    "it",
    "its",
    "more",
    "not",
    "of",
    "on",
    "or",
    "our",
    "out",
    "so",
    "than",
    "that",
    "the",
    "their",
    "then",
    "there",
    "these",
    "they",
    "this",
    "to",
    "use",
    "we",
    "what",
    "when",
    "which",
    "with",
    "you",
}


def _fallback_priority(provider_name: str) -> int:
    return {
        "pypdf": 3,
        "strings": 2,
        "ocr_server": 1,
    }.get(provider_name, -1)


def _candidate_is_readable(candidate: dict[str, Any]) -> bool:
    provider_name = str(candidate.get("provider") or "")
    characters = int(candidate.get("characters") or 0)
    alpha_ratio = float(candidate.get("alpha_ratio") or 0.0)
    space_ratio = float(candidate.get("space_ratio") or 0.0)
    long_word_count = int(candidate.get("long_word_count") or 0)
    if provider_name != "ocr_server":
        return (
            characters >= 40
            and alpha_ratio >= 0.55
            and space_ratio >= 0.05
            and long_word_count >= 4
        )

    if not candidate.get("usable"):
        return False

    word_count = int(candidate.get("word_count") or 0)
    common_word_count = int(candidate.get("common_word_count") or 0)
    sentence_mark_count = int(candidate.get("sentence_mark_count") or 0)
    clause_mark_count = int(candidate.get("clause_mark_count") or 0)
    repeated_token_count = int(candidate.get("repeated_token_count") or 0)
    punctuation_marks = sentence_mark_count + clause_mark_count
    repetition_limit = max(6, word_count // 5)
    return (
        repeated_token_count <= repetition_limit
        and (
            common_word_count >= max(3, min(8, word_count // 18))
            or punctuation_marks >= 2
        )
    )


def _fallback_rank(candidate: dict[str, Any]) -> tuple[int, int, int, int, int]:
    provider_name = str(candidate.get("provider") or "")
    return (
        int(_candidate_is_readable(candidate)),
        int(candidate.get("usable", False)),
        int(candidate.get("readability_score", 0)),
        int(candidate.get("characters", 0)),
        _fallback_priority(provider_name),
    )


def extract_pdf_text(path: Path) -> dict[str, Any]:
    fallback_candidate: dict[str, Any] | None = None
    fallback_rank: tuple[int, int, int] | None = None
    for provider_name, extractor, mode in (
        ("ocr_server", _extract_with_ocr_server, "ocr_server"),
        ("pypdf", _extract_with_pypdf, "text_layer"),
        ("strings", _extract_with_strings, "heuristic_fallback"),
    ):
        try:
            text = extractor(path)
        except Exception:
            continue
        if text:
            quality = _quality_flags(text[:20000])
            candidate = {
                "text": text[:20000],
                "provider": provider_name,
                "mode": mode,
                **quality,
            }
            candidate_rank = _fallback_rank(candidate)
            if fallback_candidate is None or fallback_rank is None or candidate_rank > fallback_rank:
                fallback_candidate = candidate
                fallback_rank = candidate_rank

    if fallback_candidate is not None:
        return fallback_candidate

    return {
        "text": "",
        "provider": "none",
        "mode": "unavailable",
        "characters": 0,
        "usable": False,
        "alpha_ratio": 0.0,
        "space_ratio": 0.0,
        "unique_ratio": 0.0,
        "unique_characters": 0,
        "long_word_count": 0,
    }
