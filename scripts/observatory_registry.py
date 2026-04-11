#!/usr/bin/env python3
from __future__ import annotations

import argparse
import json
import subprocess
from collections import defaultdict
from pathlib import Path
from typing import Any

from workitem_lock import Registry, git_common_dir, iso_utc, now_utc


APRIL_WORKITEMS: list[dict[str, Any]] = [
    {"id": "WI-700", "title": "Branch and PR cleanup audit", "track": "cleanup", "status": "in_progress"},
    {"id": "WI-701", "title": "Shared metadata split", "track": "cleanup", "status": "open"},
    {"id": "WI-702", "title": "Docs and policy realignment", "track": "cleanup", "status": "open"},
    {"id": "WI-703", "title": "Release handoff stale-asset hardening", "track": "backend", "status": "open"},
    {"id": "WI-704", "title": "Cross-surface proof dry-run purity", "track": "backend", "status": "open"},
    {"id": "WI-705", "title": "Android production packaging entrypoint", "track": "backend", "status": "open"},
    {"id": "WI-706", "title": "ML interview deck bootstrap hardening", "track": "backend", "status": "open"},
    {"id": "WI-707", "title": "Card deck API hardening", "track": "backend", "status": "open"},
    {"id": "WI-710", "title": "Assistant-first design system foundation", "track": "frontend", "status": "open"},
    {"id": "WI-711", "title": "Dynamic conversation component kit", "track": "frontend", "status": "open"},
    {"id": "WI-712", "title": "Desktop Assistant cutover", "track": "frontend", "status": "open"},
    {"id": "WI-713", "title": "Smooth chat interaction pass", "track": "frontend", "status": "open"},
    {"id": "WI-714", "title": "Support-view redesign on stable routes", "track": "frontend", "status": "open"},
    {"id": "WI-720", "title": "Mobile shell refactor", "track": "mobile", "status": "open"},
    {"id": "WI-721", "title": "Mobile Assistant chat", "track": "mobile", "status": "open"},
    {"id": "WI-722", "title": "Mobile support tabs", "track": "mobile", "status": "open"},
]

REVIEW_BACKLOG_ITEMS: list[dict[str, Any]] = [
    {
        "id": "WI-703",
        "title": "Release handoff stale-asset hardening",
        "pr_number": 98,
        "related_branch": "codex/release-handoff-automation",
        "status": "open",
        "owner_track": "backend",
        "tasks": [
            "Pass --prune-old-assets through scripts/refresh_preview_feedback_bundle.sh when requested.",
            "Allow prune mode in scripts/release_handoff.py to recover from duplicate staged assets instead of erroring before cleanup.",
        ],
    },
    {
        "id": "WI-704",
        "title": "Cross-surface proof dry-run purity",
        "pr_number": 99,
        "related_branch": "codex/cross-surface-proof-refresh",
        "status": "open",
        "owner_track": "backend",
        "tasks": [
            "Do not create bundle directories or files when dry-run mode is enabled.",
        ],
    },
    {
        "id": "WI-705",
        "title": "Android production packaging entrypoint",
        "pr_number": 101,
        "related_branch": "codex/android-production-release-path",
        "status": "open",
        "owner_track": "backend",
        "tasks": [
            "Make scripts/android_prepare_production_release.sh executable so the documented entrypoint works without permission failures.",
        ],
    },
    {
        "id": "WI-706",
        "title": "ML interview deck bootstrap hardening",
        "pr_number": 103,
        "related_branch": None,
        "status": "open",
        "owner_track": "backend",
        "tasks": [
            "Fail loudly when chapter fetches fail instead of silently skipping them.",
            "Point SRS import docs at the committed bootstrap loader path instead of worktree-specific paths.",
        ],
    },
    {
        "id": "WI-707",
        "title": "Card deck API hardening",
        "pr_number": 106,
        "related_branch": None,
        "status": "open",
        "owner_track": "backend",
        "tasks": [
            "Handle default deck creation races safely during first-load traffic.",
            "Reject due_at: null cleanly instead of surfacing a database integrity error.",
        ],
        "deferred_ui_items": [
            "Deck editor due_at timezone round-trip bug is explicitly deferred because that screen is being replaced by the observatory redesign.",
        ],
    },
]

