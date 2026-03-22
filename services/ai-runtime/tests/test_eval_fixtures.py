from __future__ import annotations

import json
from pathlib import Path


def test_eval_fixtures_are_well_formed() -> None:
    fixtures_dir = Path(__file__).resolve().parents[1] / "evals"
    fixture_paths = sorted(fixtures_dir.glob("*.json"))

    assert fixture_paths, "Expected reviewable eval fixtures under services/ai-runtime/evals"

    for fixture_path in fixture_paths:
        payload = json.loads(fixture_path.read_text(encoding="utf-8"))
        assert payload["id"]
        assert payload["workflow"] in {"chat_turn", "briefing", "research_digest"}
        assert isinstance(payload["input"], dict)
        assert isinstance(payload["checks"], dict)
