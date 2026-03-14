import json
import secrets
from datetime import timedelta
from sqlite3 import Connection

from app.core.security import create_session_token, hash_token
from app.core.time import utc_now
from app.services import events_service
from app.services.common import execute_fetchall, execute_fetchone, new_id

ACCESS_TOKEN_HOURS = 8
REFRESH_TOKEN_DAYS = 30
PAIRING_DEFAULT_MINUTES = 15
WORKER_ONLINE_TTL_MINUTES = 10


def _parse_capabilities(raw: object) -> list[str]:
    if isinstance(raw, list):
        return [str(item) for item in raw if isinstance(item, str) and item.strip()]
    return []


def _session_payload(row: dict) -> dict:
    now = utc_now()
    last_seen_at = row.get("last_seen_at")
    online = False
    if isinstance(last_seen_at, str) and last_seen_at:
        try:
            online = (now - _parse_iso(last_seen_at)) <= timedelta(minutes=WORKER_ONLINE_TTL_MINUTES)
        except ValueError:
            online = False
    if row.get("revoked_at"):
        online = False
    if _parse_iso(row["access_expires_at"]) <= now:
        online = False

    return {
        "worker_id": row["worker_id"],
        "worker_label": row["worker_label"],
        "worker_class": row["worker_class"],
        "capabilities": _parse_capabilities(row.get("capabilities_json")),
        "last_seen_at": row.get("last_seen_at"),
        "access_expires_at": row["access_expires_at"],
        "refresh_expires_at": row["refresh_expires_at"],
        "revoked_at": row.get("revoked_at"),
        "revocation_reason": row.get("revocation_reason"),
        "online": online,
    }


def _parse_iso(value: str):
    from datetime import datetime

    return datetime.fromisoformat(value)


def create_pairing_token(conn: Connection, *, created_by_user_id: str, expires_in_minutes: int = PAIRING_DEFAULT_MINUTES) -> dict:
    now = utc_now()
    expires_at = now + timedelta(minutes=max(1, min(expires_in_minutes, 60)))
    pairing_token = secrets.token_urlsafe(32)
    pairing_token_hash = hash_token(pairing_token)
    conn.execute(
        """
        INSERT INTO worker_pairings (id, pairing_token_hash, created_by_user_id, expires_at, used_at, worker_id, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?)
        """,
        (
            new_id("wpr"),
            pairing_token_hash,
            created_by_user_id,
            expires_at.isoformat(),
            None,
            None,
            now.isoformat(),
        ),
    )
    events_service.emit(
        conn,
        "worker.pairing_created",
        {"created_by_user_id": created_by_user_id, "expires_at": expires_at.isoformat()},
    )
    conn.commit()
    return {
        "pairing_token": pairing_token,
        "expires_at": expires_at.isoformat(),
    }


