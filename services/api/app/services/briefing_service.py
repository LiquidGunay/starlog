from __future__ import annotations

from sqlite3 import Connection
from typing import Any

from app.core.time import utc_now
from app.services import ai_jobs_service, events_service, integrations_service, memory_service
from app.services.common import execute_fetchall, execute_fetchone, new_id


def _task_focus(conn: Connection) -> list[dict[str, Any]]:
    tasks = execute_fetchall(
        conn,
        """
        SELECT id, title, status, due_at
        FROM tasks
        ORDER BY priority DESC, COALESCE(due_at, '9999') ASC
        LIMIT 5
        """,
    )
    return tasks


def _calendar_blocks(conn: Connection, date: str) -> list[dict[str, Any]]:
    return execute_fetchall(
        conn,
        """
        SELECT id, title, starts_at, ends_at
        FROM calendar_events
        WHERE starts_at LIKE ? AND deleted = 0
        ORDER BY starts_at ASC
        LIMIT 5
        """,
        (f"{date}%",),
    )


def _review_pressure(conn: Connection) -> tuple[int, list[dict[str, Any]]]:
    cards_due = conn.execute(
        "SELECT COUNT(*) FROM cards WHERE due_at <= ?",
        (utc_now().isoformat(),),
    ).fetchone()[0]
    cards = execute_fetchall(
        conn,
        """
        SELECT id, prompt, due_at
        FROM cards
        WHERE due_at <= ?
        ORDER BY due_at ASC
        LIMIT 5
        """,
        (utc_now().isoformat(),),
    )
    return int(cards_due), cards


def _latest_research_digest(conn: Connection, date: str) -> dict[str, Any] | None:
    return execute_fetchone(
        conn,
        """
        SELECT *
        FROM research_digests
        WHERE digest_date <= ?
        ORDER BY digest_date DESC, created_at DESC
        LIMIT 1
        """,
        (date,),
    )


def _briefing_sections(
    *,
    date: str,
    tasks: list[dict[str, Any]],
    events: list[dict[str, Any]],
    due_cards: list[dict[str, Any]],
    research_digest: dict[str, Any] | None,
) -> tuple[list[dict[str, Any]], list[dict[str, Any]]]:
    sections: list[dict[str, Any]] = []
    source_refs: list[dict[str, Any]] = []

    task_items = [
        {
            "label": item["title"],
            "detail": f"Status: {item['status']}" + (f" | Due: {item['due_at']}" if item.get("due_at") else ""),
            "metadata": {"task_id": str(item["id"])},
        }
        for item in tasks
    ]
    sections.append(
        {
            "kind": "tasks",
            "title": "Task focus",
            "summary": f"{len(tasks)} priority items surfaced" if tasks else "No tasks queued yet",
            "items": task_items,
        }
    )
    source_refs.extend(
        {
            "entity_type": "task",
            "entity_id": str(item["id"]),
            "label": item["title"],
            "detail": item["status"],
            "metadata": {"due_at": str(item.get("due_at") or "")},
        }
        for item in tasks
    )

    event_items = [
        {
            "label": item["title"],
            "detail": f"{item['starts_at']} -> {item['ends_at']}",
            "metadata": {"calendar_event_id": str(item["id"])},
        }
        for item in events
    ]
    sections.append(
        {
            "kind": "calendar",
            "title": "Schedule blocks",
            "summary": f"{len(events)} calendar blocks on {date}" if events else "No calendar blocks scheduled",
            "items": event_items,
        }
    )
    source_refs.extend(
        {
            "entity_type": "calendar_event",
            "entity_id": str(item["id"]),
            "label": item["title"],
            "detail": str(item["starts_at"]),
            "metadata": {"ends_at": str(item["ends_at"])},
        }
        for item in events
    )

    review_items = [
        {
            "label": item["prompt"],
            "detail": f"Due: {item['due_at']}",
            "metadata": {"card_id": str(item["id"])},
        }
        for item in due_cards
    ]
    sections.append(
        {
            "kind": "review",
            "title": "Review pressure",
            "summary": f"{len(due_cards)} cards highlighted from the due queue" if due_cards else "No cards due right now",
            "items": review_items,
        }
    )
    source_refs.extend(
        {
            "entity_type": "card",
            "entity_id": str(item["id"]),
            "label": item["prompt"],
            "detail": str(item["due_at"]),
            "metadata": {},
        }
        for item in due_cards
    )

    if research_digest is not None:
        digest_items = [
            {
                "label": str(item.get("title") or item.get("id") or "Research item"),
                "detail": str(item.get("summary") or item.get("note") or item.get("url") or ""),
                "metadata": {"research_item_id": str(item.get("id") or "")},
            }
            for item in list(research_digest.get("items_json") or [])[:5]
            if isinstance(item, dict)
        ]
        sections.append(
            {
                "kind": "research",
                "title": "Research digest",
                "summary": str(research_digest["title"]),
                "items": digest_items,
            }
        )
        source_refs.append(
            {
                "entity_type": "research_digest",
                "entity_id": str(research_digest["id"]),
                "label": str(research_digest["title"]),
                "detail": str(research_digest["digest_date"]),
                "metadata": {"provider": str(research_digest["provider"])},
            }
        )

    return sections, source_refs


