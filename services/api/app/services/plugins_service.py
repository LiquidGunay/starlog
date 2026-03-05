import json
from sqlite3 import Connection

from app.core.time import utc_now
from app.services import events_service
from app.services.common import execute_fetchall, execute_fetchone, new_id


def register_plugin(
    conn: Connection,
    name: str,
    version: str,
    capabilities: list[str],
    manifest: dict,
) -> dict:
    now = utc_now().isoformat()
    existing = execute_fetchone(conn, "SELECT id FROM plugins WHERE name = ?", (name,))

    if existing is None:
        plugin_id = new_id("plg")
        conn.execute(
            """
            INSERT INTO plugins (id, name, version, capabilities_json, manifest_json, enabled, created_at, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                plugin_id,
                name,
                version,
                json.dumps(capabilities, sort_keys=True),
                json.dumps(manifest, sort_keys=True),
                1,
                now,
                now,
            ),
        )
    else:
        plugin_id = str(existing["id"])
        conn.execute(
            """
            UPDATE plugins
            SET version = ?, capabilities_json = ?, manifest_json = ?, updated_at = ?
            WHERE id = ?
            """,
            (
                version,
                json.dumps(capabilities, sort_keys=True),
                json.dumps(manifest, sort_keys=True),
                now,
                plugin_id,
            ),
        )

    events_service.emit(conn, "plugin.registered", {"plugin_name": name, "version": version})
    conn.commit()

    plugin = execute_fetchone(
        conn,
        "SELECT id, name, version, capabilities_json, manifest_json, enabled, created_at, updated_at FROM plugins WHERE id = ?",
        (plugin_id,),
    )
    if plugin is None:
        raise RuntimeError("Plugin registration failed")

    return {
        "id": plugin["id"],
        "name": plugin["name"],
        "version": plugin["version"],
        "capabilities": plugin["capabilities_json"],
        "manifest": plugin["manifest_json"],
        "enabled": bool(plugin["enabled"]),
        "created_at": plugin["created_at"],
        "updated_at": plugin["updated_at"],
    }


def list_plugins(conn: Connection) -> list[dict]:
    rows = execute_fetchall(
        conn,
        "SELECT id, name, version, capabilities_json, manifest_json, enabled, created_at, updated_at FROM plugins ORDER BY name ASC",
    )
    return [
        {
            "id": row["id"],
            "name": row["name"],
            "version": row["version"],
            "capabilities": row["capabilities_json"],
            "manifest": row["manifest_json"],
            "enabled": bool(row["enabled"]),
            "created_at": row["created_at"],
            "updated_at": row["updated_at"],
        }
        for row in rows
    ]
