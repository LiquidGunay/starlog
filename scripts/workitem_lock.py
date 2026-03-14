#!/usr/bin/env python3
"""
Shared multi-worktree lock manager for Codex workitems.

Registry root:
  $(git rev-parse --git-common-dir)/codex-workitems/
"""

from __future__ import annotations

import argparse
import json
import os
import subprocess
import sys
from contextlib import contextmanager
from datetime import datetime, timedelta, timezone
from pathlib import Path

import fcntl


def now_utc() -> datetime:
    return datetime.now(tz=timezone.utc)


def iso_utc(value: datetime) -> str:
    return value.replace(microsecond=0).isoformat().replace("+00:00", "Z")


def parse_iso(value: str | None) -> datetime | None:
    if not value:
        return None
    normalized = value.replace("Z", "+00:00")
    return datetime.fromisoformat(normalized)


def git_common_dir(cwd: Path) -> Path:
    proc = subprocess.run(
        ["git", "rev-parse", "--git-common-dir"],
        cwd=str(cwd),
        check=True,
        capture_output=True,
        text=True,
    )
    raw = proc.stdout.strip()
    path = Path(raw)
    if not path.is_absolute():
        path = cwd / path
    return path.resolve()


class Registry:
    def __init__(self, root: Path) -> None:
        self.root = root
        self.workitems_file = root / "workitems.json"
        self.audit_file = root / "audit.jsonl"
        self.locks_dir = root / "locks"
        self.registry_lock = root / ".registry.lock"

    def ensure(self) -> None:
        self.root.mkdir(parents=True, exist_ok=True)
        self.locks_dir.mkdir(parents=True, exist_ok=True)
        if not self.workitems_file.exists():
            self._write_json_atomic(self.workitems_file, {"items": []})
        if not self.audit_file.exists():
            self.audit_file.touch()
        if not self.registry_lock.exists():
            self.registry_lock.touch()

    @contextmanager
    def locked(self):
        self.ensure()
        with self.registry_lock.open("a+", encoding="utf-8") as handle:
            fcntl.flock(handle.fileno(), fcntl.LOCK_EX)
            try:
                yield
            finally:
                fcntl.flock(handle.fileno(), fcntl.LOCK_UN)

    def load_workitems(self) -> dict:
        raw = self._read_json(self.workitems_file, default={"items": []})
        if isinstance(raw, list):
            return {"items": raw}
        if not isinstance(raw, dict):
            return {"items": []}
        items = raw.get("items")
        if not isinstance(items, list):
            raw["items"] = []
        return raw

    def save_workitems(self, payload: dict) -> None:
        payload = dict(payload)
        payload["updated_at"] = iso_utc(now_utc())
        self._write_json_atomic(self.workitems_file, payload)

    def read_lock(self, workitem_id: str) -> dict | None:
        return self._read_json(self.lock_path(workitem_id), default=None)

    def write_lock(self, workitem_id: str, payload: dict) -> None:
        self._write_json_atomic(self.lock_path(workitem_id), payload)

    def remove_lock(self, workitem_id: str) -> None:
        try:
            self.lock_path(workitem_id).unlink()
        except FileNotFoundError:
            pass

    def lock_path(self, workitem_id: str) -> Path:
        return self.locks_dir / f"{workitem_id}.lock"

    def append_audit(self, event_type: str, payload: dict) -> None:
        event = {
            "event": event_type,
            "at": iso_utc(now_utc()),
            **payload,
        }
        with self.audit_file.open("a", encoding="utf-8") as handle:
            handle.write(json.dumps(event, sort_keys=True) + "\n")

    @staticmethod
    def _read_json(path: Path, default):
        if not path.exists():
            return default
        try:
            return json.loads(path.read_text(encoding="utf-8"))
        except json.JSONDecodeError:
            return default

    @staticmethod
    def _write_json_atomic(path: Path, payload: dict) -> None:
        tmp_path = path.with_name(f"{path.name}.tmp")
        tmp_path.write_text(json.dumps(payload, indent=2, sort_keys=True) + "\n", encoding="utf-8")
        os.replace(tmp_path, path)


def find_or_create_workitem(workitems: dict, workitem_id: str, title: str | None) -> dict:
    items = workitems.setdefault("items", [])
    for item in items:
        if isinstance(item, dict) and item.get("id") == workitem_id:
            if title and not item.get("title"):
                item["title"] = title
            return item

    item = {"id": workitem_id}
    if title:
        item["title"] = title
    items.append(item)
    return item


