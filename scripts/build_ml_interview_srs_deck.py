#!/usr/bin/env python3
from __future__ import annotations

import argparse
import difflib
import json
import os
import re
from dataclasses import dataclass
from pathlib import Path
from typing import Any
import urllib.error
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


def load_repo_env() -> None:
    for env_path in (ROOT_DIR / ".env", Path("/home/ubuntu/starlog/.env")):
        if not env_path.exists():
            continue

        for raw_line in env_path.read_text(encoding="utf-8").splitlines():
            line = raw_line.strip()
            if not line or line.startswith("#") or "=" not in line:
                continue
            key, value = line.split("=", 1)
            key = key.strip()
            if not key or key in os.environ:
                continue
            value = value.strip()
            if len(value) >= 2 and value[0] == value[-1] and value[0] in {'"', "'"}:
                value = value[1:-1]
            os.environ[key] = value


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
    normalized = normalized.lower()
    normalized = re.sub(r"\\[a-zA-Z]+", "", normalized)
    normalized = normalized.replace("{", "").replace("}", "")
    normalized = normalized.replace("$", "").replace("\\", "")
    normalized = re.sub(r"\s+", "", normalized)
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


def parse_answer_pairs(tex_text: str) -> list[AnswerEntry]:
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


def answer_lookup_entries(answer_pairs: list[AnswerEntry]) -> dict[str, list[AnswerEntry]]:
    lookup: dict[str, list[AnswerEntry]] = {}
    for entry in answer_pairs:
        lookup.setdefault(entry.key, []).append(entry)
    return lookup


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


def resolve_answer(
    question: QuestionEntry,
    lookup: dict[str, list[AnswerEntry]],
) -> tuple[str, str] | None:
    for key in question.keys:
        candidates = lookup.get(key, [])
        for candidate in candidates:
            if not candidate.used:
                candidate.used = True
                return candidate.answer, "zafstojano/ml-interview-questions-and-answers"

    if lookup:
        close_matches = []
        for key in question.keys:
            close_matches.extend(difflib.get_close_matches(key, list(lookup.keys()), n=3, cutoff=0.92))
        for match_key in close_matches:
            for candidate in lookup.get(match_key, []):
                if not candidate.used:
                    candidate.used = True
                    return candidate.answer, "zafstojano/ml-interview-questions-and-answers"

    return None


def _openai_api_key() -> str | None:
    load_repo_env()
    return os.getenv("OPENAI_API_KEY") or os.getenv("STARLOG_OPENAI_API_KEY")


def _openai_model() -> str:
    return os.getenv("OPENAI_MODEL", "gpt-5.4-nano")


def _openai_extract_output_text(payload: dict[str, Any]) -> str:
    output_text = payload.get("output_text")
    if isinstance(output_text, str) and output_text:
        return output_text

    collected: list[str] = []
    for item in payload.get("output", []):
        if not isinstance(item, dict):
            continue
        for content in item.get("content", []):
            if not isinstance(content, dict):
                continue
            text_value = content.get("text")
            if isinstance(text_value, str):
                collected.append(text_value)
    return "\n".join(collected)


def _openai_generate_answers(section_title: str, questions: list[QuestionEntry]) -> list[str]:
    api_key = _openai_api_key()
    if not api_key or not questions:
        return []

    model = _openai_model()
    prompt = "\n".join(
        [
            f"Section: {section_title}",
            "You are writing concise but correct study answers for ML interview flashcards.",
            "Return JSON only with the shape {\"answers\": [string, ...]}.",
            "The answers array must be in the same order as the questions.",
            "Keep each answer focused, technically accurate, and short enough for spaced repetition.",
            "Use formulas or concrete steps when the question calls for them.",
            "Do not add commentary, numbering, or markdown fences.",
            "",
            "Questions:",
            json.dumps([question.question for question in questions], ensure_ascii=False, indent=2),
        ]
    )
    payload = {
        "model": model,
        "input": prompt,
    }
    request = Request(
        "https://api.openai.com/v1/responses",
        data=json.dumps(payload).encode("utf-8"),
        headers={
            "Authorization": f"Bearer {api_key}",
            "Content-Type": "application/json",
        },
        method="POST",
    )
    try:
        with urlopen(request, timeout=120) as response:  # noqa: S310
            response_payload = json.loads(response.read().decode("utf-8"))
    except urllib.error.HTTPError:
        return []

    output_text = _openai_extract_output_text(response_payload)
    if not output_text.strip():
        return []

    try:
        parsed = json.loads(output_text)
    except json.JSONDecodeError:
        return []

    answers = parsed.get("answers") if isinstance(parsed, dict) else None
    if not isinstance(answers, list):
        return []

    resolved: list[str] = []
    for answer in answers[: len(questions)]:
        if isinstance(answer, str) and answer.strip():
            resolved.append(answer.strip())
        else:
            resolved.append("")
    return resolved


def build_deck() -> list[dict[str, str | dict[str, str]]]:
    summary = fetch_from_repo("SUMMARY.md")
    paths = extract_part_ii_paths(summary)
    answer_pairs = parse_answer_pairs(fetch_answer_source())
    lookup = answer_lookup_entries(answer_pairs)

    cards: list[dict[str, str | dict[str, str]]] = []
    fetch_failures: list[str] = []
    card_index = 1

    for path in paths:
        try:
            markdown = fetch_from_repo(path)
        except Exception as exc:  # noqa: BLE001
            fetch_failures.append(f"{path}: {exc}")
            continue
        title = first_heading(markdown) or path
        items = parse_list_items(markdown)
        questions = question_from_items(items)
        if not questions:
            continue
        source_url = SITE_BASE + path.replace(".md", ".html")
        pending: list[tuple[QuestionEntry, dict[str, str | dict[str, str]]]] = []
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
                pending.append((entry, card))
            else:
                answer, answer_source = resolved
                card["answer"] = answer
                card["metadata"]["answer_source"] = answer_source
                cards.append(card)
            card_index += 1

        if pending:
            generated = _openai_generate_answers(title, [entry for entry, _ in pending])
            for idx, (entry, card) in enumerate(pending):
                generated_answer = generated[idx] if idx < len(generated) else ""
                if generated_answer:
                    answer = generated_answer
                    answer_source = f"openai:{_openai_model()}"
                else:
                    retry = _openai_generate_answers(title, [entry])
                    retry_answer = retry[0] if retry else ""
                    if retry_answer:
                        answer = retry_answer
                        answer_source = f"openai:{_openai_model()}"
                    else:
                        answer = build_answer(entry.question)
                        answer_source = "heuristic"
                card["answer"] = answer
                card["metadata"]["answer_source"] = answer_source
                cards.append(card)

    if fetch_failures:
        failure_text = "; ".join(fetch_failures)
        raise RuntimeError(f"Failed to fetch one or more chapter sources: {failure_text}")

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
