import hashlib
import json
import secrets
from datetime import datetime, timezone
from sqlite3 import Connection
from urllib.parse import urlencode

from app.core.config import get_settings
from app.core.time import utc_now
from app.services import events_service
from app.services.common import execute_fetchall, execute_fetchone, new_id

SYNC_KEY = "google_last_synced_at"
STATE_KEY = "google_oauth_state"


def _to_iso(value: str | datetime) -> str:
    if isinstance(value, str):
        return value
    return value.astimezone(timezone.utc).isoformat()


def _etag(title: str, starts_at: str, ends_at: str) -> str:
    raw = f"{title}|{starts_at}|{ends_at}".encode("utf-8")
    return hashlib.sha256(raw).hexdigest()[:16]


def _get_meta(conn: Connection, key: str) -> dict | None:
    row = execute_fetchone(conn, "SELECT value_json FROM calendar_sync_meta WHERE key = ?", (key,))
    if row is None:
        return None
    value = row["value_json"]
    if isinstance(value, dict):
        return value
    return None


def _upsert_meta(conn: Connection, key: str, payload: dict) -> None:
    now = utc_now().isoformat()
    conn.execute(
        """
        INSERT INTO calendar_sync_meta (key, value_json, updated_at)
        VALUES (?, ?, ?)
        ON CONFLICT(key) DO UPDATE SET value_json = excluded.value_json, updated_at = excluded.updated_at
        """,
        (key, json.dumps(payload, sort_keys=True), now),
    )


def oauth_start(conn: Connection, redirect_uri: str | None) -> tuple[str, str]:
    settings = get_settings()
    state = secrets.token_urlsafe(24)
    _upsert_meta(conn, STATE_KEY, {"state": state})
    conn.commit()

    redirect = redirect_uri or settings.google_redirect_uri
    query = urlencode(
        {
            "client_id": settings.google_client_id or "starlog-local-client",
            "redirect_uri": redirect,
            "response_type": "code",
            "scope": settings.google_oauth_scopes,
            "access_type": "offline",
            "prompt": "consent",
            "state": state,
        }
    )
    auth_url = f"https://accounts.google.com/o/oauth2/v2/auth?{query}"
    return auth_url, state


def oauth_callback(conn: Connection, code: str, state: str) -> tuple[bool, str]:
    saved = _get_meta(conn, STATE_KEY)
    if saved is None or saved.get("state") != state:
        return False, "Invalid OAuth state"

    now = utc_now().isoformat()
    # Token exchange is represented as a persisted provider config in this self-hosted scaffold.
    token_payload = {
        "access_token": f"mock_access_{code[:8]}",
        "refresh_token": f"mock_refresh_{code[:8]}",
        "expires_at": now,
    }
    conn.execute(
        """
        INSERT INTO provider_configs (id, provider_name, enabled, mode, config_json, updated_at)
        VALUES (?, ?, ?, ?, ?, ?)
        ON CONFLICT(provider_name) DO UPDATE SET
          enabled = excluded.enabled,
          mode = excluded.mode,
          config_json = excluded.config_json,
          updated_at = excluded.updated_at
        """,
        (new_id("prv"), "google_calendar", 1, "oauth", json.dumps(token_payload, sort_keys=True), now),
    )
    events_service.emit(conn, "google.oauth_connected", {"provider": "google_calendar"})
    conn.commit()
    return True, "Google calendar OAuth connected"


def upsert_remote_event(
    conn: Connection,
    remote_id: str,
    title: str,
    starts_at: str | datetime,
    ends_at: str | datetime,
) -> dict:
    start_iso = _to_iso(starts_at)
    end_iso = _to_iso(ends_at)
    now = utc_now().isoformat()
    event_etag = _etag(title, start_iso, end_iso)

    conn.execute(
        """
        INSERT INTO google_remote_events (remote_id, title, starts_at, ends_at, etag, updated_at)
        VALUES (?, ?, ?, ?, ?, ?)
        ON CONFLICT(remote_id) DO UPDATE SET
          title = excluded.title,
          starts_at = excluded.starts_at,
          ends_at = excluded.ends_at,
          etag = excluded.etag,
          updated_at = excluded.updated_at
        """,
        (remote_id, title, start_iso, end_iso, event_etag, now),
    )
    events_service.emit(conn, "google.remote_event_upserted", {"remote_id": remote_id})
    conn.commit()

    row = execute_fetchone(conn, "SELECT * FROM google_remote_events WHERE remote_id = ?", (remote_id,))
    if row is None:
        raise RuntimeError("Remote event upsert failed")
    return row


def list_remote_events(conn: Connection) -> list[dict]:
    return execute_fetchall(conn, "SELECT * FROM google_remote_events ORDER BY starts_at ASC")


def _last_sync_at(conn: Connection) -> str:
    meta = _get_meta(conn, SYNC_KEY)
    if not meta:
        return "1970-01-01T00:00:00+00:00"
    value = meta.get("value")
    return value if isinstance(value, str) else "1970-01-01T00:00:00+00:00"


