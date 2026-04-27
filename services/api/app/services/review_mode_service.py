from __future__ import annotations

from collections import Counter
from typing import Any

REVIEW_MODE_ORDER = ("recall", "understanding", "application", "synthesis", "judgment")

_CARD_TYPE_TO_MODE = {
    "qa": "recall",
    "cloze": "recall",
    "recall": "recall",
    "understanding": "understanding",
    "explain": "understanding",
    "why": "understanding",
    "application": "application",
    "scenario": "application",
    "drill": "application",
    "synthesis": "synthesis",
    "compare": "synthesis",
    "connect": "synthesis",
    "judgment": "judgment",
    "tradeoff": "judgment",
    "critique": "judgment",
}

MODE_BODY_LABELS = {
    "recall": "Recall due",
    "understanding": "Understanding checks",
    "application": "Application drills",
    "synthesis": "Synthesis prompts",
    "judgment": "Judgment calls",
}


def review_mode_for_card_type(card_type: str | None) -> str:
    normalized = str(card_type or "").strip().lower().replace(" ", "_")
    return _CARD_TYPE_TO_MODE.get(normalized, "recall")


def mode_counts_for_cards(cards: list[dict[str, Any]]) -> dict[str, int]:
    counts = Counter(review_mode_for_card_type(card.get("card_type")) for card in cards)
    return {mode: counts[mode] for mode in REVIEW_MODE_ORDER if counts[mode] > 0}


def primary_mode_for_counts(mode_counts: dict[str, int]) -> str:
    if not mode_counts:
        return "recall"
    return max(REVIEW_MODE_ORDER, key=lambda mode: (mode_counts.get(mode, 0), -REVIEW_MODE_ORDER.index(mode)))


def review_queue_summary(mode_counts: dict[str, int]) -> str:
    return " · ".join(
        f"{MODE_BODY_LABELS[mode]}: {mode_counts[mode]}"
        for mode in REVIEW_MODE_ORDER
        if mode_counts.get(mode, 0) > 0
    )
