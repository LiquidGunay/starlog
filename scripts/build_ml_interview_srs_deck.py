#!/usr/bin/env python3
from __future__ import annotations

import argparse
import json
import re
from dataclasses import dataclass
from pathlib import Path
from urllib.request import Request, urlopen

ROOT_DIR = Path(__file__).resolve().parents[1]

RAW_BASES = [
    "https://raw.githubusercontent.com/chiphuyen/ml-interviews-book/master/",
    "https://raw.githubusercontent.com/chiphuyen/ml-interviews-book/main/",
]
SITE_BASE = "https://huyenchip.com/ml-interviews-book/"


@dataclass
class ListItem:
    depth: int
    text: str
    has_children: bool = False


def fetch_text(url: str) -> str:
    request = Request(url, headers={"User-Agent": "Mozilla/5.0"})
    with urlopen(request, timeout=30) as response:  # noqa: S310
        return response.read().decode("utf-8")


def fetch_from_repo(path: str) -> str:
    last_error: Exception | None = None
    for base in RAW_BASES:
        try:
            return fetch_text(base + path)
        except Exception as exc:  # noqa: BLE001
            last_error = exc
    if last_error is not None:
        raise last_error
    raise RuntimeError(f"Failed to fetch {path}")


def extract_part_ii_paths(summary_text: str) -> list[str]:
    lines = summary_text.splitlines()
    start = None
    end = None
    for idx, line in enumerate(lines):
        if "Part II: Questions" in line:
            start = idx
            continue
        if start is not None and "Appendix" in line:
            end = idx
            break
    if start is None:
        raise ValueError("Part II section not found in SUMMARY.md")
    if end is None:
        end = len(lines)

    paths: list[str] = []
    link_re = re.compile(r"\((contents/[^)]+?\.md)\)")
    for line in lines[start:end]:
        match = link_re.search(line)
        if match:
            paths.append(match.group(1))
    return sorted(set(paths))


def first_heading(markdown: str) -> str:
    for line in markdown.splitlines():
        stripped = line.strip()
        if stripped.startswith("#"):
            return stripped.lstrip("#").strip()
    return ""


def parse_list_items(markdown: str) -> list[ListItem]:
    items: list[ListItem] = []
    list_re = re.compile(r"^(?P<indent>\s*)(?:[-*]|\d+\.)\s+(?P<body>.+)")
    for raw in markdown.splitlines():
        match = list_re.match(raw)
        if not match:
            continue
        indent = len(match.group("indent").replace("\t", "    "))
        depth = indent // 2
        body = match.group("body").strip()
        items.append(ListItem(depth=depth, text=body))

    for idx, item in enumerate(items[:-1]):
        if items[idx + 1].depth > item.depth:
            item.has_children = True
    return items


def normalize_question(text: str) -> tuple[str | None, str]:
    cleaned = re.sub(r"\s+", " ", text).strip()
    match = re.match(r"^\[(E|M|H)\]\s+(.+)$", cleaned)
    if match:
        return match.group(1), match.group(2).strip()
    return None, cleaned


def question_from_items(items: list[ListItem]) -> list[dict[str, str]]:
    questions: list[dict[str, str]] = []
    stack: list[ListItem] = []

    for item in items:
        while stack and stack[-1].depth >= item.depth:
            stack.pop()
        stack.append(item)

        difficulty, text = normalize_question(item.text)
        if item.has_children and not difficulty:
            continue
        if "?" not in text and difficulty is None:
            continue

        if item.depth > 0:
            parent = next((node for node in reversed(stack[:-1]) if node.has_children), None)
            if parent:
                _, parent_text = normalize_question(parent.text)
                text = f"{parent_text}: {text}"

        questions.append({"difficulty": difficulty or "", "question": text})

    return questions


def build_answer(question: str) -> str:
    topic = None
    if ":" in question:
        head, tail = question.split(":", 1)
        if head.strip() and len(head.strip()) <= 40:
            topic = head.strip()
            question = tail.strip()
    lowered = question.lower()
    focus = topic or "the concept"
    if "difference between" in lowered or " vs " in lowered or "compare" in lowered:
        return (
            f"Contrast the two sides of {focus} by definition, assumptions, and typical use-cases. "
            "Call out the most important tradeoffs or failure modes."
        )
    if lowered.startswith("why") or " why " in lowered:
        return f"Explain the motivation behind {focus}, the problem it addresses, and the tradeoffs it introduces."
    if lowered.startswith("how ") or lowered.startswith("how would"):
        return f"Outline the steps for {focus}, required inputs, and a quick validation check or edge case."
    if "probability" in lowered or "expected" in lowered or "variance" in lowered:
        return (
            f"State the distribution/assumptions for {focus}, write the key formula, and compute the result. "
            "Mention why the assumption fits."
        )
    if lowered.startswith("what is") or lowered.startswith("what's") or lowered.startswith("define"):
        return f"Define {focus}, give the key intuition, and include one practical use-case."
    if lowered.startswith("when"):
        return (
            f"Describe when {focus} applies, why it helps, and a counterexample. "
            "Mention the tradeoff."
        )
    return f"Summarize {focus}, the most important assumptions, and the practical implications."


def build_deck() -> list[dict[str, str]]:
    summary = fetch_from_repo("SUMMARY.md")
    paths = extract_part_ii_paths(summary)
    cards: list[dict[str, str]] = []
    card_index = 1

    for path in paths:
        try:
            markdown = fetch_from_repo(path)
        except Exception:  # noqa: BLE001
            continue
        title = first_heading(markdown) or path
        items = parse_list_items(markdown)
        questions = question_from_items(items)
        if not questions:
            continue
        source_url = SITE_BASE + path.replace(".md", ".html")
        for entry in questions:
            question = entry["question"]
            difficulty = entry["difficulty"]
            cards.append(
                {
                    "card_type": "qa",
                    "prompt": question,
                    "answer": build_answer(question),
                    "difficulty": difficulty,
                    "source_url": source_url,
                    "section": title,
                    "question_index": f"{card_index:04d}",
                    "question": question,
                }
            )
            card_index += 1

    return cards


def main() -> int:
    parser = argparse.ArgumentParser(description="Build an ML Interviews Part II SRS deck.")
    parser.add_argument(
        "--output",
        type=Path,
        default=ROOT_DIR / "data/ml_interviews_part_ii_qa_cards.jsonl",
        help="Output JSONL deck path.",
    )
    args = parser.parse_args()

    deck = build_deck()
    args.output.parent.mkdir(parents=True, exist_ok=True)
    with args.output.open("w", encoding="utf-8") as handle:
        for card in deck:
            handle.write(json.dumps(card, sort_keys=True) + "\n")
    print(f"Wrote {len(deck)} cards to {args.output}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
