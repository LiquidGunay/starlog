from __future__ import annotations

import argparse
import contextlib
import io
import json
import tempfile
import unittest
from pathlib import Path


REPO_ROOT = Path(__file__).resolve().parents[2]

import sys

sys.path.insert(0, str(REPO_ROOT / "scripts"))

from workitem_lock import Registry, cmd_claim, cmd_release


WORKITEM_ID = "WI-LOCK-TEST"


class WorkitemLockTests(unittest.TestCase):
    def create_registry(self) -> Registry:
        temp_dir = tempfile.TemporaryDirectory()
        self.addCleanup(temp_dir.cleanup)
        registry = Registry(Path(temp_dir.name) / "codex-workitems")
        registry.ensure()
        return registry

    def seed_lock(self, registry: Registry, *, agent_id: str = "worker-a") -> dict:
        payload = {
            "workitem_id": WORKITEM_ID,
            "agent_id": agent_id,
            "worktree": "/tmp/worker-a",
            "branch": "codex/worker-a",
            "claimed_at": "2000-01-01T00:00:00Z",
            "last_heartbeat_at": "2000-01-01T00:00:00Z",
        }
        registry.write_lock(WORKITEM_ID, payload)
        return payload

    def claim_args(
        self,
        *,
        agent_id: str = "worker-b",
        force_steal: bool = False,
        reason: str | None = None,
    ) -> argparse.Namespace:
        return argparse.Namespace(
            workitem_id=WORKITEM_ID,
            agent_id=agent_id,
            worktree=f"/tmp/{agent_id}",
            branch=f"codex/{agent_id}",
            title="Lock policy test",
            reason=reason,
            force_steal=force_steal,
            stale_ttl_minutes=None,
        )

    def release_args(
        self,
        *,
        agent_id: str = "supervisor",
        force: bool = False,
        reason: str | None = None,
    ) -> argparse.Namespace:
        return argparse.Namespace(
            workitem_id=WORKITEM_ID,
            agent_id=agent_id,
            status="completed",
            handoff_to=None,
            note=None,
            reason=reason,
            force=force,
        )

    def invoke(self, func, registry: Registry, args: argparse.Namespace) -> int:
        with contextlib.redirect_stdout(io.StringIO()), contextlib.redirect_stderr(io.StringIO()):
            return func(registry, args)

    def audit_events(self, registry: Registry) -> list[dict]:
        return [
            json.loads(line)
            for line in registry.audit_file.read_text(encoding="utf-8").splitlines()
            if line.strip()
        ]

    def test_claim_does_not_take_old_lock_without_force(self) -> None:
        registry = self.create_registry()
        previous = self.seed_lock(registry)

        result = self.invoke(cmd_claim, registry, self.claim_args())

        self.assertEqual(result, 1)
        self.assertEqual(registry.read_lock(WORKITEM_ID), previous)
        self.assertEqual(self.audit_events(registry), [])

    def test_force_steal_requires_reason(self) -> None:
        registry = self.create_registry()
        previous = self.seed_lock(registry)

        result = self.invoke(cmd_claim, registry, self.claim_args(force_steal=True))

        self.assertEqual(result, 1)
        self.assertEqual(registry.read_lock(WORKITEM_ID), previous)
        self.assertEqual(self.audit_events(registry), [])

    def test_force_steal_replaces_lock_and_audits_reason(self) -> None:
        registry = self.create_registry()
        self.seed_lock(registry)

        result = self.invoke(
            cmd_claim,
            registry,
            self.claim_args(force_steal=True, reason="supervisor confirmed inactive worker"),
        )

        self.assertEqual(result, 0)
        self.assertEqual(registry.read_lock(WORKITEM_ID)["agent_id"], "worker-b")
        events = self.audit_events(registry)
        self.assertEqual([event["event"] for event in events], ["force_steal", "claim"])
        self.assertEqual(events[0]["reason"], "supervisor confirmed inactive worker")
        self.assertEqual(events[0]["previous_lock"]["agent_id"], "worker-a")

    def test_forced_release_requires_reason_and_audits_override(self) -> None:
        registry = self.create_registry()
        previous = self.seed_lock(registry)

        missing_reason = self.invoke(cmd_release, registry, self.release_args(force=True))

        self.assertEqual(missing_reason, 1)
        self.assertEqual(registry.read_lock(WORKITEM_ID), previous)

        result = self.invoke(
            cmd_release,
            registry,
            self.release_args(force=True, reason="supervisor closed abandoned worker"),
        )

        self.assertEqual(result, 0)
        self.assertIsNone(registry.read_lock(WORKITEM_ID))
        events = self.audit_events(registry)
        self.assertEqual([event["event"] for event in events], ["force_release", "release"])
        self.assertEqual(events[0]["reason"], "supervisor closed abandoned worker")
        self.assertTrue(events[1]["forced"])
        self.assertEqual(events[1]["previous_owner"], "worker-a")


if __name__ == "__main__":
    unittest.main()
