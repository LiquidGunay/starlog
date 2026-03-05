import json
from sqlite3 import Connection
from urllib.parse import urlparse

from app.core.security import (
    decrypt_sensitive_config,
    encrypt_sensitive_config,
    redact_sensitive_config,
    secrets_encryption_mode,
)
from app.core.time import utc_now
from app.services import events_service
from app.services.common import execute_fetchall, execute_fetchone, new_id


def _decoded_config(row: dict) -> dict:
    config = row.get("config_json")
    if not isinstance(config, dict):
        return {}
    return decrypt_sensitive_config(config)


def _response_config(row: dict) -> dict:
    return redact_sensitive_config(_decoded_config(row))


def _contains_any(config: dict, keys: set[str]) -> bool:
    for key in keys:
        value = config.get(key)
        if isinstance(value, str) and value.strip():
            return True
    return False


def _valid_url(value: object) -> bool:
    if not isinstance(value, str) or not value.strip():
        return False
    parsed = urlparse(value)
    return parsed.scheme in {"http", "https"} and bool(parsed.netloc)


def _health_checks(provider_name: str, mode: str, config: dict) -> tuple[bool, list[str], dict[str, bool]]:
    checks: dict[str, bool] = {}
    problems: list[str] = []

    if mode.startswith("api"):
        has_credential = _contains_any(config, {"api_key", "access_token", "token"})
        checks["credential_present"] = has_credential
        if not has_credential:
            problems.append("missing API credentials")

    endpoint = config.get("endpoint") or config.get("base_url")
    if endpoint is not None:
        endpoint_ok = _valid_url(endpoint)
        checks["endpoint_valid"] = endpoint_ok
        if not endpoint_ok:
            problems.append("invalid endpoint URL")

    if provider_name == "google_calendar":
        source = str(config.get("source") or "")
        checks["source_present"] = bool(source)
        if not source:
            problems.append("missing source marker")
        if source == "google_oauth":
            has_access = isinstance(config.get("access_token"), str) and bool(str(config.get("access_token")).strip())
            checks["access_token_present"] = has_access
            if not has_access:
                problems.append("missing Google access token")

    if provider_name == "codex_bridge":
        has_bridge = _valid_url(config.get("bridge_url") or config.get("endpoint"))
        checks["bridge_url_valid"] = has_bridge
        if not has_bridge:
            problems.append("missing codex bridge URL")

    return len(problems) == 0, problems, checks


def upsert_provider_config(
    conn: Connection,
    provider_name: str,
    enabled: bool,
    mode: str,
    config: dict,
) -> dict:
    now = utc_now().isoformat()
    encrypted_config = encrypt_sensitive_config(config)
    existing = execute_fetchone(
        conn,
        "SELECT id FROM provider_configs WHERE provider_name = ?",
        (provider_name,),
    )

    if existing is None:
        conn.execute(
            """
            INSERT INTO provider_configs (id, provider_name, enabled, mode, config_json, updated_at)
            VALUES (?, ?, ?, ?, ?, ?)
            """,
            (new_id("prv"), provider_name, 1 if enabled else 0, mode, json.dumps(encrypted_config, sort_keys=True), now),
        )
    else:
        conn.execute(
            """
            UPDATE provider_configs
            SET enabled = ?, mode = ?, config_json = ?, updated_at = ?
            WHERE provider_name = ?
            """,
            (1 if enabled else 0, mode, json.dumps(encrypted_config, sort_keys=True), now, provider_name),
        )

    events_service.emit(
        conn,
        "provider.configured",
        {"provider_name": provider_name, "enabled": enabled, "mode": mode},
    )
    conn.commit()

    row = execute_fetchone(
        conn,
        "SELECT provider_name, enabled, mode, config_json, updated_at FROM provider_configs WHERE provider_name = ?",
        (provider_name,),
    )
    if row is None:
        raise RuntimeError("Provider config upsert failed")

    return {
        "provider_name": row["provider_name"],
        "enabled": bool(row["enabled"]),
        "mode": row["mode"],
        "config": _response_config(row),
        "updated_at": row["updated_at"],
    }


def list_provider_configs(conn: Connection) -> list[dict]:
    rows = execute_fetchall(
        conn,
        "SELECT provider_name, enabled, mode, config_json, updated_at FROM provider_configs ORDER BY provider_name ASC",
    )

    formatted: list[dict] = []
    for row in rows:
        formatted.append(
            {
                "provider_name": row["provider_name"],
                "enabled": bool(row["enabled"]),
                "mode": row["mode"],
                "config": _response_config(row),
                "updated_at": row["updated_at"],
            }
        )
    return formatted


def provider_health(conn: Connection, provider_name: str) -> dict:
    row = execute_fetchone(
        conn,
        "SELECT enabled, mode, config_json FROM provider_configs WHERE provider_name = ?",
        (provider_name,),
    )
    if row is None:
        return {
            "provider_name": provider_name,
            "healthy": False,
            "detail": "Provider is not configured",
        }

    enabled = bool(row["enabled"])
    mode = str(row["mode"])
    config = _decoded_config(row)

    if not enabled:
        return {
            "provider_name": provider_name,
            "healthy": False,
            "detail": "Provider is disabled",
            "checks": {"enabled": False},
            "secure_storage": secrets_encryption_mode(),
        }

    healthy, problems, checks = _health_checks(provider_name, mode, config)
    checks["enabled"] = True
    checks["config_present"] = bool(config)
    checks["secure_storage_configured"] = secrets_encryption_mode() == "configured"

    if healthy:
        detail = f"Configured in {mode} mode"
        if config:
            detail += " with config keys: " + ", ".join(sorted(config.keys()))
    else:
        detail = "Health check failed: " + ", ".join(problems)

    return {
        "provider_name": provider_name,
        "healthy": healthy,
        "detail": detail,
        "checks": checks,
        "secure_storage": secrets_encryption_mode(),
    }
