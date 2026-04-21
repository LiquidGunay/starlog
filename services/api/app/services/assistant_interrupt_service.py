from __future__ import annotations

from sqlite3 import Connection
from typing import Any

from app.services import assistant_run_service


def submit_interrupt(conn: Connection, *, interrupt_id: str, values: dict[str, Any]) -> dict[str, Any]:
    return assistant_run_service.submit_interrupt(conn, interrupt_id=interrupt_id, values=values)


def dismiss_interrupt(conn: Connection, *, interrupt_id: str) -> dict[str, Any]:
    return assistant_run_service.dismiss_interrupt(conn, interrupt_id=interrupt_id)
