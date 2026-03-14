#!/usr/bin/env python3
"""
Sync human-readable Lock lines in docs/CODEX_PARALLEL_WORK_ITEMS.md from
the shared `.git/codex-workitems` registry.
"""

from __future__ import annotations

import argparse
import json
import re
import subprocess
from pathlib import Path
from typing import Any


LOCK_LINE_PATTERN = re.compile(r"^(\s*-\s*Lock:\s*`)([^`]*)(`\s*)$")
WORKITEM_ID_PATTERN = re.compile(r"\b(WI-\d+)\b")


def git_common_dir(repo_root: Path) -> Path:
    proc = subprocess.run(
        ["git", "rev-parse", "--git-common-dir"],
        cwd=str(repo_root),
        check=True,
        capture_output=True,
        text=True,
    )
    raw = proc.stdout.strip()
    path = Path(raw)
    if not path.is_absolute():
        path = repo_root / path
    return path.resolve()


def read_json(path: Path, default: Any) -> Any:
    if not path.exists():
        return default
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except json.JSONDecodeError:
        return default


def load_registry(registry_root: Path) -> tuple[dict[str, dict[str, Any]], dict[str, dict[str, Any]]]:
    workitems_payload = read_json(registry_root / "workitems.json", {"items": []})
    items_raw = workitems_payload.get("items", [])
    items: dict[str, dict[str, Any]] = {}
    for entry in items_raw:
        if isinstance(entry, dict) and isinstance(entry.get("id"), str):
            items[entry["id"]] = entry

    locks: dict[str, dict[str, Any]] = {}
    locks_dir = registry_root / "locks"
    if locks_dir.exists():
        for lock_file in sorted(locks_dir.glob("*.lock")):
            lock_payload = read_json(lock_file, {})
            if not isinstance(lock_payload, dict):
                continue
            workitem_id = lock_payload.get("workitem_id")
            if isinstance(workitem_id, str):
                locks[workitem_id] = lock_payload

    return items, locks


def normalize_state(item: dict[str, Any] | None, lock: dict[str, Any] | None) -> str:
    if lock is not None:
        return "IN_PROGRESS"
    if not item:
        return "UNCLAIMED"

    status = str(item.get("status") or "").strip().lower()
    if status == "completed":
        return "COMPLETED"
    if status == "handoff":
        handoff_to = str(item.get("handoff_to") or "").strip().upper()
        return f"HANDOFF_{handoff_to}" if handoff_to else "HANDOFF"
    if status == "open":
        return "OPEN"
    if status == "in_progress":
        return "IN_PROGRESS"
    return "UNCLAIMED"


def normalize_owner(item: dict[str, Any] | None, lock: dict[str, Any] | None) -> str:
    owner_id = None
    if lock is not None:
        owner_id = lock.get("agent_id")
    elif item is not None:
        owner = item.get("owner")
        if isinstance(owner, dict):
            owner_id = owner.get("agent_id")

    if isinstance(owner_id, str) and owner_id.strip():
        return f"Agent {owner_id.strip()}"
    return "N/A"


def normalize_claimed(item: dict[str, Any] | None, lock: dict[str, Any] | None) -> str:
    for candidate in (
        lock.get("claimed_at") if lock else None,
        item.get("claimed_at") if item else None,
    ):
        if isinstance(candidate, str) and candidate.strip():
            return candidate.strip()
    return "N/A"


def normalize_heartbeat(item: dict[str, Any] | None, lock: dict[str, Any] | None) -> str:
    for candidate in (
        lock.get("last_heartbeat_at") if lock else None,
        item.get("last_heartbeat_at") if item else None,
    ):
        if isinstance(candidate, str) and candidate.strip():
            return candidate.strip()
    return "N/A"


def build_lock_value(workitem_id: str, item: dict[str, Any] | None, lock: dict[str, Any] | None) -> str:
    state = normalize_state(item, lock)
    owner = normalize_owner(item, lock)
    claimed = normalize_claimed(item, lock)
    heartbeat = normalize_heartbeat(item, lock)
    return (
        f"{state} | Workitem: {workitem_id} | Owner: {owner} | "
        f"Claimed: {claimed} | Last heartbeat: {heartbeat}"
    )


def sync_lock_lines(
    doc_path: Path,
    items: dict[str, dict[str, Any]],
    locks: dict[str, dict[str, Any]],
    *,
    check: bool = False,
) -> int:
    original = doc_path.read_text(encoding="utf-8")
    updated_lines: list[str] = []
    changed = 0

    for line in original.splitlines(keepends=True):
        match = LOCK_LINE_PATTERN.match(line)
        if not match:
            updated_lines.append(line)
            continue

        inner = match.group(2)
        id_match = WORKITEM_ID_PATTERN.search(inner)
        if not id_match:
            updated_lines.append(line)
            continue

        workitem_id = id_match.group(1)
        next_value = build_lock_value(workitem_id, items.get(workitem_id), locks.get(workitem_id))
        next_line = f"{match.group(1)}{next_value}{match.group(3)}"
        if next_line != line:
            changed += 1
        updated_lines.append(next_line)

    if changed > 0 and not check:
        doc_path.write_text("".join(updated_lines), encoding="utf-8")
    return changed


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="Sync workitem Lock lines in docs from shared registry.")
    parser.add_argument("--repo-root", default=".", help="Path inside repository (default: current directory).")
    parser.add_argument(
        "--doc",
        default="docs/CODEX_PARALLEL_WORK_ITEMS.md",
        help="Path to markdown file with Lock lines.",
    )
    parser.add_argument(
        "--registry-root",
        help="Override registry root path (default: <git-common-dir>/codex-workitems).",
    )
    parser.add_argument(
        "--check",
        action="store_true",
        help="Check mode: do not write file; exit with code 1 if lock lines would change.",
    )
    return parser


def main() -> int:
    parser = build_parser()
    args = parser.parse_args()

    repo_root = Path(args.repo_root).resolve()
    doc_path = (repo_root / args.doc).resolve()
    if not doc_path.exists():
        raise SystemExit(f"doc file not found: {doc_path}")

    if args.registry_root:
        registry_root = Path(args.registry_root).resolve()
    else:
        registry_root = git_common_dir(repo_root) / "codex-workitems"

    items, locks = load_registry(registry_root)
    changed = sync_lock_lines(doc_path, items, locks, check=bool(args.check))
    print(
        json.dumps(
            {
                "doc": str(doc_path),
                "registry_root": str(registry_root),
                "changed_lock_lines": changed,
                "check": bool(args.check),
            },
            sort_keys=True,
        ),
    )
    if args.check and changed > 0:
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
