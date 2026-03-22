from __future__ import annotations

import argparse
import json
import sys

from runtime_app.evals import load_eval_fixtures, score_fixture_sample


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="Run Starlog runtime eval fixtures against bundled samples.")
    parser.add_argument("--fixture-id", help="Optional fixture id to run")
    parser.add_argument(
        "--sample",
        choices=("good", "bad", "both"),
        default="both",
        help="Which bundled sample to score",
    )
    return parser


def main() -> int:
    args = build_parser().parse_args()
    fixtures = load_eval_fixtures()
    if args.fixture_id:
        fixtures = [fixture for fixture in fixtures if fixture.fixture_id == args.fixture_id]
    if not fixtures:
        print("No matching fixtures found.", file=sys.stderr)
        return 1

    sample_names = ("good", "bad") if args.sample == "both" else (args.sample,)
    failing_runs = 0
    for fixture in fixtures:
        for sample_name in sample_names:
            result = score_fixture_sample(fixture, sample_name)
            expected_pass = sample_name == "good"
            if result.passed != expected_pass:
                failing_runs += 1
            print(
                json.dumps(
                    {
                        "fixture_id": fixture.fixture_id,
                        "sample": sample_name,
                        "workflow": fixture.workflow,
                        "score": result.score,
                        "passed": result.passed,
                        "expected_pass": expected_pass,
                        "details": [detail.__dict__ for detail in result.details],
                    },
                    indent=2,
                )
            )
    return 1 if failing_runs else 0


if __name__ == "__main__":
    raise SystemExit(main())
