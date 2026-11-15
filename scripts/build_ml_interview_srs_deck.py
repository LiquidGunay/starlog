#!/usr/bin/env python3
from __future__ import annotations

import argparse
import difflib
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
ANSWER_BASES = [
    "https://raw.githubusercontent.com/zafstojano/ml-interview-questions-and-answers/main/",
]
ANSWER_PATH = "main.tex"
SITE_BASE = "https://huyenchip.com/ml-interviews-book/"
ANSWER_REPO_URL = "https://github.com/zafstojano/ml-interview-questions-and-answers"
SOURCE_ANSWER_NAME = "zafstojano/ml-interview-questions-and-answers"
MANUAL_ANSWER_NAME = "manual-required"


@dataclass
class ListItem:
    depth: int
    text: str
    has_children: bool = False


@dataclass
class QuestionEntry:
    question: str
    difficulty: str
    keys: tuple[str, ...]


@dataclass
class AnswerEntry:
    question: str
    answer: str
    key: str
    used: bool = False


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


def fetch_chapter_source(path: str) -> str:
    candidates = [path]
    if path.endswith(".md"):
        candidates.append(path[:-3])
        if ":" in path:
            candidates.append(path[:-3].split(":", 1)[0])

    last_error: Exception | None = None
    for candidate in candidates:
        try:
            return fetch_from_repo(candidate)
        except Exception as exc:  # noqa: BLE001
            last_error = exc

    if last_error is not None:
        raise RuntimeError(f"Failed to fetch chapter source {path}: {last_error}") from last_error
    raise RuntimeError(f"Failed to fetch chapter source {path}")


def fetch_answer_source() -> str:
    last_error: Exception | None = None
    for base in ANSWER_BASES:
        try:
            return fetch_text(base + ANSWER_PATH)
        except Exception as exc:  # noqa: BLE001
            last_error = exc
    if last_error is not None:
        raise last_error
    raise RuntimeError(f"Failed to fetch {ANSWER_PATH}")


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
    current: ListItem | None = None
    for raw in markdown.splitlines():
        match = list_re.match(raw)
        if match:
            if current is not None:
                items.append(current)
            indent = len(match.group("indent").replace("\t", "    "))
            depth = indent // 2
            current = ListItem(depth=depth, text=match.group("body").rstrip())
            continue
        if current is None:
            continue
        if not raw.strip():
            current.text += "\n"
            continue
        if raw.startswith(" ") or raw.startswith("\t"):
            current.text += "\n" + raw.strip()
    if current is not None:
        items.append(current)

    for idx, item in enumerate(items[:-1]):
        if items[idx + 1].depth > item.depth:
            item.has_children = True
    return items


def split_difficulty(text: str) -> tuple[str, str]:
    stripped = text.strip()
    if not stripped:
        return "", ""
    first_line, *rest = stripped.splitlines()
    match = re.match(r"^\[(E|M|H)\]\s+(.+)$", first_line.strip())
    if match:
        question = "\n".join([match.group(2).strip(), *rest]).strip()
        return match.group(1), question
    return "", stripped


def normalize_key(text: str) -> str:
    normalized = text.replace("’", "'").replace("“", '"').replace("”", '"')
    normalized = normalized.replace("``", '"').replace("''", '"')
    normalized = re.sub(r"\\(?:ldots|cdots|dots)", "...", normalized)
    normalized = normalized.lower()
    normalized = re.sub(r"\\[a-zA-Z]+", "", normalized)
    normalized = normalized.replace("{", "").replace("}", "")
    normalized = normalized.replace("$", "").replace("\\", "")
    normalized = re.sub(r"[^a-z0-9]+", "", normalized)
    return normalized


