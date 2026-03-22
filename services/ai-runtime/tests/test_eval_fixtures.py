from __future__ import annotations

import json
from pathlib import Path

from runtime_app.evals import load_eval_fixtures, score_fixture_sample


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
        assert 0 < float(payload.get("threshold", 1.0)) <= 1.0
        assert set((payload.get("samples") or {}).keys()) == {"good", "bad"}


def test_good_samples_pass_and_bad_samples_fail() -> None:
    fixtures = load_eval_fixtures()
    assert fixtures

    for fixture in fixtures:
        good_result = score_fixture_sample(fixture, "good")
        bad_result = score_fixture_sample(fixture, "bad")

        assert good_result.passed, fixture.fixture_id
        assert not bad_result.passed, fixture.fixture_id
        assert good_result.score > bad_result.score, fixture.fixture_id