def _record_conflict(conn: Connection, local_event_id: str | None, remote_id: str, detail: dict) -> None:
    conn.execute(
        """
        INSERT INTO calendar_sync_conflicts (id, local_event_id, remote_id, strategy, detail_json, created_at)
        VALUES (?, ?, ?, ?, ?, ?)
        """,
        (
            new_id("cnf"),
            local_event_id,
            remote_id,
            "prefer_local",
            json.dumps(detail, sort_keys=True),
            utc_now().isoformat(),
        ),
    )


def run_two_way_sync(conn: Connection) -> dict:
    last_sync_at = _last_sync_at(conn)

    pushed = 0
    pulled = 0
    conflicts = 0

    local_changed = execute_fetchall(
        conn,
        """
        SELECT id, title, starts_at, ends_at, remote_id, etag, updated_at
        FROM calendar_events
        WHERE updated_at > ?
        ORDER BY updated_at ASC
        """,
        (last_sync_at,),
    )

    for event in local_changed:
        remote_id = str(event["remote_id"] or f"gcal_{event['id']}")
        local_etag = _etag(str(event["title"]), str(event["starts_at"]), str(event["ends_at"]))

        remote = execute_fetchone(
            conn,
            "SELECT remote_id, title, starts_at, ends_at, etag, updated_at FROM google_remote_events WHERE remote_id = ?",
            (remote_id,),
        )

        if remote is not None and str(remote["updated_at"]) > last_sync_at and str(event["updated_at"]) > last_sync_at:
            if str(remote["etag"]) != local_etag:
                conflicts += 1
                _record_conflict(
                    conn,
                    local_event_id=str(event["id"]),
                    remote_id=remote_id,
                    detail={
                        "local": {"title": event["title"], "starts_at": event["starts_at"], "ends_at": event["ends_at"]},
                        "remote": {"title": remote["title"], "starts_at": remote["starts_at"], "ends_at": remote["ends_at"]},
                    },
                )
                continue

        conn.execute(
            """
            INSERT INTO google_remote_events (remote_id, title, starts_at, ends_at, etag, updated_at)
            VALUES (?, ?, ?, ?, ?, ?)
            ON CONFLICT(remote_id) DO UPDATE SET
              title = excluded.title,
              starts_at = excluded.starts_at,
              ends_at = excluded.ends_at,
              etag = excluded.etag,
              updated_at = excluded.updated_at
            """,
            (
                remote_id,
                event["title"],
                event["starts_at"],
                event["ends_at"],
                local_etag,
                utc_now().isoformat(),
            ),
        )
        conn.execute(
            "UPDATE calendar_events SET remote_id = ?, etag = ?, source = ? WHERE id = ?",
            (remote_id, local_etag, "google", event["id"]),
        )
        pushed += 1

    remote_changed = execute_fetchall(
        conn,
        "SELECT remote_id, title, starts_at, ends_at, etag, updated_at FROM google_remote_events WHERE updated_at > ?",
        (last_sync_at,),
    )

    for remote in remote_changed:
        local = execute_fetchone(
            conn,
            "SELECT id, updated_at, etag FROM calendar_events WHERE remote_id = ?",
            (remote["remote_id"],),
        )

        if local is None:
            conn.execute(
                """
                INSERT INTO calendar_events (id, title, starts_at, ends_at, source, remote_id, etag, created_at, updated_at)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    new_id("cal"),
                    remote["title"],
                    remote["starts_at"],
                    remote["ends_at"],
                    "google",
                    remote["remote_id"],
                    remote["etag"],
                    utc_now().isoformat(),
                    remote["updated_at"],
                ),
            )
            pulled += 1
            continue

        if str(local["updated_at"]) > last_sync_at and str(local["etag"]) != str(remote["etag"]):
            conflicts += 1
            _record_conflict(
                conn,
                local_event_id=str(local["id"]),
                remote_id=str(remote["remote_id"]),
                detail={"reason": "both_changed_since_last_sync"},
            )
            continue

        conn.execute(
            "UPDATE calendar_events SET title = ?, starts_at = ?, ends_at = ?, etag = ?, source = ?, updated_at = ? WHERE id = ?",
            (
                remote["title"],
                remote["starts_at"],
                remote["ends_at"],
                remote["etag"],
                "google",
                remote["updated_at"],
                local["id"],
            ),
        )
        pulled += 1

    synced_at = utc_now().isoformat()
    _upsert_meta(conn, SYNC_KEY, {"value": synced_at})
    events_service.emit(
        conn,
        "calendar.google_sync_ran",
        {"pushed": pushed, "pulled": pulled, "conflicts": conflicts, "synced_at": synced_at},
    )
    conn.commit()

    return {
        "pushed": pushed,
        "pulled": pulled,
        "conflicts": conflicts,
        "last_synced_at": synced_at,
    }


def list_conflicts(conn: Connection) -> list[dict]:
    rows = execute_fetchall(
        conn,
        "SELECT id, local_event_id, remote_id, strategy, detail_json, created_at FROM calendar_sync_conflicts ORDER BY created_at DESC",
    )
    formatted: list[dict] = []
    for row in rows:
        formatted.append(
            {
                "id": row["id"],
                "local_event_id": row["local_event_id"],
                "remote_id": row["remote_id"],
                "strategy": row["strategy"],
                "detail": row["detail_json"],
                "created_at": row["created_at"],
            }
        )
    return formatted
