from __future__ import annotations

import importlib.util
import re
import subprocess
from pathlib import Path
from typing import Any


def _normalize_text(value: str) -> str:
    collapsed = re.sub(r"\s+", " ", value).strip()
    return collapsed


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


def extract_pdf_text(path: Path) -> dict[str, Any]:
    for provider_name, extractor, mode in (
        ("pypdf", _extract_with_pypdf, "text_layer"),
        ("strings", _extract_with_strings, "heuristic_fallback"),
    ):
        text = extractor(path)
        if text:
            return {
                "text": text[:20000],
                "provider": provider_name,
                "mode": mode,
                "characters": len(text[:20000]),
            }

    return {
        "text": "",
        "provider": "none",
        "mode": "unavailable",
        "characters": 0,
    }