DESIGN_QUEUE: dict[str, Any] = {
    "visual_thesis": "Build Starlog as a calm Assistant-first workspace: glassy, low-chroma, mono-accented, with chat as the primary stage and Library, Planner, and Review as support views.",
    "design_root": "/home/ubuntu/starlog_extras/starlog_unified_design_april_2026",
    "source_files": [
        "starlog_design_document_design.md",
        "stellar_observatory/DESIGN.md",
        "stellar_observatory/main_room_chat/index.html",
        "stellar_observatory/dynamic_cards_desktop/index.html",
        "stellar_observatory/knowledge_base/index.html",
        "stellar_observatory/srs_review/index.html",
        "stellar_observatory/home_chat_mobile/index.html",
        "stellar_observatory/notes_capture_mobile/index.html",
        "stellar_observatory/calendar_alarms_mobile/index.html",
        "stellar_observatory/review_analytics_mobile/index.html",
    ],
    "tokens": [
        "palette",
        "typography",
        "radii",
        "glass_surfaces",
        "mono_metadata",
        "motion_presets",
    ],
    "components": [
        {
            "id": "web.side_rail",
            "title": "Desktop side rail",
            "platforms": ["web"],
            "sources": ["main_room_chat", "knowledge_base", "srs_review"],
            "reuse": ["top-navigation route wiring"],
            "new_work": ["plain product labeling", "glass shell", "active route state"],
        },
        {
            "id": "web.status_bar",
            "title": "Top status and search bar",
            "platforms": ["web"],
            "sources": ["main_room_chat", "dynamic_cards_desktop"],
            "reuse": ["runtime badge", "online/offline state"],
            "new_work": ["search affordance", "status chips", "mono metadata styling"],
        },
        {
            "id": "conversation.rows",
            "title": "Conversation row kit",
            "platforms": ["web", "mobile"],
            "sources": ["main_room_chat", "home_chat_mobile"],
            "reuse": ["conversation thread API", "tool traces", "session reset"],
            "new_work": ["assistant/user/system/tool rows", "pending bubble", "voice/listening states"],
        },
        {
            "id": "conversation.cards",
            "title": "Dynamic card registry",
            "platforms": ["web", "mobile"],
            "sources": ["dynamic_cards_desktop", "dynamic_cards_mobile"],
            "reuse": ["server card payloads", "artifact/review/planner APIs"],
            "new_work": ["kind-keyed rendering", "expand/collapse panels", "inline actions"],
        },
        {
            "id": "knowledge.workspace",
            "title": "Library workspace",
            "platforms": ["web"],
            "sources": ["knowledge_base"],
            "reuse": ["artifacts", "notes", "search", "graph data"],
            "new_work": ["three-pane layout", "editor typography", "backlink/graph panes"],
        },
        {
            "id": "review.workspace",
            "title": "Review workspace",
            "platforms": ["web", "mobile"],
            "sources": ["srs_review", "review_analytics_mobile"],
            "reuse": ["cards API", "reviews API", "analytics counts"],
            "new_work": ["focus session chrome", "deck browser refresh", "analytics panels"],
        },
        {
            "id": "agenda.workspace",
            "title": "Planner workspace",
            "platforms": ["web", "mobile"],
            "sources": ["calendar_alarms_mobile"],
            "reuse": ["planner", "calendar sync", "briefings", "alarms"],
            "new_work": ["briefing playback controls", "time-block framing", "planner prominence"],
        },
        {
            "id": "mobile.tab_bar",
            "title": "Mobile four-tab shell",
            "platforms": ["mobile"],
            "sources": ["home_chat_mobile", "notes_capture_mobile", "calendar_alarms_mobile", "review_analytics_mobile"],
            "reuse": ["existing capture", "alarms", "review flows"],
            "new_work": ["Assistant/Library/Planner/Review IA", "tab visuals", "navigation split"],
        },
    ],
}


