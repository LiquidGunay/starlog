from __future__ import annotations

import json
import subprocess
import tempfile
import unittest
from pathlib import Path


REPO_ROOT = Path(__file__).resolve().parents[2]

import sys

sys.path.insert(0, str(REPO_ROOT / "scripts"))

from observatory_registry import refresh_registry
from workitem_lock import Registry, git_common_dir


def git(repo_root: Path, *args: str) -> str:
    return subprocess.run(
        ["git", *args],
        cwd=repo_root,
        check=True,
        capture_output=True,
        text=True,
    ).stdout.strip()


class ObservatoryRegistryTests(unittest.TestCase):
    def create_repo(self) -> Path:
        temp_dir = tempfile.TemporaryDirectory()
        self.addCleanup(temp_dir.cleanup)
        root = Path(temp_dir.name)
        origin = root / "origin.git"
        subprocess.run(["git", "init", "--bare", str(origin)], check=True, capture_output=True, text=True)
        repo = root / "repo"
        subprocess.run(["git", "clone", str(origin), str(repo)], check=True, capture_output=True, text=True)
        git(repo, "config", "user.name", "Codex")
        git(repo, "config", "user.email", "codex@example.com")
        (repo / "README.md").write_text("seed\n", encoding="utf-8")
        git(repo, "add", "README.md")
        git(repo, "commit", "-m", "seed")
        git(repo, "push", "-u", "origin", "master")
        return repo

    def seed_codex_branches(self, repo: Path) -> None:
        git(repo, "checkout", "-b", "codex/merged-snapshot")
        (repo / "merged.txt").write_text("merged\n", encoding="utf-8")
        git(repo, "add", "merged.txt")
        git(repo, "commit", "-m", "merged branch")
        git(repo, "push", "-u", "origin", "codex/merged-snapshot")
        git(repo, "checkout", "master")
        git(repo, "merge", "--no-ff", "codex/merged-snapshot", "-m", "merge snapshot")
        git(repo, "push", "origin", "master")

        git(repo, "checkout", "-b", "codex/unmerged-local")
        (repo / "local.txt").write_text("local\n", encoding="utf-8")
        git(repo, "add", "local.txt")
        git(repo, "commit", "-m", "local branch")
        git(repo, "checkout", "master")

    def test_refresh_registry_reports_candidates_without_cleanup(self) -> None:
        repo = self.create_repo()
        self.seed_codex_branches(repo)

        registry = Registry(git_common_dir(repo) / "codex-workitems")
        result = refresh_registry(repo, registry, execute_cleanup=False)

        self.assertEqual(result["deleted_local"], [])
        self.assertEqual(result["deleted_remote"], [])
        self.assertEqual(result["quarantined"], 1)

        branch_cleanup = json.loads(registry.branch_cleanup_file.read_text(encoding="utf-8"))
        self.assertIn("codex/merged-snapshot", branch_cleanup["cleanup_candidates"]["local"])
        self.assertIn("codex/merged-snapshot", branch_cleanup["cleanup_candidates"]["remote"])
        quarantined = {entry["name"]: entry for entry in branch_cleanup["quarantined"]}
        self.assertIn("codex/unmerged-local", quarantined)
        self.assertFalse(any(entry["name"] == "codex/merged-snapshot" for entry in branch_cleanup["quarantined"]))

        review_backlog = json.loads(registry.review_backlog_file.read_text(encoding="utf-8"))
        self.assertEqual({item["id"] for item in review_backlog["items"]}, {"WI-703", "WI-704", "WI-705", "WI-706", "WI-707"})

        design_queue = json.loads(registry.design_queue_file.read_text(encoding="utf-8"))
        component_ids = {item["id"] for item in design_queue["components"]}
        self.assertIn("conversation.rows", component_ids)
        self.assertIn("mobile.tab_bar", component_ids)

        workitems = json.loads(registry.workitems_file.read_text(encoding="utf-8"))
        workitem_ids = {item["id"] for item in workitems["items"]}
        self.assertIn("WI-700", workitem_ids)
        self.assertIn("WI-722", workitem_ids)

        self.assertIn("codex/merged-snapshot", git(repo, "branch", "--list", "codex/merged-snapshot"))
        self.assertIn("origin/codex/merged-snapshot", git(repo, "branch", "-r", "--list", "origin/codex/merged-snapshot"))

    def test_refresh_registry_deletes_only_merged_branches_when_requested(self) -> None:
        repo = self.create_repo()
        self.seed_codex_branches(repo)

        registry = Registry(git_common_dir(repo) / "codex-workitems")
        result = refresh_registry(repo, registry, execute_cleanup=True)

        self.assertEqual(result["deleted_local"], ["codex/merged-snapshot"])
        self.assertEqual(result["deleted_remote"], ["codex/merged-snapshot"])

        self.assertEqual(git(repo, "branch", "--list", "codex/merged-snapshot"), "")
        self.assertEqual(git(repo, "branch", "-r", "--list", "origin/codex/merged-snapshot"), "")
        self.assertIn("codex/unmerged-local", git(repo, "branch", "--list", "codex/unmerged-local"))


if __name__ == "__main__":
    unittest.main()