def _build_brief_text(
    *,
    date: str,
    headline: str,
    sections: list[dict[str, Any]],
    recent_memories: list[dict[str, Any]],
) -> str:
    lines = [headline, ""]
    for section in sections:
        lines.append(f"{section['title']}:")
        items = section.get("items") or []
        if items:
            for item in items:
                detail = f" ({item['detail']})" if item.get("detail") else ""
                lines.append(f"- {item['label']}{detail}")
        else:
            lines.append(f"- {section['summary']}")
        lines.append("")

    if recent_memories:
        lines.append("Recent memory cues:")
        for item in recent_memories[:3]:
            lines.append(f"- {item['content']}")
        lines.append("")

    lines.append(f"Close the loop on the highest-priority item for {date} first.")
    return "\n".join(lines)


def _record_briefing_signals(
    conn: Connection,
    *,
    briefing_id: str,
    tasks: list[dict[str, Any]],
    events: list[dict[str, Any]],
    due_cards: list[dict[str, Any]],
    research_digest: dict[str, Any] | None,
) -> None:
    for item in tasks:
        memory_service.record_recommendation_event(
            conn,
            surface="briefing",
            signal_type="briefing_focus",
            entity_type="task",
            entity_id=str(item["id"]),
            weight=1.5,
            metadata={"briefing_id": briefing_id, "status": str(item["status"])},
            commit=False,
        )
    for item in events:
        memory_service.record_recommendation_event(
            conn,
            surface="briefing",
            signal_type="briefing_schedule",
            entity_type="calendar_event",
            entity_id=str(item["id"]),
            weight=1.0,
            metadata={"briefing_id": briefing_id, "starts_at": str(item["starts_at"])},
            commit=False,
        )
    for item in due_cards:
        memory_service.record_recommendation_event(
            conn,
            surface="briefing",
            signal_type="briefing_review",
            entity_type="card",
            entity_id=str(item["id"]),
            weight=0.75,
            metadata={"briefing_id": briefing_id, "due_at": str(item["due_at"])},
            commit=False,
        )
    if research_digest is not None:
        memory_service.record_recommendation_event(
            conn,
            surface="briefing",
            signal_type="briefing_research",
            entity_type="research_digest",
            entity_id=str(research_digest["id"]),
            weight=1.0,
            metadata={"briefing_id": briefing_id, "digest_date": str(research_digest["digest_date"])},
            commit=False,
        )


def _briefing_payload(conn: Connection, row: dict[str, Any]) -> dict[str, Any]:
    tasks = _task_focus(conn)
    events = _calendar_blocks(conn, str(row["date"]))
    cards_due_count, due_cards = _review_pressure(conn)
    research_digest = _latest_research_digest(conn, str(row["date"]))
    recent_memories = memory_service.list_memory_entries(conn, limit=3)
    recommendation_hints = memory_service.list_recommendation_hints(conn, surface="briefing", limit=8)
    sections, source_refs = _briefing_sections(
        date=str(row["date"]),
        tasks=tasks,
        events=events,
        due_cards=due_cards,
        research_digest=research_digest,
    )
    headline = f"Starlog Briefing for {row['date']}"
    return {
        **row,
        "headline": headline,
        "text": row["text"],
        "sections": sections,
        "recent_memories": recent_memories,
        "recommendation_hints": recommendation_hints,
        "source_refs": source_refs
        + [
            {
                "entity_type": "review_queue",
                "entity_id": str(row["date"]),
                "label": "Review queue",
                "detail": f"{cards_due_count} cards due",
                "metadata": {},
            }
        ],
    }


def generate_briefing(conn: Connection, date: str, provider: str) -> dict:
    package_id = new_id("brf")
    tasks = _task_focus(conn)
    events = _calendar_blocks(conn, date)
    cards_due_count, due_cards = _review_pressure(conn)
    research_digest = _latest_research_digest(conn, date)
    prior_memories = memory_service.list_memory_entries(conn, limit=3)
    headline = f"Starlog Briefing for {date}"
    sections, source_refs = _briefing_sections(
        date=date,
        tasks=tasks,
        events=events,
        due_cards=due_cards,
        research_digest=research_digest,
    )
    text = _build_brief_text(date=date, headline=headline, sections=sections, recent_memories=prior_memories)
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
    memory_service.create_memory_entry(
        conn,
        entry_type="briefing_summary",
        content=f"{headline}: {sections[0]['summary'] if sections else 'No sections generated'}",
        metadata={
            "briefing_id": package_id,
            "date": date,
            "source_refs": source_refs,
            "cards_due_count": cards_due_count,
        },
        commit=False,
    )
    _record_briefing_signals(
        conn,
        briefing_id=package_id,
        tasks=tasks,
        events=events,
        due_cards=due_cards,
        research_digest=research_digest,
    )
    conn.commit()

    briefing = get_briefing_by_id(conn, package_id)
    if briefing is None:
        raise RuntimeError("Briefing generation failed")
    return briefing


def get_briefing_by_id(conn: Connection, package_id: str) -> dict | None:
    row = execute_fetchone(conn, "SELECT * FROM briefing_packages WHERE id = ?", (package_id,))
    if row is None:
        return None
    return _briefing_payload(conn, row)


def get_latest_briefing_for_date(conn: Connection, date: str) -> dict | None:
    row = execute_fetchone(
        conn,
        "SELECT * FROM briefing_packages WHERE date = ? ORDER BY created_at DESC LIMIT 1",
        (date,),
    )
    if row is None:
        return None
    return _briefing_payload(conn, row)


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
        or "desktop_bridge_tts"
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
        requested_targets=integrations_service.capability_execution_order(
            conn,
            "tts",
            executable_targets={"mobile_bridge", "desktop_bridge", "api"},
            prefer_local=True,
        ),
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