def run_git(repo_root: Path, args: list[str]) -> str:
    return subprocess.run(
        ["git", *args],
        cwd=repo_root,
        check=True,
        capture_output=True,
        text=True,
    ).stdout.strip()


def write_json(path: Path, payload: dict[str, Any]) -> None:
    path.write_text(json.dumps(payload, indent=2, sort_keys=True) + "\n", encoding="utf-8")


def worktree_map(repo_root: Path) -> dict[str, str]:
    output = run_git(repo_root, ["worktree", "list", "--porcelain"])
    current_path = ""
    current_branch = ""
    mapping: dict[str, str] = {}
    for raw_line in output.splitlines():
        if raw_line.startswith("worktree "):
            current_path = raw_line.split(" ", 1)[1]
            current_branch = ""
        elif raw_line.startswith("branch "):
            ref = raw_line.split(" ", 1)[1]
            current_branch = ref.removeprefix("refs/heads/")
            mapping[current_branch] = current_path
    return mapping


def branch_rows(repo_root: Path, ref_prefix: str) -> list[dict[str, Any]]:
    output = run_git(
        repo_root,
        [
            "for-each-ref",
            "--format=%(refname:short)|%(objectname:short)|%(committerdate:iso8601)|%(upstream:short)|%(subject)",
            ref_prefix,
        ],
    )
    rows: list[dict[str, Any]] = []
    for line in output.splitlines():
        if not line.strip():
            continue
        name, sha, committed_at, upstream, subject = (line.split("|", 4) + ["", "", "", "", ""])[:5]
        rows.append(
            {
                "name": name,
                "sha": sha,
                "committed_at": committed_at,
                "upstream": upstream or None,
                "subject": subject or None,
            }
        )
    return rows


def dirty_worktree_state(worktree_path: str) -> bool:
    path = Path(worktree_path)
    if not path.exists():
        return False
    output = subprocess.run(
        ["git", "status", "--short"],
        cwd=path,
        check=True,
        capture_output=True,
        text=True,
    ).stdout
    return bool(output.strip())


def merged_branch_names(repo_root: Path, *, remote: bool) -> set[str]:
    if remote:
        output = run_git(
            repo_root,
            [
                "for-each-ref",
                "--merged=origin/master",
                "--format=%(refname:short)",
                "refs/remotes/origin/codex",
            ],
        )
    else:
        output = run_git(
            repo_root,
            [
                "for-each-ref",
                "--merged=origin/master",
                "--format=%(refname:short)",
                "refs/heads/codex",
            ],
        )
    return {line.strip() for line in output.splitlines() if line.strip()}


def delete_remote_branches(repo_root: Path, branches: list[str]) -> list[str]:
    deleted: list[str] = []
    for start in range(0, len(branches), 20):
        batch = branches[start : start + 20]
        if not batch:
            continue
        run_git(repo_root, ["push", "origin", "--delete", *batch])
        deleted.extend(batch)
    return deleted


def delete_local_branches(repo_root: Path, branches: list[str]) -> list[str]:
    deleted: list[str] = []
    for branch in branches:
        run_git(repo_root, ["branch", "-d", branch])
        deleted.append(branch)
    return deleted


