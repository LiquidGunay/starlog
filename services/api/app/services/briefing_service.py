from sqlite3 import Connection

from app.core.time import utc_now
from app.services import events_service
from app.services.common import execute_fetchall, execute_fetchone, new_id


def _build_brief_text(conn: Connection, date: str) -> str:
    tasks = execute_fetchall(
        conn,
        "SELECT title, status, due_at FROM tasks ORDER BY priority DESC, COALESCE(due_at, '9999') ASC LIMIT 5",
    )
    cards_due = conn.execute(
        "SELECT COUNT(*) FROM cards WHERE due_at <= ?",
        (utc_now().isoformat(),),
    ).fetchone()[0]
    events = execute_fetchall(
        conn,
        """
        SELECT title, starts_at, ends_at
        FROM calendar_events
        WHERE starts_at LIKE ? AND deleted = 0
        ORDER BY starts_at ASC
        LIMIT 5
        """,
        (f"{date}%",),
    )

    task_lines = [f"- [{item['status']}] {item['title']}" for item in tasks] or ["- No tasks yet"]
    event_lines = [f"- {item['starts_at']} {item['title']}" for item in events] or ["- No events scheduled"]

    return "\n".join(
        [
            f"Starlog Morning Brief for {date}",
            "",
            "Top tasks:",
            *task_lines,
            "",
            "Calendar blocks:",
            *event_lines,
            "",
            f"Review queue due now: {cards_due}",
            "",
            "Reminder: open Starlog and run your first focused block.",
        ]
    )


def generate_briefing(conn: Connection, date: str, provider: str) -> dict:
    package_id = new_id("brf")
    text = _build_brief_text(conn, date)
    now = utc_now().isoformat()

    conn.execute(
        "INSERT INTO briefing_packages (id, date, text, audio_ref, generated_by_provider, created_at) VALUES (?, ?, ?, ?, ?, ?)",
        (package_id, date, text, None, provider, now),
    )
    events_service.emit(
        conn,
        "briefing.generated",
        {"briefing_id": package_id, "date": date, "provider": provider},
    )
    conn.commit()

    briefing = get_briefing_by_id(conn, package_id)
    if briefing is None:
        raise RuntimeError("Briefing generation failed")
    return briefing


def get_briefing_by_id(conn: Connection, package_id: str) -> dict | None:
    return execute_fetchone(conn, "SELECT * FROM briefing_packages WHERE id = ?", (package_id,))


def get_latest_briefing_for_date(conn: Connection, date: str) -> dict | None:
    return execute_fetchone(
        conn,
        "SELECT * FROM briefing_packages WHERE date = ? ORDER BY created_at DESC LIMIT 1",
        (date,),
    )


def create_alarm_plan(conn: Connection, trigger_at, briefing_package_id: str, device_target: str) -> dict:
    alarm_id = new_id("alm")
    now = utc_now().isoformat()
    conn.execute(
        "INSERT INTO alarm_plans (id, trigger_at, briefing_package_id, device_target, created_at) VALUES (?, ?, ?, ?, ?)",
        (alarm_id, trigger_at.isoformat(), briefing_package_id, device_target, now),
    )
    events_service.emit(
        conn,
        "alarm.created",
        {"alarm_id": alarm_id, "briefing_package_id": briefing_package_id, "device_target": device_target},
    )
    conn.commit()
    created = execute_fetchone(conn, "SELECT * FROM alarm_plans WHERE id = ?", (alarm_id,))
    if created is None:
        raise RuntimeError("Alarm plan creation failed")
    return created


def list_alarm_plans(conn: Connection) -> list[dict]:
    return execute_fetchall(conn, "SELECT * FROM alarm_plans ORDER BY trigger_at ASC")