def question_lookup_keys(text: str) -> tuple[str, ...]:
    keys: list[str] = []
    full_key = normalize_key(text)
    if full_key:
        keys.append(full_key)

    lines = [line.strip() for line in text.splitlines() if line.strip()]
    if lines:
        first_key = normalize_key(lines[0])
        if first_key and first_key not in keys:
            keys.append(first_key)

    if len(lines) > 1:
        first_line = lines[0]
        second_key = normalize_key(lines[1])
        if second_key and second_key not in keys and ("?" not in first_line and len(first_line) <= 60):
            keys.append(second_key)

    if ":" in text:
        leaf = text.split(":", 1)[1].strip()
        leaf_key = normalize_key(leaf)
        if leaf_key and leaf_key not in keys:
            keys.append(leaf_key)

    return tuple(keys)


def question_from_items(items: list[ListItem]) -> list[QuestionEntry]:
    questions: list[QuestionEntry] = []
    stack: list[ListItem] = []

    for item in items:
        while stack and stack[-1].depth >= item.depth:
            stack.pop()
        stack.append(item)

        difficulty, text = split_difficulty(item.text)
        if item.has_children and not difficulty:
            continue
        if "?" not in text and difficulty == "":
            continue

        if item.depth > 0:
            parent = next((node for node in reversed(stack[:-1]) if node.has_children), None)
            if parent is not None:
                _, parent_text = split_difficulty(parent.text)
                text = f"{parent_text}\n{text}"

        questions.append(
            QuestionEntry(
                question=text.strip(),
                difficulty=difficulty,
                keys=question_lookup_keys(text),
            )
        )

    return questions


QUESTION_ANSWER_RE = re.compile(
    r"\\item\s+(?P<question>.*?)\\begin\{answer\}\s*(?P<answer>.*?)\\end\{answer\}",
    re.DOTALL,
)


def clean_latex_text(text: str) -> str:
    cleaned = text.replace("\r\n", "\n")
    cleaned = re.sub(r"\\href\{[^}]*\}\{([^}]*)\}", r"\1", cleaned)
    cleaned = re.sub(r"\\text(?:it|bf)\{([^}]*)\}", r"\1", cleaned)
    cleaned = re.sub(
        r"\\begin\{(?:answer|align\*?|equation\*?|enumerate|itemize|InnerQandA|QandA|ListAlph)\}",
        "\n",
        cleaned,
    )
    cleaned = re.sub(
        r"\\end\{(?:answer|align\*?|equation\*?|enumerate|itemize|InnerQandA|QandA|ListAlph)\}",
        "\n",
        cleaned,
    )
    cleaned = cleaned.replace("\\\\", "\n")
    cleaned = cleaned.replace(r"\%", "%")
    cleaned = re.sub(r"\\([{}_#%&])", r"\1", cleaned)
    cleaned = re.sub(r"\n{3,}", "\n\n", cleaned)
    cleaned = re.sub(r"[ \t]+\n", "\n", cleaned)
    cleaned = re.sub(r"[ \t]{2,}", " ", cleaned)
    return cleaned.strip()


def _direct_answer_pairs(tex_text: str) -> list[AnswerEntry]:
    pairs: list[AnswerEntry] = []
    block_re = re.compile(r"\\begin\{QandA\}(.*?)\\end\{QandA\}", re.DOTALL)
    for block in block_re.findall(tex_text):
        for match in QUESTION_ANSWER_RE.finditer(block):
            question_raw = match.group("question")
            if r"\begin{InnerQandA}" in question_raw or r"\begin{QandA}" in question_raw:
                continue
            question = clean_latex_text(question_raw)
            answer = clean_latex_text(match.group("answer"))
            if not question or not answer:
                continue
            pairs.append(AnswerEntry(question=question, answer=answer, key=normalize_key(question)))
    return pairs


