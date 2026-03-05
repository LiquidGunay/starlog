import json
from pathlib import Path
from sqlite3 import Connection

from app.core.config import get_settings
from app.core.time import utc_now
from app.services import export_service


def collect_metrics(conn: Connection) -> dict:
    queue_depth = conn.execute("SELECT COUNT(*) FROM sync_events").fetchone()[0]
    cards_due = conn.execute("SELECT COUNT(*) FROM cards WHERE due_at <= ?", (utc_now().isoformat(),)).fetchone()[0]
    tasks_todo = conn.execute("SELECT COUNT(*) FROM tasks WHERE status = 'todo'").fetchone()[0]
    alarms = conn.execute("SELECT COUNT(*) FROM alarm_plans").fetchone()[0]

    return {
        "queue_depth_sync_events": int(queue_depth),
        "cards_due": int(cards_due),
        "tasks_todo": int(tasks_todo),
        "alarms_scheduled": int(alarms),
        "timestamp": utc_now().isoformat(),
    }


def write_backup_snapshot(conn: Connection) -> dict:
    settings = get_settings()
    export_payload = export_service.build_export(conn)

    backup_dir = Path(settings.db_path).parent / "backups"
    backup_dir.mkdir(parents=True, exist_ok=True)

    exported_at = str(export_payload["exported_at"])
    safe_stamp = exported_at.replace(":", "-")
    backup_path = backup_dir / f"starlog-backup-{safe_stamp}.json"
    raw = json.dumps(export_payload, sort_keys=True, indent=2)
    backup_path.write_text(raw, encoding="utf-8")

    return {
        "backup_path": str(backup_path),
        "exported_at": exported_at,
        "bytes_written": len(raw.encode("utf-8")),
    }
