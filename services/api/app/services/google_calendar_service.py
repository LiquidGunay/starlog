import hashlib
import json
import logging
import secrets
from datetime import datetime, timedelta, timezone
from sqlite3 import Connection
from urllib.error import HTTPError, URLError
from urllib.parse import quote, urlencode
from urllib.request import Request, urlopen

from app.core.config import get_settings
from app.core.time import utc_now
from app.services import events_service
from app.services.common import execute_fetchall, execute_fetchone, new_id

SYNC_KEY = "google_last_synced_at"
STATE_KEY = "google_oauth_state"
TOKEN_URL = "https://oauth2.googleapis.com/token"
GOOGLE_EVENTS_API = "https://www.googleapis.com/calendar/v3/calendars/{calendar_id}/events"

logger = logging.getLogger("starlog.google_sync")


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


def _provider_config(conn: Connection) -> dict | None:
    row = execute_fetchone(
        conn,
        "SELECT mode, config_json FROM provider_configs WHERE provider_name = ? AND enabled = 1",
        ("google_calendar",),
    )
    if row is None:
        return None
    config = row.get("config_json")
    if not isinstance(config, dict):
        return None
    return {"mode": row.get("mode"), "config": config}


def _save_provider_config(conn: Connection, mode: str, payload: dict) -> None:
    now = utc_now().isoformat()
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
        (new_id("prv"), "google_calendar", 1, mode, json.dumps(payload, sort_keys=True), now),
    )


def _http_form_post(url: str, payload: dict) -> dict:
    body = urlencode(payload).encode("utf-8")
    request = Request(
        url=url,
        data=body,
        headers={"Content-Type": "application/x-www-form-urlencoded"},
        method="POST",
    )
    with urlopen(request, timeout=20) as response:  # noqa: S310
        raw = response.read().decode("utf-8")
    parsed = json.loads(raw)
    if isinstance(parsed, dict):
        return parsed
    raise RuntimeError("Unexpected token endpoint payload shape")


def _http_get_json(url: str, access_token: str) -> dict:
    request = Request(
        url=url,
        headers={"Authorization": f"Bearer {access_token}"},
        method="GET",
    )
    with urlopen(request, timeout=20) as response:  # noqa: S310
        raw = response.read().decode("utf-8")
    parsed = json.loads(raw)
    if isinstance(parsed, dict):
        return parsed
    raise RuntimeError("Unexpected Google API payload shape")


def _iso_or_default(value: str | None) -> str:
    if not value:
        return utc_now().isoformat()
    if value.endswith("Z"):
        return value.replace("Z", "+00:00")
    return value


def _token_expired(expires_at: str | None) -> bool:
    if not expires_at:
        return False
    try:
        expiry = datetime.fromisoformat(expires_at)
    except ValueError:
        return False
    return expiry <= utc_now() + timedelta(minutes=1)


def _refresh_google_token(conn: Connection, config: dict) -> dict:
    settings = get_settings()
    refresh_token = str(config.get("refresh_token") or "")
    if not refresh_token:
        return config
    if not settings.google_client_id or not settings.google_client_secret:
        return config

    token_payload = _http_form_post(
        TOKEN_URL,
        {
            "client_id": settings.google_client_id,
            "client_secret": settings.google_client_secret,
            "refresh_token": refresh_token,
            "grant_type": "refresh_token",
        },
    )
    access_token = token_payload.get("access_token")
    if not isinstance(access_token, str) or not access_token:
        raise RuntimeError("Google token refresh did not return access_token")

    expires_in = int(token_payload.get("expires_in", 3600))
    refreshed = dict(config)
    refreshed["access_token"] = access_token
    refreshed["expires_at"] = (utc_now() + timedelta(seconds=expires_in)).isoformat()
    refreshed["token_type"] = token_payload.get("token_type", "Bearer")
    refreshed["scope"] = token_payload.get("scope", refreshed.get("scope", ""))
    _save_provider_config(conn, "oauth_google", refreshed)
    conn.commit()
    return refreshed


def _parse_google_event_time(payload: dict[str, object]) -> str:
    date_time = payload.get("dateTime")
    if isinstance(date_time, str) and date_time:
        return _iso_or_default(date_time)

    date_only = payload.get("date")
    if isinstance(date_only, str) and date_only:
        return f"{date_only}T00:00:00+00:00"

    return utc_now().isoformat()


def _upsert_remote_from_google(conn: Connection, remote: dict) -> None:
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
            remote["remote_id"],
            remote["title"],
            remote["starts_at"],
            remote["ends_at"],
            remote["etag"],
            remote["updated_at"],
        ),
    )


