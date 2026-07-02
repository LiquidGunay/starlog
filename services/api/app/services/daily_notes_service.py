from datetime import date
from sqlite3 import Connection

from app.core.time import utc_now
from app.services import events_service
from app.services.common import execute_fetchall, execute_fetchone, new_id


def _daily_note_title(entry_date: date) -> str:
    return f"Daily {entry_date.isoformat()}"


def _daily_note_body(entry_date: date, morning_plan_md: str, evening_reflection_md: str) -> str:
    morning = morning_plan_md.strip()
    evening = evening_reflection_md.strip()
    return "\n".join(
        [
            f"# Daily {entry_date.isoformat()}",
            "",
            "## Morning plan",
            "",
            morning,
            "",
            "## Evening reflection",
            "",
            evening,
            "",
        ]
    )


def _select_daily_note_sql(where_clause: str) -> str:
    return f"""
        SELECT id, date, note_id, morning_plan_md, evening_reflection_md, version, created_at, updated_at
        FROM daily_notes
        WHERE {where_clause}
        """


def get_daily_note(conn: Connection, entry_date: date) -> dict | None:
    return execute_fetchone(
        conn,
        _select_daily_note_sql("date = ?"),
        (entry_date.isoformat(),),
    )


def list_daily_notes(conn: Connection, limit: int) -> list[dict]:
    return execute_fetchall(
        conn,
        """
        SELECT id, date, note_id, morning_plan_md, evening_reflection_md, version, created_at, updated_at
        FROM daily_notes
        ORDER BY date DESC
        LIMIT ?
        """,
        (limit,),
    )


def _create_linked_note(conn: Connection, entry_date: date, morning_plan_md: str, evening_reflection_md: str, now: str) -> str:
    note_id = new_id("nte")
    title = _daily_note_title(entry_date)
    body = _daily_note_body(entry_date, morning_plan_md, evening_reflection_md)
    conn.execute(
        "INSERT INTO notes (id, title, body_md, version, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)",
        (note_id, title, body, 1, now, now),
    )
    events_service.emit(conn, "note.created", {"note_id": note_id, "title": title})
    return note_id


def _sync_linked_note(
    conn: Connection,
    *,
    note_id: str,
    entry_date: date,
    morning_plan_md: str,
    evening_reflection_md: str,
    now: str,
) -> str:
    title = _daily_note_title(entry_date)
    body = _daily_note_body(entry_date, morning_plan_md, evening_reflection_md)
    existing_note = execute_fetchone(conn, "SELECT id, version FROM notes WHERE id = ?", (note_id,))
    if existing_note is None:
        return _create_linked_note(conn, entry_date, morning_plan_md, evening_reflection_md, now)

    conn.execute(
        """
        UPDATE notes
        SET title = ?, body_md = ?, version = version + 1, updated_at = ?
        WHERE id = ?
        """,
        (title, body, now, note_id),
    )
    events_service.emit(conn, "note.updated", {"note_id": note_id, "title": title})
    return note_id


def upsert_daily_note(
    conn: Connection,
    *,
    entry_date: date,
    morning_plan_md: str,
    evening_reflection_md: str,
) -> dict:
    now = utc_now().isoformat()
    existing = get_daily_note(conn, entry_date)

    if existing is None:
        note_id = _create_linked_note(conn, entry_date, morning_plan_md, evening_reflection_md, now)
        daily_note_id = new_id("dly")
        conn.execute(
            """
            INSERT INTO daily_notes (
              id, date, note_id, morning_plan_md, evening_reflection_md, version, created_at, updated_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                daily_note_id,
                entry_date.isoformat(),
                note_id,
                morning_plan_md,
                evening_reflection_md,
                1,
                now,
                now,
            ),
        )
        events_service.emit(
            conn,
            "daily_note.created",
            {"daily_note_id": daily_note_id, "date": entry_date.isoformat(), "note_id": note_id},
        )
    else:
        note_id = _sync_linked_note(
            conn,
            note_id=str(existing["note_id"]),
            entry_date=entry_date,
            morning_plan_md=morning_plan_md,
            evening_reflection_md=evening_reflection_md,
            now=now,
        )
        conn.execute(
            """
            UPDATE daily_notes
            SET note_id = ?, morning_plan_md = ?, evening_reflection_md = ?, version = version + 1, updated_at = ?
            WHERE date = ?
            """,
            (note_id, morning_plan_md, evening_reflection_md, now, entry_date.isoformat()),
        )
        events_service.emit(
            conn,
            "daily_note.updated",
            {"daily_note_id": existing["id"], "date": entry_date.isoformat(), "note_id": note_id},
        )

    conn.commit()
    saved = get_daily_note(conn, entry_date)
    if saved is None:
        raise RuntimeError("Daily note upsert failed")
    return saved
