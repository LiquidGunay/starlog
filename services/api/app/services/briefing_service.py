from sqlite3 import Connection

from app.core.time import utc_now
from app.services import ai_jobs_service, events_service, integrations_service
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


def queue_briefing_audio_render(
    conn: Connection,
    briefing_package_id: str,
    provider_hint: str | None = None,
) -> dict:
    briefing = get_briefing_by_id(conn, briefing_package_id)
    if briefing is None:
        raise LookupError(f"Briefing not found: {briefing_package_id}")

    resolved_provider_hint = (
        provider_hint
        or integrations_service.default_batch_provider_hint(conn, "tts")
        or "piper_local"
    )
    return ai_jobs_service.create_job(
        conn,
        capability="tts",
        payload={
            "briefing_package_id": briefing_package_id,
            "title": f"Morning briefing {briefing['date']}",
            "text": str(briefing["text"]),
        },
        provider_hint=resolved_provider_hint,
        action="briefing_audio",
    )


def attach_audio_ref(
    conn: Connection,
    briefing_package_id: str,
    audio_ref: str,
    provider_used: str,
) -> dict | None:
    now = utc_now().isoformat()
    conn.execute(
        """
        UPDATE briefing_packages
        SET audio_ref = ?, generated_by_provider = ?
        WHERE id = ?
        """,
        (audio_ref, provider_used, briefing_package_id),
    )
    events_service.emit(
        conn,
        "briefing.audio_rendered",
        {
            "briefing_id": briefing_package_id,
            "audio_ref": audio_ref,
            "provider_used": provider_used,
            "recorded_at": now,
        },
    )
    conn.commit()
    return get_briefing_by_id(conn, briefing_package_id)


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