def refresh_registry(repo_root: Path, registry: Registry, execute_cleanup: bool) -> dict[str, Any]:
    worktrees = worktree_map(repo_root)
    local_rows = [row for row in branch_rows(repo_root, "refs/heads/codex") if row["name"] != "codex/observatory-reset"]
    remote_rows = branch_rows(repo_root, "refs/remotes/origin/codex")
    merged_local = merged_branch_names(repo_root, remote=False)
    merged_remote = merged_branch_names(repo_root, remote=True)

    cleanup_candidates_local: list[str] = []
    cleanup_candidates_remote: list[str] = []
    quarantined: list[dict[str, Any]] = []

    remote_by_name = {row["name"]: row for row in remote_rows}
    for row in local_rows:
        attached_worktree = worktrees.get(row["name"])
        dirty = dirty_worktree_state(attached_worktree) if attached_worktree else False
        if row["name"] in merged_local and not attached_worktree:
            cleanup_candidates_local.append(row["name"])
            continue
        quarantined.append(
            {
                **row,
                "reason": "attached_worktree_dirty" if dirty else "unmerged_or_attached",
                "attached_worktree": attached_worktree,
                "dirty": dirty,
            }
        )

    for name in sorted(merged_remote):
        if name == "origin/master":
            continue
        short_name = name.removeprefix("origin/")
        if short_name == "codex/observatory-reset":
            continue
        cleanup_candidates_remote.append(short_name)

    deleted_remote: list[str] = []
    deleted_local: list[str] = []
    if execute_cleanup:
        deleted_remote = delete_remote_branches(repo_root, cleanup_candidates_remote)
        deleted_local = delete_local_branches(repo_root, cleanup_candidates_local)

    now = iso_utc(now_utc())
    branch_cleanup = {
        "updated_at": now,
        "base_ref": "origin/master",
        "execute_cleanup": execute_cleanup,
        "recent_pr_snapshot": [
            {"pr_number": 98, "branch": "codex/release-handoff-automation"},
            {"pr_number": 99, "branch": "codex/cross-surface-proof-refresh"},
            {"pr_number": 101, "branch": "codex/android-production-release-path"},
            {"pr_number": 103, "branch": None},
            {"pr_number": 106, "branch": None},
        ],
        "local_snapshot": local_rows,
        "remote_snapshot": remote_rows,
        "cleanup_candidates": {
            "local": cleanup_candidates_local,
            "remote": cleanup_candidates_remote,
        },
        "deleted": {
            "local": deleted_local,
            "remote": deleted_remote,
        },
        "quarantined": quarantined,
        "notes": [
            "Merged codex branches are safe to delete only after review backlog capture.",
            "Dirty or attached local branches are quarantined for manual triage instead of being deleted blindly.",
        ],
    }

    review_backlog = {
        "updated_at": now,
        "items": REVIEW_BACKLOG_ITEMS,
    }
    design_queue = {
        "updated_at": now,
        **DESIGN_QUEUE,
    }

    with registry.locked():
        workitems = registry.load_workitems()
        indexed = {item.get("id"): item for item in workitems.get("items", []) if isinstance(item, dict) and item.get("id")}
        for definition in APRIL_WORKITEMS:
            item = indexed.get(definition["id"])
            if item is None:
                item = dict(definition)
                workitems.setdefault("items", []).append(item)
                indexed[definition["id"]] = item
                continue
            item.setdefault("title", definition["title"])
            item["track"] = definition["track"]
            if item.get("status") not in {"in_progress", "handoff", "completed"}:
                item["status"] = definition["status"]
        registry.save_workitems(workitems)
        write_json(registry.review_backlog_file, review_backlog)
        write_json(registry.branch_cleanup_file, branch_cleanup)
        write_json(registry.design_queue_file, design_queue)
        registry.append_audit(
            "observatory_refresh",
            {
                "execute_cleanup": execute_cleanup,
                "deleted_local": deleted_local,
                "deleted_remote": deleted_remote,
            },
        )

    return {
        "registry_root": str(registry.root),
        "deleted_local": deleted_local,
        "deleted_remote": deleted_remote,
        "quarantined": len(quarantined),
    }


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="Refresh Starlog's shared observatory registry state.")
    parser.add_argument(
        "command",
        choices=["refresh"],
        help="Refresh shared registry files and optionally clean merged codex branches.",
    )
    parser.add_argument("--repo-root", default=".", help="Path inside the repository.")
    parser.add_argument(
        "--execute-cleanup",
        action="store_true",
        help="Delete merged local/remote codex branches after snapshotting them.",
    )
    return parser


def main() -> int:
    args = build_parser().parse_args()
    repo_root = Path(args.repo_root).resolve()
    registry = Registry(git_common_dir(repo_root) / "codex-workitems")
    if args.command == "refresh":
        result = refresh_registry(repo_root, registry, execute_cleanup=bool(args.execute_cleanup))
        print(json.dumps(result, indent=2, sort_keys=True))
        return 0
    raise SystemExit(f"Unsupported command: {args.command}")


if __name__ == "__main__":
    raise SystemExit(main())
