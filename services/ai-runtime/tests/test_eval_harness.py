from __future__ import annotations

from runtime_app.evals import load_eval_fixtures, score_fixture_response


def test_score_fixture_response_explains_failures() -> None:
    fixture = next(item for item in load_eval_fixtures() if item.fixture_id == "briefing-quality-001")
    result = score_fixture_response(fixture, "Tasks only. Silent write the calendar change.")

    assert not result.passed
    assert result.score < fixture.threshold
    assert any(detail.category == "must_include" and not detail.passed for detail in result.details)
    assert any(detail.category == "must_not_include" and not detail.passed for detail in result.details)
