#!/usr/bin/env python3
"""Summarize objective evidence for active Codex worker lanes.

This script is intentionally read-only. It inspects the shared workitem lock
registry plus each claimed worktree, then reports facts a supervisor can poll:
lock age, expected vs actual branch, dirty files, ahead commits, and recent log.
"""

from __future__ import annotations

import argparse
import json
import subprocess
import sys
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Any


STRICT_FAILURE_FLAGS = {
    "stale_lock",
    "missing_worktree",
    "not_git_worktree",
    "branch_mismatch",
    "dirty_worktree",
    "status_error",
}


@dataclass
class CommandResult:
    ok: bool
    stdout: str
    stderr: str


def run(args: list[str], *, cwd: Path) -> CommandResult:
    proc = subprocess.run(args, cwd=str(cwd), capture_output=True, text=True)
    return CommandResult(proc.returncode == 0, proc.stdout.strip(), proc.stderr.strip())


def parse_iso(value: str | None) -> datetime | None:
    if not value:
        return None
    try:
        return datetime.fromisoformat(value.replace("Z", "+00:00"))
    except ValueError:
        return None


def iso_now() -> str:
    return datetime.now(timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z")


def git_common_dir(repo_root: Path) -> Path:
    result = run(["git", "rev-parse", "--git-common-dir"], cwd=repo_root)
    if not result.ok:
        raise SystemExit(f"failed to resolve git common dir: {result.stderr}")
    path = Path(result.stdout)
    if not path.is_absolute():
        path = repo_root / path
    return path.resolve()


def load_json(path: Path, default: Any) -> Any:
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except FileNotFoundError:
        return default
    except json.JSONDecodeError:
        return default


def active_locks(registry_root: Path, workitem_id: str | None) -> list[dict[str, Any]]:
    locks_dir = registry_root / "locks"
    if workitem_id:
        payload = load_json(locks_dir / f"{workitem_id}.lock", None)
        return [payload] if isinstance(payload, dict) else []
    locks: list[dict[str, Any]] = []
    for path in sorted(locks_dir.glob("*.lock")):
        payload = load_json(path, {})
        if isinstance(payload, dict):
            locks.append(payload)
    return locks


def workitem_lookup(registry_root: Path) -> dict[str, dict[str, Any]]:
    payload = load_json(registry_root / "workitems.json", {"items": []})
    items = payload.get("items", []) if isinstance(payload, dict) else []
    return {
        str(item.get("id")): item
        for item in items
        if isinstance(item, dict) and item.get("id")
    }


def git_lines(args: list[str], *, cwd: Path) -> tuple[bool, list[str], str]:
    result = run(args, cwd=cwd)
    lines = [line for line in result.stdout.splitlines() if line]
    return result.ok, lines, result.stderr


def inspect_worktree(
    lock: dict[str, Any],
    now: datetime,
    stale_minutes: int,
    expected_common_dir: Path,
) -> dict[str, Any]:
    worktree_raw = str(lock.get("worktree") or "")
    expected_branch = str(lock.get("branch") or "")
    worktree = Path(worktree_raw) if worktree_raw else None
    heartbeat = parse_iso(str(lock.get("last_heartbeat_at") or lock.get("claimed_at") or ""))
    heartbeat_age_seconds = None
    if heartbeat is not None:
        heartbeat_age_seconds = int((now - heartbeat).total_seconds())

    evidence: dict[str, Any] = {
        "workitem_id": lock.get("workitem_id"),
        "agent_id": lock.get("agent_id"),
        "worktree": worktree_raw or None,
        "expected_branch": expected_branch or None,
        "claimed_at": lock.get("claimed_at"),
        "last_heartbeat_at": lock.get("last_heartbeat_at"),
        "heartbeat_age_seconds": heartbeat_age_seconds,
        "stale_lock": heartbeat_age_seconds is None or heartbeat_age_seconds > stale_minutes * 60,
        "worktree_exists": bool(worktree and worktree.exists()),
        "is_git_worktree": False,
        "git_common_dir": None,
        "shares_expected_common_dir": None,
        "head_sha": None,
        "actual_branch": None,
        "branch_matches": None,
        "status_branch": None,
        "status_short": [],
        "dirty_file_count": None,
        "diff_stat": [],
        "cached_diff_stat": [],
        "tracking_ref": None,
        "ahead_count": None,
        "recent_commits": [],
        "flags": [],
    }

    if evidence["stale_lock"]:
        evidence["flags"].append("stale_lock")
    if not worktree or not worktree.exists():
        evidence["flags"].append("missing_worktree")
        return evidence

    inside = run(["git", "rev-parse", "--is-inside-work-tree"], cwd=worktree)
    evidence["is_git_worktree"] = inside.ok and inside.stdout == "true"
    if not evidence["is_git_worktree"]:
        evidence["flags"].append("not_git_worktree")
        return evidence

    common_dir = run(["git", "rev-parse", "--git-common-dir"], cwd=worktree)
    if common_dir.ok and common_dir.stdout:
        common_path = Path(common_dir.stdout)
        if not common_path.is_absolute():
            common_path = worktree / common_path
        common_path = common_path.resolve()
        evidence["git_common_dir"] = str(common_path)
        evidence["shares_expected_common_dir"] = common_path == expected_common_dir
        if common_path != expected_common_dir:
            evidence["flags"].append("foreign_git_common_dir")

    head_sha = run(["git", "rev-parse", "HEAD"], cwd=worktree)
    if head_sha.ok and head_sha.stdout:
        evidence["head_sha"] = head_sha.stdout

    branch = run(["git", "branch", "--show-current"], cwd=worktree)
    evidence["actual_branch"] = branch.stdout if branch.ok and branch.stdout else None
    if expected_branch:
        evidence["branch_matches"] = evidence["actual_branch"] == expected_branch
        if not evidence["branch_matches"]:
            evidence["flags"].append("branch_mismatch")

    ok, status_lines, err = git_lines(
        ["git", "status", "--short", "--branch", "--untracked-files=all"],
        cwd=worktree,
    )
    if ok and status_lines:
        evidence["status_branch"] = status_lines[0]
        evidence["status_short"] = status_lines[1:]
        evidence["dirty_file_count"] = len(status_lines[1:])
        if status_lines[1:]:
            evidence["flags"].append("dirty_worktree")
    elif not ok:
        evidence["status_error"] = err
        evidence["flags"].append("status_error")

    ok, diff_stat, _err = git_lines(["git", "diff", "--stat"], cwd=worktree)
    if ok:
        evidence["diff_stat"] = diff_stat
    ok, cached_stat, _err = git_lines(["git", "diff", "--cached", "--stat"], cwd=worktree)
    if ok:
        evidence["cached_diff_stat"] = cached_stat

    upstream = run(["git", "rev-parse", "--abbrev-ref", "--symbolic-full-name", "@{upstream}"], cwd=worktree)
    if upstream.ok and upstream.stdout:
        evidence["tracking_ref"] = upstream.stdout
        ahead = run(["git", "rev-list", "--count", f"{upstream.stdout}..HEAD"], cwd=worktree)
        if ahead.ok and ahead.stdout.isdigit():
            evidence["ahead_count"] = int(ahead.stdout)
            if evidence["ahead_count"] > 0:
                evidence["flags"].append("ahead_of_upstream")

    ok, recent_commits, _err = git_lines(["git", "log", "--oneline", "--decorate", "--max-count=3"], cwd=worktree)
    if ok:
        evidence["recent_commits"] = recent_commits

    return evidence


def render_text(payload: dict[str, Any]) -> str:
    lines = [
        f"Agent objective evidence at {payload['generated_at']}",
        f"Registry: {payload['registry_root']}",
        f"Stale threshold: {payload['stale_minutes']} minutes",
        "",
    ]
    workers = payload["workers"]
    if not workers:
        if payload.get("missing_workitem_id"):
            lines.append(f"No active lock found for workitem {payload['missing_workitem_id']}.")
        else:
            lines.append("No active workitem locks.")
        return "\n".join(lines)

    for worker in workers:
        flags = ", ".join(worker["flags"]) if worker["flags"] else "none"
        lines.extend(
            [
                f"## {worker.get('workitem_id')} / {worker.get('agent_id')}",
                f"worktree: {worker.get('worktree')}",
                f"branch: expected={worker.get('expected_branch')} actual={worker.get('actual_branch')} match={worker.get('branch_matches')}",
                f"git_common_dir: {worker.get('git_common_dir')} shared={worker.get('shares_expected_common_dir')}",
                f"head_sha: {worker.get('head_sha')}",
                f"heartbeat_age_seconds: {worker.get('heartbeat_age_seconds')} stale={worker.get('stale_lock')}",
                f"status: {worker.get('status_branch')}",
                f"dirty_file_count: {worker.get('dirty_file_count')} ahead_count: {worker.get('ahead_count')} tracking: {worker.get('tracking_ref')}",
                f"flags: {flags}",
            ]
        )
        if worker.get("status_short"):
            lines.append("changed/status files:")
            lines.extend(f"  {line}" for line in worker["status_short"][:20])
        if worker.get("diff_stat"):
            lines.append("diff stat:")
            lines.extend(f"  {line}" for line in worker["diff_stat"][:20])
        if worker.get("cached_diff_stat"):
            lines.append("cached diff stat:")
            lines.extend(f"  {line}" for line in worker["cached_diff_stat"][:20])
        if worker.get("recent_commits"):
            lines.append("recent commits:")
            lines.extend(f"  {line}" for line in worker["recent_commits"])
        lines.append("")
    return "\n".join(lines).rstrip()


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--repo-root", default=".", help="Path inside the repository.")
    parser.add_argument("--workitem-id", help="Only inspect one workitem lock.")
    parser.add_argument("--stale-minutes", type=int, default=10)
    parser.add_argument("--json", action="store_true", help="Emit JSON instead of text.")
    parser.add_argument(
        "--strict",
        action="store_true",
        help="Exit non-zero when stale, missing, mismatched, dirty, or unreadable worktrees are found.",
    )
    args = parser.parse_args()

    repo_root = Path(args.repo_root).resolve()
    registry_root = git_common_dir(repo_root) / "codex-workitems"
    now = datetime.now(timezone.utc)
    items = workitem_lookup(registry_root)
    locks = active_locks(registry_root, args.workitem_id)
    workers = []
    for lock in locks:
        evidence = inspect_worktree(lock, now, args.stale_minutes, git_common_dir(repo_root))
        item = items.get(str(evidence.get("workitem_id") or ""))
        if item is not None:
            evidence["workitem_status"] = item.get("status")
            evidence["workitem_title"] = item.get("title")
        workers.append(evidence)

    payload = {
        "generated_at": iso_now(),
        "repo_root": str(repo_root),
        "registry_root": str(registry_root),
        "stale_minutes": args.stale_minutes,
        "workers": workers,
    }
    if args.workitem_id and not locks:
        payload["missing_workitem_id"] = args.workitem_id
    if args.json:
        print(json.dumps(payload, indent=2, sort_keys=True))
    else:
        print(render_text(payload))

    if args.workitem_id and not locks:
        return 2
    if args.strict and any(STRICT_FAILURE_FLAGS.intersection(worker["flags"]) for worker in workers):
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