def _inner_answer_pairs(tex_text: str) -> list[AnswerEntry]:
    pairs: list[AnswerEntry] = []
    begin_marker = r"\begin{InnerQandA}"
    end_marker = r"\end{InnerQandA}"
    for match in re.finditer(re.escape(begin_marker), tex_text):
        begin = match.start()
        body_start = match.end()
        body_end = tex_text.find(end_marker, body_start)
        if body_end < 0:
            continue
        parent_item_start = tex_text.rfind(r"\item", 0, begin)
        if parent_item_start < 0:
            continue
        parent_raw = tex_text[parent_item_start + len(r"\item") : begin]
        if r"\begin" in parent_raw or r"\end" in parent_raw or r"\item" in parent_raw:
            continue
        parent = clean_latex_text(parent_raw)
        body = tex_text[body_start:body_end]
        for answer_match in QUESTION_ANSWER_RE.finditer(body):
            child = clean_latex_text(answer_match.group("question"))
            answer = clean_latex_text(answer_match.group("answer"))
            if not parent or not child or not answer:
                continue
            question = f"{parent}\n{child}"
            pairs.append(AnswerEntry(question=question, answer=answer, key=normalize_key(question)))
    return pairs


def parse_answer_pairs(tex_text: str) -> list[AnswerEntry]:
    pairs: list[AnswerEntry] = []
    seen: set[tuple[str, str]] = set()
    for entry in [*_inner_answer_pairs(tex_text), *_direct_answer_pairs(tex_text)]:
        dedupe_key = (entry.key, entry.answer)
        if dedupe_key in seen:
            continue
        seen.add(dedupe_key)
        pairs.append(entry)
    return pairs


def answer_lookup_entries(answer_pairs: list[AnswerEntry]) -> dict[str, list[AnswerEntry]]:
    lookup: dict[str, list[AnswerEntry]] = {}
    for entry in answer_pairs:
        lookup.setdefault(entry.key, []).append(entry)
    return lookup


def build_answer(_question: str) -> str:
    return (
        "Manual answer required. No source answer was found in the public answer repository for this "
        "question, so write and revise your own answer before relying on this card."
    )


def resolve_answer(
    question: QuestionEntry,
    lookup: dict[str, list[AnswerEntry]],
) -> tuple[str, str] | None:
    for key in question.keys:
        candidates = lookup.get(key, [])
        for candidate in candidates:
            if not candidate.used:
                candidate.used = True
                return candidate.answer, SOURCE_ANSWER_NAME

    if lookup:
        close_matches = []
        for key in question.keys:
            close_matches.extend(difflib.get_close_matches(key, list(lookup.keys()), n=3, cutoff=0.92))
        for match_key in close_matches:
            for candidate in lookup.get(match_key, []):
                if not candidate.used:
                    candidate.used = True
                    return candidate.answer, SOURCE_ANSWER_NAME

    return None


def build_deck() -> list[dict[str, str | dict[str, str]]]:
    summary = fetch_from_repo("SUMMARY.md")
    paths = extract_part_ii_paths(summary)
    answer_pairs = parse_answer_pairs(fetch_answer_source())
    lookup = answer_lookup_entries(answer_pairs)

    cards: list[dict[str, str | dict[str, str]]] = []
    card_index = 1

    for path in paths:
        markdown = fetch_chapter_source(path)
        title = first_heading(markdown) or path
        items = parse_list_items(markdown)
        questions = question_from_items(items)
        if not questions:
            continue
        source_url = SITE_BASE + path.replace(".md", ".html")
        for entry in questions:
            metadata = {
                "source_url": source_url,
                "section": title,
                "question_index": f"{card_index:04d}",
                "difficulty": entry.difficulty,
                "answer_source": "",
                "source_path": path,
            }
            resolved = resolve_answer(entry, lookup)
            card = {
                "card_type": "qa",
                "prompt": entry.question,
                "answer": "",
                "difficulty": entry.difficulty,
                "source_url": source_url,
                "section": title,
                "question_index": f"{card_index:04d}",
                "question": entry.question,
                "metadata": metadata,
            }
            if resolved is None:
                card["answer"] = build_answer(entry.question)
                card["metadata"]["answer_source"] = MANUAL_ANSWER_NAME
            else:
                answer, answer_source = resolved
                card["answer"] = answer
                card["metadata"]["answer_source"] = answer_source
            cards.append(card)
            card_index += 1

    return cards


def main() -> int:
    parser = argparse.ArgumentParser(description="Build the Chip Huyen ML Interviews Part II SRS deck.")
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
