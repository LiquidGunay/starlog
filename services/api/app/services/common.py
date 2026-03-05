import json
import uuid
from datetime import datetime
from sqlite3 import Connection, Row


def new_id(prefix: str) -> str:
    return f"{prefix}_{uuid.uuid4().hex}"


def row_dict(row: Row) -> dict:
    payload: dict[str, object] = {}
    for key in row.keys():
        value = row[key]
        if isinstance(value, str) and key.endswith("_json"):
            payload[key] = json.loads(value)
        else:
            payload[key] = value
    return payload


def execute_fetchall(conn: Connection, sql: str, params: tuple = ()) -> list[dict]:
    cursor = conn.execute(sql, params)
    rows = cursor.fetchall()
    return [row_dict(row) for row in rows]


def execute_fetchone(conn: Connection, sql: str, params: tuple = ()) -> dict | None:
    cursor = conn.execute(sql, params)
    row = cursor.fetchone()
    return row_dict(row) if row is not None else None


def iso(dt: datetime | str | None) -> str | None:
    if dt is None:
        return None
    if isinstance(dt, str):
        return dt
    return dt.isoformat()
