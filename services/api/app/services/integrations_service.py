import json
from sqlite3 import Connection

from app.core.time import utc_now
from app.services import events_service
from app.services.common import execute_fetchall, execute_fetchone, new_id


def upsert_provider_config(
    conn: Connection,
    provider_name: str,
    enabled: bool,
    mode: str,
    config: dict,
) -> dict:
    now = utc_now().isoformat()
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
            (new_id("prv"), provider_name, 1 if enabled else 0, mode, json.dumps(config, sort_keys=True), now),
        )
    else:
        conn.execute(
            """
            UPDATE provider_configs
            SET enabled = ?, mode = ?, config_json = ?, updated_at = ?
            WHERE provider_name = ?
            """,
            (1 if enabled else 0, mode, json.dumps(config, sort_keys=True), now, provider_name),
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
        "config": row["config_json"],
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
                "config": row["config_json"],
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
    config = row["config_json"] if isinstance(row["config_json"], dict) else {}

    if not enabled:
        return {
            "provider_name": provider_name,
            "healthy": False,
            "detail": "Provider is disabled",
        }

    detail = f"Configured in {mode} mode"
    if config:
        detail += " with config keys: " + ", ".join(sorted(config.keys()))

    return {
        "provider_name": provider_name,
        "healthy": True,
        "detail": detail,
    }
