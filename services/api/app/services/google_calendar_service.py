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
from app.core.security import decrypt_sensitive_config, encrypt_sensitive_config
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
    return {"mode": row.get("mode"), "config": decrypt_sensitive_config(config)}


def _save_provider_config(conn: Connection, mode: str, payload: dict) -> None:
    now = utc_now().isoformat()
    encrypted_payload = encrypt_sensitive_config(payload)
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
        (new_id("prv"), "google_calendar", 1, mode, json.dumps(encrypted_payload, sort_keys=True), now),
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


def _http_json_request(
    url: str,
    access_token: str,
    method: str,
    payload: dict | None = None,
    allow_not_found: bool = False,
) -> dict | None:
    body = json.dumps(payload).encode("utf-8") if payload is not None else None
    headers = {"Authorization": f"Bearer {access_token}"}
    if payload is not None:
        headers["Content-Type"] = "application/json"
    request = Request(url=url, data=body, headers=headers, method=method)
    try:
        with urlopen(request, timeout=20) as response:  # noqa: S310
            raw = response.read().decode("utf-8")
    except HTTPError as exc:
        if allow_not_found and exc.code in {404, 410}:
            return None
        raise

    if not raw.strip():
        return {}
    parsed = json.loads(raw)
    if isinstance(parsed, dict):
        return parsed
    raise RuntimeError("Unexpected Google API payload shape")


def _events_collection_url() -> str:
    settings = get_settings()
    calendar_id = quote(settings.google_calendar_id, safe="")
    return GOOGLE_EVENTS_API.format(calendar_id=calendar_id)


def _event_url(remote_id: str) -> str:
    return f"{_events_collection_url()}/{quote(remote_id, safe='')}"


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


