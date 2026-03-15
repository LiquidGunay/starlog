from __future__ import annotations

import subprocess
import tempfile
import unittest
from pathlib import Path


REPO_ROOT = Path(__file__).resolve().parents[2]
SCRIPT = REPO_ROOT / "scripts" / "sync_workitem_mirror.py"


def write_json(path: Path, raw: str) -> None:
    path.write_text(raw, encoding="utf-8")


class SyncWorkitemMirrorTests(unittest.TestCase):
    def test_sync_updates_lock_line_from_registry(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            root = Path(temp_dir)
            doc_path = root / "docs" / "CODEX_PARALLEL_WORK_ITEMS.md"
            doc_path.parent.mkdir(parents=True, exist_ok=True)
            doc_path.write_text(
                "# Demo\n\n- Workitem ID: `WI-900`\n- Lock: `UNCLAIMED | Workitem: WI-900 | Owner: N/A | Claimed: N/A | Last heartbeat: N/A`\n",
                encoding="utf-8",
            )

            registry_root = root / "registry"
            locks_dir = registry_root / "locks"
            locks_dir.mkdir(parents=True, exist_ok=True)
            write_json(
                registry_root / "workitems.json",
                """{
  "items": [
    {
      "id": "WI-900",
      "status": "in_progress",
      "claimed_at": "2026-03-14T19:00:00Z",
      "last_heartbeat_at": "2026-03-14T19:01:00Z",
      "owner": {"agent_id": "Agent-Q"}
    }
  ]
}
""",
            )
            write_json(
                locks_dir / "WI-900.lock",
                """{
  "workitem_id": "WI-900",
  "agent_id": "Agent-Q",
  "claimed_at": "2026-03-14T19:00:00Z",
  "last_heartbeat_at": "2026-03-14T19:01:00Z"
}
""",
            )

            subprocess.run(
                [
                    "python3",
                    str(SCRIPT),
                    "--repo-root",
                    str(root),
                    "--doc",
                    "docs/CODEX_PARALLEL_WORK_ITEMS.md",
                    "--registry-root",
                    str(registry_root),
                ],
                check=True,
                capture_output=True,
                text=True,
            )

            updated = doc_path.read_text(encoding="utf-8")
            self.assertIn(
                "Lock: `IN_PROGRESS | Workitem: WI-900 | Owner: Agent Agent-Q | Claimed: 2026-03-14T19:00:00Z | Last heartbeat: 2026-03-14T19:01:00Z`",
                updated,
            )

    def test_check_mode_fails_when_drift_exists(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            root = Path(temp_dir)
            doc_path = root / "docs" / "CODEX_PARALLEL_WORK_ITEMS.md"
            doc_path.parent.mkdir(parents=True, exist_ok=True)
            original = (
                "# Demo\n\n- Workitem ID: `WI-901`\n- Lock: `UNCLAIMED | Workitem: WI-901 | Owner: N/A | Claimed: N/A | Last heartbeat: N/A`\n"
            )
            doc_path.write_text(original, encoding="utf-8")

            registry_root = root / "registry"
            (registry_root / "locks").mkdir(parents=True, exist_ok=True)
            write_json(
                registry_root / "workitems.json",
                """{
  "items": [
    {
      "id": "WI-901",
      "status": "completed",
      "claimed_at": "2026-03-14T19:10:00Z",
      "last_heartbeat_at": "2026-03-14T19:11:00Z"
    }
  ]
}
""",
            )

            proc = subprocess.run(
                [
                    "python3",
                    str(SCRIPT),
                    "--repo-root",
                    str(root),
                    "--doc",
                    "docs/CODEX_PARALLEL_WORK_ITEMS.md",
                    "--registry-root",
                    str(registry_root),
                    "--check",
                ],
                check=False,
                capture_output=True,
                text=True,
            )

            self.assertEqual(proc.returncode, 1)
            self.assertEqual(doc_path.read_text(encoding="utf-8"), original)

    def test_check_mode_passes_when_in_sync(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            root = Path(temp_dir)
            doc_path = root / "docs" / "CODEX_PARALLEL_WORK_ITEMS.md"
            doc_path.parent.mkdir(parents=True, exist_ok=True)
            expected = (
                "# Demo\n\n- Workitem ID: `WI-902`\n- Lock: `COMPLETED | Workitem: WI-902 | Owner: N/A | Claimed: 2026-03-14T19:20:00Z | Last heartbeat: 2026-03-14T19:21:00Z`\n"
            )
            doc_path.write_text(expected, encoding="utf-8")

            registry_root = root / "registry"
            (registry_root / "locks").mkdir(parents=True, exist_ok=True)
            write_json(
                registry_root / "workitems.json",
                """{
  "items": [
    {
      "id": "WI-902",
      "status": "completed",
      "claimed_at": "2026-03-14T19:20:00Z",
      "last_heartbeat_at": "2026-03-14T19:21:00Z"
    }
  ]
}
""",
            )

            proc = subprocess.run(
                [
                    "python3",
                    str(SCRIPT),
                    "--repo-root",
                    str(root),
                    "--doc",
                    "docs/CODEX_PARALLEL_WORK_ITEMS.md",
                    "--registry-root",
                    str(registry_root),
                    "--check",
                ],
                check=False,
                capture_output=True,
                text=True,
            )

            self.assertEqual(proc.returncode, 0)
            self.assertEqual(doc_path.read_text(encoding="utf-8"), expected)


if __name__ == "__main__":
    unittest.main()