def is_stale(lock_payload: dict | None, ttl_minutes: int) -> bool:
    if lock_payload is None:
        return False
    heartbeat = parse_iso(str(lock_payload.get("last_heartbeat_at") or lock_payload.get("claimed_at") or ""))
    if heartbeat is None:
        return True
    return (now_utc() - heartbeat) > timedelta(minutes=ttl_minutes)


def cmd_init(registry: Registry, _args: argparse.Namespace) -> int:
    with registry.locked():
        registry.ensure()
    print(str(registry.root))
    return 0


def cmd_status(registry: Registry, args: argparse.Namespace) -> int:
    with registry.locked():
        if args.workitem_id:
            workitems = registry.load_workitems()
            item = next((i for i in workitems.get("items", []) if i.get("id") == args.workitem_id), None)
            payload = {
                "registry_root": str(registry.root),
                "workitem": item,
                "lock": registry.read_lock(args.workitem_id),
            }
        else:
            locks = []
            for lock_file in sorted(registry.locks_dir.glob("*.lock")):
                payload = registry._read_json(lock_file, default={})
                if isinstance(payload, dict):
                    locks.append(payload)
            payload = {"registry_root": str(registry.root), "active_locks": locks}
    print(json.dumps(payload, indent=2, sort_keys=True))
    return 0


def cmd_claim(registry: Registry, args: argparse.Namespace) -> int:
    now = iso_utc(now_utc())
    ttl = max(1, int(args.stale_ttl_minutes))
    with registry.locked():
        workitems = registry.load_workitems()
        current_lock = registry.read_lock(args.workitem_id)

        if current_lock is not None and not is_stale(current_lock, ttl):
            owner = current_lock.get("agent_id") or "unknown"
            print(f"lock is currently held by '{owner}'", file=sys.stderr)
            return 1

        if current_lock is not None and is_stale(current_lock, ttl):
            if not args.force_steal:
                print(
                    "stale lock exists; re-run claim with --force-steal and --reason",
                    file=sys.stderr,
                )
                return 1
            if not args.reason:
                print("--reason is required when using --force-steal", file=sys.stderr)
                return 1
            registry.append_audit(
                "force_steal",
                {
                    "workitem_id": args.workitem_id,
                    "new_agent_id": args.agent_id,
                    "previous_lock": current_lock,
                    "reason": args.reason,
                },
            )

        lock_payload = {
            "workitem_id": args.workitem_id,
            "agent_id": args.agent_id,
            "worktree": args.worktree,
            "branch": args.branch,
            "claimed_at": now,
            "last_heartbeat_at": now,
        }
        registry.write_lock(args.workitem_id, lock_payload)

        item = find_or_create_workitem(workitems, args.workitem_id, args.title)
        item["status"] = "in_progress"
        item["owner"] = {
            "agent_id": args.agent_id,
            "worktree": args.worktree,
            "branch": args.branch,
        }
        item["claimed_at"] = now
        item["last_heartbeat_at"] = now
        if args.reason:
            item["claim_reason"] = args.reason
        registry.save_workitems(workitems)
        registry.append_audit(
            "claim",
            {
                "workitem_id": args.workitem_id,
                "agent_id": args.agent_id,
                "worktree": args.worktree,
                "branch": args.branch,
            },
        )
    print(json.dumps(lock_payload, indent=2, sort_keys=True))
    return 0


def cmd_heartbeat(registry: Registry, args: argparse.Namespace) -> int:
    now = iso_utc(now_utc())
    with registry.locked():
        lock_payload = registry.read_lock(args.workitem_id)
        if lock_payload is None:
            print("no active lock found", file=sys.stderr)
            return 1
        if str(lock_payload.get("agent_id") or "") != args.agent_id:
            print("lock owner mismatch", file=sys.stderr)
            return 1

        lock_payload["last_heartbeat_at"] = now
        registry.write_lock(args.workitem_id, lock_payload)

        workitems = registry.load_workitems()
        item = find_or_create_workitem(workitems, args.workitem_id, None)
        item["last_heartbeat_at"] = now
        item["status"] = "in_progress"
        registry.save_workitems(workitems)
        registry.append_audit(
            "heartbeat",
            {"workitem_id": args.workitem_id, "agent_id": args.agent_id},
        )
    print(json.dumps(lock_payload, indent=2, sort_keys=True))
    return 0


