import json
from sqlite3 import Connection

from app.core.time import utc_now
from app.services.common import execute_fetchall, execute_fetchone, new_id


class RevisionConflictError(Exception):
    def __init__(self, conflict: dict) -> None:
        super().__init__("Revision conflict detected")
        self.conflict = conflict


def _format_conflict(row: dict) -> dict:
    return {
        "id": row["id"],
        "entity_type": row["entity_type"],
        "entity_id": row["entity_id"],
        "operation": row["operation"],
        "base_revision": int(row["base_revision"]),
        "current_revision": int(row["current_revision"]),
        "local_payload": row.get("local_payload_json") or {},
        "server_payload": row.get("server_payload_json") or {},
        "status": row.get("status") or "open",
        "created_at": row["created_at"],
        "resolved_at": row.get("resolved_at"),
        "resolution_strategy": row.get("resolution_strategy"),
        "resolution_payload": row.get("resolution_payload_json"),
    }


def create_conflict(
    conn: Connection,
    *,
    entity_type: str,
    entity_id: str,
    operation: str,
    base_revision: int,
    current_revision: int,
    local_payload: dict,
    server_payload: dict,
) -> dict:
    conflict_id = new_id("conf")
    now = utc_now().isoformat()
    conn.execute(
        """
        INSERT INTO entity_conflicts (
          id, entity_type, entity_id, operation, base_revision, current_revision,
          local_payload_json, server_payload_json, status, created_at, resolved_at,
          resolution_strategy, resolution_payload_json
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        """,
        (
            conflict_id,
            entity_type,
            entity_id,
            operation,
            int(base_revision),
            int(current_revision),
            json.dumps(local_payload, sort_keys=True),
            json.dumps(server_payload, sort_keys=True),
            "open",
            now,
            None,
            None,
            None,
        ),
    )
    conn.commit()
    conflict = get_conflict(conn, conflict_id)
    if conflict is None:
        raise RuntimeError("Failed to persist conflict record")
    return conflict


def get_conflict(conn: Connection, conflict_id: str) -> dict | None:
    row = execute_fetchone(conn, "SELECT * FROM entity_conflicts WHERE id = ?", (conflict_id,))
    return _format_conflict(row) if row else None


def list_conflicts(
    conn: Connection,
    *,
    status: str | None = None,
    entity_type: str | None = None,
    limit: int = 100,
) -> list[dict]:
    clauses: list[str] = []
    params: list[object] = []
    if status:
        clauses.append("status = ?")
        params.append(status)
    if entity_type:
        clauses.append("entity_type = ?")
        params.append(entity_type)
    where_sql = f"WHERE {' AND '.join(clauses)}" if clauses else ""
    rows = execute_fetchall(
        conn,
        f"SELECT * FROM entity_conflicts {where_sql} ORDER BY created_at DESC LIMIT ?",
        tuple([*params, int(limit)]),
    )
    return [_format_conflict(row) for row in rows]


def resolve_conflict(
    conn: Connection,
    conflict_id: str,
    *,
    strategy: str,
    merged_payload: dict | None = None,
) -> dict | None:
    conflict = get_conflict(conn, conflict_id)
    if conflict is None:
        return None
    if conflict["status"] == "resolved":
        return conflict

    now = utc_now().isoformat()
    conn.execute(
        """
        UPDATE entity_conflicts
        SET status = ?, resolved_at = ?, resolution_strategy = ?, resolution_payload_json = ?
        WHERE id = ?
        """,
        (
            "resolved",
            now,
            strategy,
            json.dumps(merged_payload, sort_keys=True) if merged_payload is not None else None,
            conflict_id,
        ),
    )
    conn.commit()
    return get_conflict(conn, conflict_id)