def _ensure_google_access_token(conn: Connection) -> tuple[str | None, dict | None]:
    provider = _provider_config(conn)
    if provider is None:
        return None, None

    config = provider["config"]
    if str(config.get("source", "")) != "google_oauth":
        return None, config

    access_token = str(config.get("access_token") or "")
    if not access_token:
        return None, config

    if _token_expired(str(config.get("expires_at") or "")):
        config = _refresh_google_token(conn, config)
        access_token = str(config.get("access_token") or "")

    return access_token, config


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
        INSERT INTO google_remote_events (remote_id, title, starts_at, ends_at, etag, deleted, deleted_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(remote_id) DO UPDATE SET
          title = excluded.title,
          starts_at = excluded.starts_at,
          ends_at = excluded.ends_at,
          etag = excluded.etag,
          deleted = excluded.deleted,
          deleted_at = excluded.deleted_at,
          updated_at = excluded.updated_at
        """,
        (
            remote["remote_id"],
            remote["title"],
            remote["starts_at"],
            remote["ends_at"],
            remote["etag"],
            remote["deleted"],
            remote["deleted_at"],
            remote["updated_at"],
        ),
    )


def _google_event_to_remote(item: dict, previous: dict | None) -> dict | None:
    remote_id = item.get("id")
    if not isinstance(remote_id, str) or not remote_id:
        return None

    status = str(item.get("status") or "")
    deleted = status == "cancelled"
    title = item.get("summary")
    if not isinstance(title, str) or not title:
        title = str(previous["title"]) if previous and previous.get("title") else "(untitled)"

    if deleted:
        starts_at = str(previous["starts_at"]) if previous and previous.get("starts_at") else utc_now().isoformat()
        ends_at = str(previous["ends_at"]) if previous and previous.get("ends_at") else starts_at
    else:
        start_payload = item.get("start")
        end_payload = item.get("end")
        starts_at = _parse_google_event_time(start_payload if isinstance(start_payload, dict) else {})
        ends_at = _parse_google_event_time(end_payload if isinstance(end_payload, dict) else {})

    etag = item.get("etag")
    updated_at = item.get("updated")
    resolved_updated = _iso_or_default(str(updated_at) if isinstance(updated_at, str) else None)
    deleted_at = resolved_updated if deleted else None
    return {
        "remote_id": remote_id,
        "title": title,
        "starts_at": starts_at,
        "ends_at": ends_at,
        "etag": str(etag or _etag(title, starts_at, ends_at)),
        "deleted": 1 if deleted else 0,
        "deleted_at": deleted_at,
        "updated_at": resolved_updated,
    }


def sync_remote_from_google_api(conn: Connection) -> int:
    try:
        access_token, _ = _ensure_google_access_token(conn)
    except Exception as exc:  # noqa: BLE001
        logger.warning("google token refresh failed: %s", exc)
        events_service.emit(conn, "google.remote_pull_failed", {"reason": "token_refresh_failed"})
        conn.commit()
        return 0

    if not access_token:
        return 0

    query = urlencode({"singleEvents": "true", "showDeleted": "true", "maxResults": 250})
    url = f"{_events_collection_url()}?{query}"

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
        previous = execute_fetchone(
            conn,
            "SELECT remote_id, title, starts_at, ends_at, etag, deleted, deleted_at, updated_at FROM google_remote_events WHERE remote_id = ?",
            (remote_id,),
        )
        remote = _google_event_to_remote(item, previous)
        if remote is None:
            continue
        _upsert_remote_from_google(conn, remote)
        imported += 1

    events_service.emit(conn, "google.remote_pull_succeeded", {"imported": imported})
    conn.commit()
    return imported


def probe_oauth_connection(conn: Connection) -> tuple[bool, str, dict[str, str]]:
    query = urlencode({"singleEvents": "true", "showDeleted": "false", "maxResults": 1})
    target = f"{_events_collection_url()}?{query}"

    try:
        access_token, _ = _ensure_google_access_token(conn)
    except Exception as exc:  # noqa: BLE001
        return False, f"Google auth probe failed during token refresh: {exc}", {
            "target": target,
            "status": "failed",
            "detail": "Token refresh failed before probe",
        }

    if not access_token:
        return False, "Google auth probe failed: missing access token", {
            "target": target,
            "status": "failed",
            "detail": "Access token missing",
        }

    try:
        payload = _http_get_json(target, access_token)
    except (HTTPError, URLError, RuntimeError, TimeoutError) as exc:
        return False, f"Google auth probe failed: {exc}", {
            "target": target,
            "status": "failed",
            "detail": str(exc),
        }

    items = payload.get("items")
    if not isinstance(items, list):
        return False, "Google auth probe failed: unexpected payload shape", {
            "target": target,
            "status": "failed",
            "detail": "items array missing from response",
        }

    return True, "Google auth probe succeeded", {
        "target": target,
        "status": "ok",
        "detail": f"Loaded {len(items)} event(s) from Google Calendar API",
    }


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
        INSERT INTO google_remote_events (remote_id, title, starts_at, ends_at, etag, deleted, deleted_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(remote_id) DO UPDATE SET
          title = excluded.title,
          starts_at = excluded.starts_at,
          ends_at = excluded.ends_at,
          etag = excluded.etag,
          deleted = excluded.deleted,
          deleted_at = excluded.deleted_at,
          updated_at = excluded.updated_at
        """,
        (remote_id, title, start_iso, end_iso, event_etag, 0, None, now),
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


def _record_conflict(
    conn: Connection,
    local_event_id: str | None,
    remote_id: str,
    detail: dict,
    sync_run_id: str,
    phase: str,
) -> None:
    enriched_detail = dict(detail)
    enriched_detail["sync_run_id"] = sync_run_id
    enriched_detail["phase"] = phase
    enriched_detail["recorded_at"] = utc_now().isoformat()
    conn.execute(
        """
        INSERT INTO calendar_sync_conflicts (
          id, local_event_id, remote_id, strategy, detail_json, resolved, resolved_at, resolution_strategy, created_at
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        """,
        (
            new_id("cnf"),
            local_event_id,
            remote_id,
            "prefer_local",
            json.dumps(enriched_detail, sort_keys=True),
            0,
            None,
            None,
            utc_now().isoformat(),
        ),
    )


def _google_payload(title: str, starts_at: str, ends_at: str) -> dict:
    return {
        "summary": title,
        "start": {"dateTime": starts_at},
        "end": {"dateTime": ends_at},
    }


def _create_google_event(access_token: str, title: str, starts_at: str, ends_at: str) -> dict:
    response = _http_json_request(
        _events_collection_url(),
        access_token=access_token,
        method="POST",
        payload=_google_payload(title, starts_at, ends_at),
    )
    if not isinstance(response, dict):
        raise RuntimeError("Google event create returned no payload")
    return response


def _update_google_event(access_token: str, remote_id: str, title: str, starts_at: str, ends_at: str) -> dict:
    response = _http_json_request(
        _event_url(remote_id),
        access_token=access_token,
        method="PATCH",
        payload=_google_payload(title, starts_at, ends_at),
    )
    if not isinstance(response, dict):
        raise RuntimeError("Google event update returned no payload")
    return response


def _delete_google_event(access_token: str, remote_id: str) -> None:
    _http_json_request(
        _event_url(remote_id),
        access_token=access_token,
        method="DELETE",
        allow_not_found=True,
    )


def _upsert_remote_mirror(
    conn: Connection,
    remote_id: str,
    title: str,
    starts_at: str,
    ends_at: str,
    etag: str,
    deleted: bool,
    updated_at: str | None = None,
) -> None:
    resolved_updated = updated_at or utc_now().isoformat()
    conn.execute(
        """
        INSERT INTO google_remote_events (remote_id, title, starts_at, ends_at, etag, deleted, deleted_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(remote_id) DO UPDATE SET
          title = excluded.title,
          starts_at = excluded.starts_at,
          ends_at = excluded.ends_at,
          etag = excluded.etag,
          deleted = excluded.deleted,
          deleted_at = excluded.deleted_at,
          updated_at = excluded.updated_at
        """,
        (
            remote_id,
            title,
            starts_at,
            ends_at,
            etag,
            1 if deleted else 0,
            resolved_updated if deleted else None,
            resolved_updated,
        ),
    )


def run_two_way_sync(conn: Connection) -> dict:
    sync_run_id = new_id("gsr")
    imported_from_google_api = sync_remote_from_google_api(conn)
    try:
        google_access_token, google_config = _ensure_google_access_token(conn)
    except Exception as exc:  # noqa: BLE001
        logger.warning("google token refresh failed before sync run: %s", exc)
        google_access_token = None
        google_config = None

    google_mode_enabled = bool(
        google_access_token
        and google_config is not None
        and str(google_config.get("source", "")) == "google_oauth"
    )

    last_sync_at = _last_sync_at(conn)

    pushed = 0
    pulled = 0
    conflicts = 0

    local_changed = execute_fetchall(
        conn,
        """
        SELECT id, title, starts_at, ends_at, remote_id, etag, deleted, deleted_at, updated_at
        FROM calendar_events
        WHERE updated_at > ?
        ORDER BY updated_at ASC
        """,
        (last_sync_at,),
    )

    for event in local_changed:
        local_deleted = bool(event.get("deleted"))
        remote_id = str(event["remote_id"] or f"gcal_{event['id']}")
        local_etag = _etag(str(event["title"]), str(event["starts_at"]), str(event["ends_at"]))

        remote = execute_fetchone(
            conn,
            "SELECT remote_id, title, starts_at, ends_at, etag, deleted, deleted_at, updated_at FROM google_remote_events WHERE remote_id = ?",
            (remote_id,),
        )

        if remote is not None and str(remote["updated_at"]) > last_sync_at and str(event["updated_at"]) > last_sync_at:
            remote_deleted = bool(remote.get("deleted"))
            if str(remote["etag"]) != local_etag or remote_deleted != local_deleted:
                conflicts += 1
                _record_conflict(
                    conn,
                    local_event_id=str(event["id"]),
                    remote_id=remote_id,
                    detail={
                        "local": {
                            "title": event["title"],
                            "starts_at": event["starts_at"],
                            "ends_at": event["ends_at"],
                            "deleted": local_deleted,
                        },
                        "remote": {
                            "title": remote["title"],
                            "starts_at": remote["starts_at"],
                            "ends_at": remote["ends_at"],
                            "deleted": remote_deleted,
                        },
                    },
                    sync_run_id=sync_run_id,
                    phase="push_conflict",
                )
                continue

        if google_mode_enabled:
            try:
                if local_deleted:
                    if event.get("remote_id"):
                        _delete_google_event(str(google_access_token), remote_id)
                    _upsert_remote_mirror(
                        conn,
                        remote_id=remote_id,
                        title=str(event["title"]),
                        starts_at=str(event["starts_at"]),
                        ends_at=str(event["ends_at"]),
                        etag=local_etag,
                        deleted=True,
                    )
                elif event.get("remote_id"):
                    updated_payload = _update_google_event(
                        access_token=str(google_access_token),
                        remote_id=remote_id,
                        title=str(event["title"]),
                        starts_at=str(event["starts_at"]),
                        ends_at=str(event["ends_at"]),
                    )
                    parsed = _google_event_to_remote(updated_payload, remote)
                    if parsed is not None:
                        _upsert_remote_from_google(conn, parsed)
                        remote_id = parsed["remote_id"]
                        local_etag = parsed["etag"]
                else:
                    created_payload = _create_google_event(
                        access_token=str(google_access_token),
                        title=str(event["title"]),
                        starts_at=str(event["starts_at"]),
                        ends_at=str(event["ends_at"]),
                    )
                    parsed = _google_event_to_remote(created_payload, remote)
                    if parsed is not None:
                        _upsert_remote_from_google(conn, parsed)
                        remote_id = parsed["remote_id"]
                        local_etag = parsed["etag"]
            except (HTTPError, URLError, RuntimeError, TimeoutError) as exc:
                conflicts += 1
                _record_conflict(
                    conn,
                    local_event_id=str(event["id"]),
                    remote_id=remote_id,
                    detail={"reason": "google_push_failed", "error": str(exc)},
                    sync_run_id=sync_run_id,
                    phase="push_error",
                )
                continue
        else:
            _upsert_remote_mirror(
                conn,
                remote_id=remote_id,
                title=str(event["title"]),
                starts_at=str(event["starts_at"]),
                ends_at=str(event["ends_at"]),
                etag=local_etag,
                deleted=local_deleted,
            )

        conn.execute(
            "UPDATE calendar_events SET remote_id = ?, etag = ?, source = ? WHERE id = ?",
            (remote_id, local_etag, "google", event["id"]),
        )
        pushed += 1

    remote_changed = execute_fetchall(
        conn,
        """
        SELECT remote_id, title, starts_at, ends_at, etag, deleted, deleted_at, updated_at
        FROM google_remote_events
        WHERE updated_at > ?
        """,
        (last_sync_at,),
    )

    for remote in remote_changed:
        remote_deleted = bool(remote.get("deleted"))
        local = execute_fetchone(
            conn,
            "SELECT id, updated_at, etag, deleted FROM calendar_events WHERE remote_id = ?",
            (remote["remote_id"],),
        )

        if remote_deleted:
            if local is None:
                continue
            if str(local["updated_at"]) > last_sync_at and not bool(local.get("deleted")):
                conflicts += 1
                _record_conflict(
                    conn,
                    local_event_id=str(local["id"]),
                    remote_id=str(remote["remote_id"]),
                    detail={"reason": "remote_deleted_local_changed"},
                    sync_run_id=sync_run_id,
                    phase="pull_conflict",
                )
                continue
            conn.execute(
                """
                UPDATE calendar_events
                SET deleted = 1, deleted_at = ?, source = ?, etag = ?, updated_at = ?
                WHERE id = ?
                """,
                (
                    remote.get("deleted_at") or remote["updated_at"],
                    "google",
                    remote["etag"],
                    remote["updated_at"],
                    local["id"],
                ),
            )
            pulled += 1
            continue

        if local is None:
            conn.execute(
                """
                INSERT INTO calendar_events (
                  id, title, starts_at, ends_at, source, remote_id, etag, deleted, deleted_at, created_at, updated_at
                )
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    new_id("cal"),
                    remote["title"],
                    remote["starts_at"],
                    remote["ends_at"],
                    "google",
                    remote["remote_id"],
                    remote["etag"],
                    0,
                    None,
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
                sync_run_id=sync_run_id,
                phase="pull_conflict",
            )
            continue

        conn.execute(
            """
            UPDATE calendar_events
            SET title = ?, starts_at = ?, ends_at = ?, etag = ?, source = ?, deleted = 0, deleted_at = NULL, updated_at = ?
            WHERE id = ?
            """,
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
            "sync_run_id": sync_run_id,
            "pushed": pushed,
            "pulled": pulled,
            "conflicts": conflicts,
            "imported_from_google_api": imported_from_google_api,
            "synced_at": synced_at,
        },
    )
    conn.commit()

    return {
        "run_id": sync_run_id,
        "pushed": pushed,
        "pulled": pulled,
        "conflicts": conflicts,
        "last_synced_at": synced_at,
    }


def _format_conflict(row: dict) -> dict:
    return {
        "id": row["id"],
        "local_event_id": row["local_event_id"],
        "remote_id": row["remote_id"],
        "strategy": row["strategy"],
        "detail": row["detail_json"],
        "resolved": bool(row["resolved"]),
        "resolved_at": row["resolved_at"],
        "resolution_strategy": row["resolution_strategy"],
        "created_at": row["created_at"],
    }


def list_conflicts(conn: Connection, include_resolved: bool = False) -> list[dict]:
    if include_resolved:
        rows = execute_fetchall(
            conn,
            """
            SELECT id, local_event_id, remote_id, strategy, detail_json, resolved, resolved_at, resolution_strategy, created_at
            FROM calendar_sync_conflicts
            ORDER BY created_at DESC
            """,
        )
    else:
        rows = execute_fetchall(
            conn,
            """
            SELECT id, local_event_id, remote_id, strategy, detail_json, resolved, resolved_at, resolution_strategy, created_at
            FROM calendar_sync_conflicts
            WHERE resolved = 0
            ORDER BY created_at DESC
            """,
        )
    return [_format_conflict(row) for row in rows]


def resolve_conflict(conn: Connection, conflict_id: str, resolution_strategy: str) -> dict | None:
    conflict = execute_fetchone(
        conn,
        """
        SELECT id, local_event_id, remote_id, strategy, detail_json, resolved, resolved_at, resolution_strategy, created_at
        FROM calendar_sync_conflicts
        WHERE id = ?
        """,
        (conflict_id,),
    )
    if conflict is None:
        return None

    if bool(conflict.get("resolved")):
        return _format_conflict(conflict)

    strategy = resolution_strategy.strip().lower()
    if strategy not in {"local_wins", "remote_wins", "dismiss"}:
        raise ValueError("Unsupported conflict resolution strategy")

    local_event_id = conflict.get("local_event_id")
    remote_id = str(conflict["remote_id"])

    if strategy == "local_wins":
        if local_event_id:
            local = execute_fetchone(
                conn,
                """
                SELECT id, title, starts_at, ends_at, etag, deleted
                FROM calendar_events
                WHERE id = ?
                """,
                (local_event_id,),
            )
            if local is not None:
                local_etag = _etag(str(local["title"]), str(local["starts_at"]), str(local["ends_at"]))
                _upsert_remote_mirror(
                    conn,
                    remote_id=remote_id,
                    title=str(local["title"]),
                    starts_at=str(local["starts_at"]),
                    ends_at=str(local["ends_at"]),
                    etag=local_etag,
                    deleted=bool(local["deleted"]),
                )
    elif strategy == "remote_wins":
        remote = execute_fetchone(
            conn,
            """
            SELECT remote_id, title, starts_at, ends_at, etag, deleted, deleted_at, updated_at
            FROM google_remote_events
            WHERE remote_id = ?
            """,
            (remote_id,),
        )
        if remote is not None and local_event_id:
            if bool(remote["deleted"]):
                conn.execute(
                    """
                    UPDATE calendar_events
                    SET deleted = 1, deleted_at = ?, source = ?, etag = ?, updated_at = ?
                    WHERE id = ?
                    """,
                    (
                        remote.get("deleted_at") or remote["updated_at"],
                        "google",
                        remote["etag"],
                        remote["updated_at"],
                        local_event_id,
                    ),
                )
            else:
                conn.execute(
                    """
                    UPDATE calendar_events
                    SET title = ?, starts_at = ?, ends_at = ?, source = ?, etag = ?, deleted = 0, deleted_at = NULL, updated_at = ?
                    WHERE id = ?
                    """,
                    (
                        remote["title"],
                        remote["starts_at"],
                        remote["ends_at"],
                        "google",
                        remote["etag"],
                        remote["updated_at"],
                        local_event_id,
                    ),
                )

    resolved_at = utc_now().isoformat()
    conn.execute(
        """
        UPDATE calendar_sync_conflicts
        SET resolved = 1, resolved_at = ?, resolution_strategy = ?
        WHERE id = ?
        """,
        (resolved_at, strategy, conflict_id),
    )
    events_service.emit(
        conn,
        "calendar.sync_conflict_resolved",
        {"conflict_id": conflict_id, "resolution_strategy": strategy},
    )
    conn.commit()

    updated = execute_fetchone(
        conn,
        """
        SELECT id, local_event_id, remote_id, strategy, detail_json, resolved, resolved_at, resolution_strategy, created_at
        FROM calendar_sync_conflicts
        WHERE id = ?
        """,
        (conflict_id,),
    )
    if updated is None:
        raise RuntimeError("Conflict resolution update failed")
    return _format_conflict(updated)


def replay_conflict(conn: Connection, conflict_id: str) -> dict | None:
    conflict = execute_fetchone(
        conn,
        """
        SELECT id, local_event_id, remote_id, strategy, detail_json, resolved, resolved_at, resolution_strategy, created_at
        FROM calendar_sync_conflicts
        WHERE id = ?
        """,
        (conflict_id,),
    )
    if conflict is None:
        return None

    remote_id = str(conflict["remote_id"])
    local_event_id = conflict.get("local_event_id")
    sync_result = run_two_way_sync(conn)
    refreshed = execute_fetchone(
        conn,
        """
        SELECT id, local_event_id, remote_id, strategy, detail_json, resolved, resolved_at, resolution_strategy, created_at
        FROM calendar_sync_conflicts
        WHERE remote_id = ?
          AND (? IS NULL OR local_event_id = ?)
          AND resolved = 0
        ORDER BY created_at DESC
        LIMIT 1
        """,
        (remote_id, local_event_id, local_event_id),
    )
    events_service.emit(
        conn,
        "calendar.sync_conflict_replayed",
        {"conflict_id": conflict_id, "remote_id": remote_id, "sync_run_id": sync_result["run_id"]},
    )
    conn.commit()
    return {
        "sync_run": sync_result,
        "conflict": _format_conflict(refreshed) if refreshed is not None else None,
    }
