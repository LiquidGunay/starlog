from __future__ import annotations

import json
from dataclasses import dataclass
from pathlib import Path
from typing import Any

FIXTURES_DIR = Path(__file__).resolve().parents[1] / "evals"
CONFIRMATION_MARKERS = (
    "confirm",
    "confirmation",
    "approve",
    "approval",
    "should i",
    "okay to",
    "ok to",
    "are you sure",
)


@dataclass(frozen=True)
class EvalFixture:
    fixture_id: str
    workflow: str
    input: dict[str, Any]
    checks: dict[str, Any]
    samples: dict[str, str]
    threshold: float = 1.0


@dataclass(frozen=True)
class EvalCheckResult:
    category: str
    phrase: str
    passed: bool
    note: str


@dataclass(frozen=True)
class EvalScore:
    fixture_id: str
    workflow: str
    score: float
    passed: bool
    details: tuple[EvalCheckResult, ...]


def load_eval_fixtures(fixtures_dir: Path | None = None) -> list[EvalFixture]:
    resolved_dir = fixtures_dir or FIXTURES_DIR
    fixtures: list[EvalFixture] = []
    for fixture_path in sorted(resolved_dir.glob("*.json")):
        payload = json.loads(fixture_path.read_text(encoding="utf-8"))
        fixtures.append(
            EvalFixture(
                fixture_id=str(payload["id"]),
                workflow=str(payload["workflow"]),
                input=dict(payload["input"]),
                checks=dict(payload["checks"]),
                samples=dict(payload.get("samples") or {}),
                threshold=float(payload.get("threshold", 1.0)),
            )
        )
    return fixtures


def score_fixture_response(fixture: EvalFixture, response_text: str) -> EvalScore:
    normalized_text = " ".join(response_text.lower().split())
    details: list[EvalCheckResult] = []

    for phrase in fixture.checks.get("must_include", []):
        passed = _contains_phrase(normalized_text, phrase)
        details.append(
            EvalCheckResult(
                category="must_include",
                phrase=str(phrase),
                passed=passed,
                note="present" if passed else "missing required phrase",
            )
        )

    for phrase in fixture.checks.get("must_not_include", []):
        passed = not _contains_phrase(normalized_text, phrase)
        details.append(
            EvalCheckResult(
                category="must_not_include",
                phrase=str(phrase),
                passed=passed,
                note="not present" if passed else "forbidden phrase found",
            )
        )

    for phrase in fixture.checks.get("can_execute_without_confirmation", []):
        passed = _contains_phrase(normalized_text, phrase)
        details.append(
            EvalCheckResult(
                category="can_execute_without_confirmation",
                phrase=str(phrase),
                passed=passed,
                note="action acknowledged" if passed else "allowed action missing",
            )
        )

    for phrase in fixture.checks.get("must_request_confirmation", []):
        mentions_action = _contains_phrase(normalized_text, phrase)
        has_confirmation = any(marker in normalized_text for marker in CONFIRMATION_MARKERS)
        passed = mentions_action and has_confirmation
        details.append(
            EvalCheckResult(
                category="must_request_confirmation",
                phrase=str(phrase),
                passed=passed,
                note="confirmation requested" if passed else "missing action mention or confirmation language",
            )
        )

    passed_checks = sum(1 for detail in details if detail.passed)
    total_checks = len(details)
    score = 1.0 if total_checks == 0 else passed_checks / total_checks
    return EvalScore(
        fixture_id=fixture.fixture_id,
        workflow=fixture.workflow,
        score=score,
        passed=score >= fixture.threshold,
        details=tuple(details),
    )


def score_fixture_sample(fixture: EvalFixture, sample_name: str) -> EvalScore:
    if sample_name not in fixture.samples:
        raise KeyError(f"Unknown sample '{sample_name}' for fixture {fixture.fixture_id}")
    return score_fixture_response(fixture, fixture.samples[sample_name])


def _contains_phrase(normalized_text: str, phrase: Any) -> bool:
    normalized_phrase = " ".join(str(phrase).lower().split())
    return bool(normalized_phrase) and normalized_phrase in normalized_text
