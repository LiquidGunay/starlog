"""Compatibility wrapper for Codex-only Starlog AI job processing."""

from __future__ import annotations

import sys

from local_ai_worker import main


if __name__ == "__main__":
    raise SystemExit(main(["--provider-hints", "codex_local", *sys.argv[1:]]))