def cmd_release(registry: Registry, args: argparse.Namespace) -> int:
    now = iso_utc(now_utc())
    status_map = {
        "completed": "completed",
        "handoff": "handoff",
        "open": "open",
    }
    with registry.locked():
        lock_payload = registry.read_lock(args.workitem_id)
        if lock_payload is None:
            print("no active lock found", file=sys.stderr)
            return 1
        lock_owner = str(lock_payload.get("agent_id") or "")
        if lock_owner != args.agent_id and not args.force:
            print("lock owner mismatch; use --force to override", file=sys.stderr)
            return 1

        registry.remove_lock(args.workitem_id)

        workitems = registry.load_workitems()
        item = find_or_create_workitem(workitems, args.workitem_id, None)
        item["status"] = status_map[args.status]
        item["owner"] = None
        item["released_at"] = now
        if args.note:
            item["release_note"] = args.note
        if args.handoff_to:
            item["handoff_to"] = args.handoff_to
        registry.save_workitems(workitems)

        registry.append_audit(
            "release",
            {
                "workitem_id": args.workitem_id,
                "agent_id": args.agent_id,
                "status": args.status,
                "handoff_to": args.handoff_to,
                "note": args.note,
                "forced": bool(args.force and lock_owner != args.agent_id),
                "previous_owner": lock_owner,
            },
        )
    print(json.dumps({"workitem_id": args.workitem_id, "status": args.status, "released_at": now}, indent=2))
    return 0


def detect_branch(cwd: Path) -> str:
    proc = subprocess.run(
        ["git", "rev-parse", "--abbrev-ref", "HEAD"],
        cwd=str(cwd),
        check=True,
        capture_output=True,
        text=True,
    )
    branch = proc.stdout.strip()
    return branch if branch else "HEAD"


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="Manage shared Codex workitem locks in the common .git directory.")
    parser.add_argument("--repo-root", default=".", help="Path inside the repository (default: current directory).")

    subparsers = parser.add_subparsers(dest="command", required=True)

    subparsers.add_parser("init", help="Initialize the lock registry structure.")

    status_parser = subparsers.add_parser("status", help="Show active locks or a specific workitem lock.")
    status_parser.add_argument("--workitem-id")

    claim_parser = subparsers.add_parser("claim", help="Claim a workitem lock.")
    claim_parser.add_argument("--workitem-id", required=True)
    claim_parser.add_argument("--agent-id", required=True)
    claim_parser.add_argument("--worktree", required=False)
    claim_parser.add_argument("--branch", required=False)
    claim_parser.add_argument("--title")
    claim_parser.add_argument("--reason")
    claim_parser.add_argument("--stale-ttl-minutes", type=int, default=10)
    claim_parser.add_argument("--force-steal", action="store_true")

    heartbeat_parser = subparsers.add_parser("heartbeat", help="Refresh a lock heartbeat.")
    heartbeat_parser.add_argument("--workitem-id", required=True)
    heartbeat_parser.add_argument("--agent-id", required=True)

    release_parser = subparsers.add_parser("release", help="Release a claimed lock.")
    release_parser.add_argument("--workitem-id", required=True)
    release_parser.add_argument("--agent-id", required=True)
    release_parser.add_argument("--status", choices=["completed", "handoff", "open"], default="completed")
    release_parser.add_argument("--handoff-to")
    release_parser.add_argument("--note")
    release_parser.add_argument("--force", action="store_true")

    return parser


def main() -> int:
    parser = build_parser()
    args = parser.parse_args()

    repo_root = Path(args.repo_root).resolve()
    common_dir = git_common_dir(repo_root)
    registry = Registry(common_dir / "codex-workitems")

    if args.command == "claim":
        if not args.worktree:
            args.worktree = str(repo_root)
        if not args.branch:
            args.branch = detect_branch(repo_root)

    if args.command == "init":
        return cmd_init(registry, args)
    if args.command == "status":
        return cmd_status(registry, args)
    if args.command == "claim":
        return cmd_claim(registry, args)
    if args.command == "heartbeat":
        return cmd_heartbeat(registry, args)
    if args.command == "release":
        return cmd_release(registry, args)

    parser.error("unknown command")
    return 2


if __name__ == "__main__":
    raise SystemExit(main())