def complete_pairing(
    conn: Connection,
    *,
    pairing_token: str,
    worker_id: str,
    worker_label: str,
    worker_class: str,
    capabilities: list[str],
) -> dict:
    now = utc_now()
    pairing_row = execute_fetchone(
        conn,
        """
        SELECT * FROM worker_pairings
        WHERE pairing_token_hash = ? AND used_at IS NULL
        """,
        (hash_token(pairing_token),),
    )
    if pairing_row is None:
        raise ValueError("Invalid pairing token")
    if _parse_iso(pairing_row["expires_at"]) <= now:
        raise ValueError("Pairing token expired")

    access = create_session_token()
    refresh = create_session_token()
    access_expires_at = now + timedelta(hours=ACCESS_TOKEN_HOURS)
    refresh_expires_at = now + timedelta(days=REFRESH_TOKEN_DAYS)
    capabilities_json = json.dumps(sorted({item for item in capabilities if item}), sort_keys=True)

    existing = execute_fetchone(conn, "SELECT id FROM worker_sessions WHERE worker_id = ?", (worker_id,))
    if existing is None:
        conn.execute(
            """
            INSERT INTO worker_sessions (
              id, worker_id, worker_label, worker_class, capabilities_json,
              access_token_hash, refresh_token_hash, access_expires_at, refresh_expires_at,
              revoked_at, revocation_reason, last_seen_at, created_at, updated_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                new_id("wrk"),
                worker_id,
                worker_label,
                worker_class,
                capabilities_json,
                access.hashed,
                refresh.hashed,
                access_expires_at.isoformat(),
                refresh_expires_at.isoformat(),
                None,
                None,
                now.isoformat(),
                now.isoformat(),
                now.isoformat(),
            ),
        )
    else:
        conn.execute(
            """
            UPDATE worker_sessions
            SET worker_label = ?, worker_class = ?, capabilities_json = ?,
                access_token_hash = ?, refresh_token_hash = ?,
                access_expires_at = ?, refresh_expires_at = ?,
                revoked_at = NULL, revocation_reason = NULL,
                last_seen_at = ?, updated_at = ?
            WHERE worker_id = ?
            """,
            (
                worker_label,
                worker_class,
                capabilities_json,
                access.hashed,
                refresh.hashed,
                access_expires_at.isoformat(),
                refresh_expires_at.isoformat(),
                now.isoformat(),
                now.isoformat(),
                worker_id,
            ),
        )

    conn.execute(
        "UPDATE worker_pairings SET used_at = ?, worker_id = ? WHERE id = ?",
        (now.isoformat(), worker_id, pairing_row["id"]),
    )
    events_service.emit(
        conn,
        "worker.paired",
        {
            "worker_id": worker_id,
            "worker_class": worker_class,
            "capabilities": sorted({item for item in capabilities if item}),
        },
    )
    conn.commit()
    return {
        "worker_id": worker_id,
        "worker_label": worker_label,
        "worker_class": worker_class,
        "capabilities": sorted({item for item in capabilities if item}),
        "access_token": access.plain,
        "refresh_token": refresh.plain,
        "access_expires_at": access_expires_at.isoformat(),
        "refresh_expires_at": refresh_expires_at.isoformat(),
    }


def refresh_access_token(conn: Connection, *, worker_id: str, refresh_token: str) -> dict:
    now = utc_now()
    row = execute_fetchone(
        conn,
        """
        SELECT * FROM worker_sessions
        WHERE worker_id = ? AND refresh_token_hash = ? AND revoked_at IS NULL
        """,
        (worker_id, hash_token(refresh_token)),
    )
    if row is None:
        raise ValueError("Invalid worker refresh token")
    if _parse_iso(row["refresh_expires_at"]) <= now:
        raise ValueError("Refresh token expired")

    access = create_session_token()
    access_expires_at = now + timedelta(hours=ACCESS_TOKEN_HOURS)
    conn.execute(
        """
        UPDATE worker_sessions
        SET access_token_hash = ?, access_expires_at = ?, updated_at = ?
        WHERE worker_id = ?
        """,
        (access.hashed, access_expires_at.isoformat(), now.isoformat(), worker_id),
    )
    events_service.emit(conn, "worker.token_refreshed", {"worker_id": worker_id})
    conn.commit()
    return {
        "worker_id": worker_id,
        "access_token": access.plain,
        "access_expires_at": access_expires_at.isoformat(),
    }


def get_worker_by_access_token(conn: Connection, *, access_token: str) -> dict | None:
    row = execute_fetchone(
        conn,
        """
        SELECT * FROM worker_sessions
        WHERE access_token_hash = ? AND revoked_at IS NULL
        """,
        (hash_token(access_token),),
    )
    if row is None:
        return None
    if _parse_iso(row["access_expires_at"]) <= utc_now():
        return None
    return _session_payload(row)


def heartbeat(
    conn: Connection,
    *,
    worker_id: str,
    access_token: str,
    capabilities: list[str],
) -> dict:
    now = utc_now()
    row = execute_fetchone(
        conn,
        """
        SELECT * FROM worker_sessions
        WHERE worker_id = ? AND access_token_hash = ? AND revoked_at IS NULL
        """,
        (worker_id, hash_token(access_token)),
    )
    if row is None:
        raise ValueError("Invalid worker session")
    if _parse_iso(row["access_expires_at"]) <= now:
        raise ValueError("Worker access token expired")

    next_capabilities = sorted({item for item in (capabilities or _parse_capabilities(row.get("capabilities_json"))) if item})
    conn.execute(
        """
        UPDATE worker_sessions
        SET capabilities_json = ?, last_seen_at = ?, updated_at = ?
        WHERE worker_id = ?
        """,
        (json.dumps(next_capabilities, sort_keys=True), now.isoformat(), now.isoformat(), worker_id),
    )
    events_service.emit(
        conn,
        "worker.heartbeat",
        {"worker_id": worker_id, "worker_class": row["worker_class"], "capabilities": next_capabilities},
    )
    conn.commit()
    refreshed = execute_fetchone(conn, "SELECT * FROM worker_sessions WHERE worker_id = ?", (worker_id,))
    if refreshed is None:
        raise RuntimeError("Worker session missing after heartbeat")
    return _session_payload(refreshed)


def list_workers(conn: Connection, *, include_revoked: bool = False) -> list[dict]:
    if include_revoked:
        rows = execute_fetchall(conn, "SELECT * FROM worker_sessions ORDER BY worker_id ASC")
    else:
        rows = execute_fetchall(conn, "SELECT * FROM worker_sessions WHERE revoked_at IS NULL ORDER BY worker_id ASC")
    return [_session_payload(row) for row in rows]


def revoke_worker(conn: Connection, *, worker_id: str, reason: str | None = None) -> dict | None:
    row = execute_fetchone(conn, "SELECT * FROM worker_sessions WHERE worker_id = ?", (worker_id,))
    if row is None:
        return None
    if row.get("revoked_at"):
        return _session_payload(row)

    now = utc_now().isoformat()
    conn.execute(
        """
        UPDATE worker_sessions
        SET revoked_at = ?, revocation_reason = ?, updated_at = ?
        WHERE worker_id = ?
        """,
        (now, (reason or "").strip() or "Revoked by user", now, worker_id),
    )
    events_service.emit(conn, "worker.revoked", {"worker_id": worker_id, "reason": (reason or "").strip() or "Revoked"})
    conn.commit()
    updated = execute_fetchone(conn, "SELECT * FROM worker_sessions WHERE worker_id = ?", (worker_id,))
    return _session_payload(updated) if updated else None


def online_worker_classes_for_capability(conn: Connection, capability: str) -> set[str]:
    now = utc_now()
    rows = execute_fetchall(
        conn,
        "SELECT worker_class, capabilities_json, access_expires_at, last_seen_at, revoked_at FROM worker_sessions WHERE revoked_at IS NULL",
    )
    online_classes: set[str] = set()
    for row in rows:
        if row.get("revoked_at"):
            continue
        if _parse_iso(row["access_expires_at"]) <= now:
            continue
        last_seen_raw = row.get("last_seen_at")
        if not isinstance(last_seen_raw, str) or not last_seen_raw:
            continue
        try:
            if (now - _parse_iso(last_seen_raw)) > timedelta(minutes=WORKER_ONLINE_TTL_MINUTES):
                continue
        except ValueError:
            continue
        capabilities = _parse_capabilities(row.get("capabilities_json"))
        if capability not in capabilities:
            continue
        worker_class = str(row.get("worker_class") or "").strip()
        if worker_class:
            online_classes.add(worker_class)
    return online_classes

