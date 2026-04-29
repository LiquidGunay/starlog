#!/usr/bin/env python3
"""Smoke-test local Codex CLI authentication for Starlog worker use."""

from __future__ import annotations

import argparse
import os
import shutil
import subprocess
import sys


DEFAULT_CODEX_MODEL = "gpt-5.4-mini"
SUCCESS_SENTINEL = "starlog-codex-auth-ok"


def default_model() -> str:
    return os.environ.get("STARLOG_CODEX_MODEL", "").strip() or DEFAULT_CODEX_MODEL


def build_command(model: str | None) -> list[str]:
    command = ["codex", "exec"]
    if model:
        command.extend(["-m", model])
    command.extend(
        [
            "--skip-git-repo-check",
            "--ephemeral",
            f"Reply exactly: {SUCCESS_SENTINEL}",
        ]
    )
    return command


def parse_args(argv: list[str] | None = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--model",
        default=default_model(),
        help="Codex model to smoke. Defaults to STARLOG_CODEX_MODEL or gpt-5.4-mini.",
    )
    parser.add_argument(
        "--use-cli-default",
        action="store_true",
        help="Omit -m and let the Codex CLI choose its configured/default model.",
    )
    parser.add_argument("--timeout-seconds", type=float, default=120.0)
    return parser.parse_args(argv)


def run_smoke(argv: list[str] | None = None) -> int:
    args = parse_args(argv)
    if not shutil.which("codex"):
        print("codex CLI is not installed or not on PATH", file=sys.stderr)
        return 2

    model = None if args.use_cli_default else str(args.model or "").strip() or None
    command = build_command(model)
    result = subprocess.run(
        command,
        capture_output=True,
        text=True,
        check=False,
        timeout=args.timeout_seconds,
    )
    output = "\n".join(part for part in [result.stdout.strip(), result.stderr.strip()] if part)
    if result.returncode == 0 and SUCCESS_SENTINEL in output:
        model_label = model or "codex-cli-default"
        print(f"codex-auth-smoke-ok model={model_label}")
        return 0

    print(output or "Codex auth smoke failed without output.", file=sys.stderr)
    if model == DEFAULT_CODEX_MODEL and "not supported when using Codex with a ChatGPT account" in output:
        print(
            "Codex auth reached OpenAI, but this ChatGPT-account auth mode does not expose gpt-5.4-mini. "
            "Use API-key/project auth for the requested default model, or rerun this smoke with --use-cli-default.",
            file=sys.stderr,
        )
    return result.returncode or 1


def main() -> int:
    try:
        return run_smoke()
    except subprocess.TimeoutExpired as exc:
        print(f"Codex auth smoke timed out after {exc.timeout} seconds", file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