def sync_remote_from_google_api(conn: Connection) -> int:
    provider = _provider_config(conn)
    if provider is None:
        return 0

    config = provider["config"]
    if str(config.get("source", "")) != "google_oauth":
        return 0

    access_token = str(config.get("access_token") or "")
    if not access_token:
        return 0

    if _token_expired(str(config.get("expires_at") or "")):
        try:
            config = _refresh_google_token(conn, config)
            access_token = str(config.get("access_token") or "")
        except Exception as exc:  # noqa: BLE001
            logger.warning("google token refresh failed: %s", exc)
            events_service.emit(conn, "google.remote_pull_failed", {"reason": "token_refresh_failed"})
            conn.commit()
            return 0

    settings = get_settings()
    calendar_id = quote(settings.google_calendar_id, safe="")
    query = urlencode({"singleEvents": "true", "showDeleted": "false", "maxResults": 250})
    url = f"{GOOGLE_EVENTS_API.format(calendar_id=calendar_id)}?{query}"

    try:
        response = _http_get_json(url, access_token)
    except (HTTPError, URLError, RuntimeError, TimeoutError) as exc:
        logger.warning("google events pull failed: %s", exc)
        events_service.emit(conn, "google.remote_pull_failed", {"reason": "network_or_payload_error"})
        conn.commit()
        return 0

    items = response.get("items")
    if not isinstance(items, list):
        return 0

    imported = 0
    for item in items:
        if not isinstance(item, dict):
            continue
        remote_id = item.get("id")
        if not isinstance(remote_id, str) or not remote_id:
            continue
        title = item.get("summary")
        if not isinstance(title, str) or not title:
            title = "(untitled)"

        start_payload = item.get("start")
        end_payload = item.get("end")
        starts_at = _parse_google_event_time(start_payload if isinstance(start_payload, dict) else {})
        ends_at = _parse_google_event_time(end_payload if isinstance(end_payload, dict) else {})
        etag = item.get("etag")
        updated_at = item.get("updated")
        _upsert_remote_from_google(
            conn,
            {
                "remote_id": remote_id,
                "title": title,
                "starts_at": starts_at,
                "ends_at": ends_at,
                "etag": str(etag or _etag(title, starts_at, ends_at)),
                "updated_at": _iso_or_default(str(updated_at) if isinstance(updated_at, str) else None),
            },
        )
        imported += 1

    events_service.emit(conn, "google.remote_pull_succeeded", {"imported": imported})
    conn.commit()
    return imported


def oauth_status(conn: Connection) -> dict:
    provider = _provider_config(conn)
    if provider is None:
        return {
            "connected": False,
            "mode": None,
            "source": None,
            "expires_at": None,
            "has_refresh_token": False,
            "detail": "Google calendar provider is not connected.",
        }

    config = provider["config"]
    source = str(config.get("source") or "unknown")
    expires_at = config.get("expires_at")
    return {
        "connected": True,
        "mode": provider["mode"],
        "source": source,
        "expires_at": expires_at if isinstance(expires_at, str) else None,
        "has_refresh_token": bool(config.get("refresh_token")),
        "detail": "Connected to Google Calendar." if source == "google_oauth" else "Connected in local scaffold mode.",
    }


def oauth_start(conn: Connection, redirect_uri: str | None) -> tuple[str, str]:
    settings = get_settings()
    state = secrets.token_urlsafe(24)
    redirect = redirect_uri or settings.google_redirect_uri
    _upsert_meta(conn, STATE_KEY, {"state": state, "redirect_uri": redirect})
    conn.commit()

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

    settings = get_settings()
    redirect_uri = str(saved.get("redirect_uri") or settings.google_redirect_uri)

    token_payload: dict
    detail: str
    mode = "oauth_local_stub"

    if settings.google_client_id and settings.google_client_secret:
        try:
            exchange = _http_form_post(
                TOKEN_URL,
                {
                    "code": code,
                    "client_id": settings.google_client_id,
                    "client_secret": settings.google_client_secret,
                    "redirect_uri": redirect_uri,
                    "grant_type": "authorization_code",
                },
            )
            access_token = exchange.get("access_token")
            if not isinstance(access_token, str) or not access_token:
                return False, "Google token exchange failed: access_token missing"
            expires_in = int(exchange.get("expires_in", 3600))
            token_payload = {
                "access_token": access_token,
                "refresh_token": str(exchange.get("refresh_token") or ""),
                "token_type": str(exchange.get("token_type") or "Bearer"),
                "scope": str(exchange.get("scope") or settings.google_oauth_scopes),
                "expires_at": (utc_now() + timedelta(seconds=expires_in)).isoformat(),
                "source": "google_oauth",
            }
            mode = "oauth_google"
            detail = "Google calendar OAuth connected."
        except (HTTPError, URLError, RuntimeError, TimeoutError, ValueError) as exc:
            logger.warning("google oauth token exchange failed: %s", exc)
            return False, f"Google token exchange failed: {exc}"
    else:
        now = utc_now().isoformat()
        token_payload = {
            "access_token": f"mock_access_{code[:8]}",
            "refresh_token": f"mock_refresh_{code[:8]}",
            "expires_at": now,
            "token_type": "Bearer",
            "scope": settings.google_oauth_scopes,
            "source": "mock_oauth",
        }
        detail = "Google credentials not configured; connected in local scaffold mode."

    _save_provider_config(conn, mode, token_payload)
    events_service.emit(conn, "google.oauth_connected", {"provider": "google_calendar"})
    conn.commit()
    return True, detail


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
    imported_from_google_api = sync_remote_from_google_api(conn)
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
        {
            "pushed": pushed,
            "pulled": pulled,
            "conflicts": conflicts,
            "imported_from_google_api": imported_from_google_api,
            "synced_at": synced_at,
        },
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
