import json
from datetime import datetime, timedelta
from sqlite3 import Connection, IntegrityError

from app.core.time import utc_now
from app.services import events_service
from app.services.common import execute_fetchall, execute_fetchone, iso, new_id

DEFAULT_DECK_NAME = "Inbox"
DEFAULT_SCHEDULE = {
    "new_cards_due_offset_hours": 24,
    "initial_interval_days": 1,
    "initial_ease_factor": 2.5,
}


def _normalize_schedule(schedule: dict | None) -> dict:
    payload = dict(DEFAULT_SCHEDULE)
    if schedule:
        payload.update({key: schedule[key] for key in DEFAULT_SCHEDULE if key in schedule and schedule[key] is not None})
    payload["new_cards_due_offset_hours"] = int(payload["new_cards_due_offset_hours"])
    payload["initial_interval_days"] = int(payload["initial_interval_days"])
    payload["initial_ease_factor"] = float(payload["initial_ease_factor"])
    return payload


def _normalize_tags(tags: list[str] | None) -> list[str]:
    if not tags:
        return []
    unique: list[str] = []
    seen: set[str] = set()
    for tag in tags:
        normalized = tag.strip().lower()
        if not normalized or normalized in seen:
            continue
        seen.add(normalized)
        unique.append(normalized)
    return unique


def _format_card(row: dict) -> dict:
    payload = dict(row)
    payload["tags"] = _normalize_tags(payload.pop("tags_json", []))
    payload["suspended"] = bool(payload.get("suspended", 0))
    return payload


def _format_deck(row: dict) -> dict:
    payload = dict(row)
    payload["schedule"] = _normalize_schedule(payload.pop("schedule_json", {}))
    payload["card_count"] = int(payload.get("card_count") or 0)
    payload["due_count"] = int(payload.get("due_count") or 0)
    return payload


def ensure_default_deck(conn: Connection) -> dict:
    existing = execute_fetchone(
        conn,
        """
        SELECT id, name, description, schedule_json, created_at, updated_at
        FROM card_decks
        WHERE name = ?
        """,
        (DEFAULT_DECK_NAME,),
    )
    if existing is None:
        now = utc_now().isoformat()
        deck_id = new_id("cdk")
        try:
            conn.execute(
                """
                INSERT INTO card_decks (id, name, description, schedule_json, created_at, updated_at)
                VALUES (?, ?, ?, ?, ?, ?)
                """,
                (
                    deck_id,
                    DEFAULT_DECK_NAME,
                    "Default deck for imported and generated cards.",
                    json.dumps(DEFAULT_SCHEDULE, sort_keys=True),
                    now,
                    now,
                ),
            )
            conn.commit()
        except IntegrityError:
            conn.rollback()
        existing = execute_fetchone(
            conn,
            """
            SELECT id, name, description, schedule_json, created_at, updated_at
            FROM card_decks
            WHERE id = ?
            """,
            (deck_id,),
        )
    if existing is None:
        raise RuntimeError("Default deck missing after creation")

    conn.execute("UPDATE cards SET deck_id = ? WHERE deck_id IS NULL", (existing["id"],))
    conn.commit()
    return _format_deck(existing)


def list_decks(conn: Connection) -> list[dict]:
    default_deck = ensure_default_deck(conn)
    rows = execute_fetchall(
        conn,
        """
        SELECT
          d.id,
          d.name,
          d.description,
          d.schedule_json,
          d.created_at,
          d.updated_at,
          COUNT(c.id) AS card_count,
          SUM(CASE WHEN c.suspended = 0 AND c.due_at <= ? THEN 1 ELSE 0 END) AS due_count
        FROM card_decks d
        LEFT JOIN cards c ON c.deck_id = d.id
        GROUP BY d.id
        ORDER BY CASE WHEN d.id = ? THEN 0 ELSE 1 END, d.updated_at DESC, d.created_at DESC
        """,
        (utc_now().isoformat(), default_deck["id"]),
    )
    return [_format_deck(row) for row in rows]


def create_deck(conn: Connection, name: str, description: str | None, schedule: dict | None) -> dict:
    ensure_default_deck(conn)
    now = utc_now().isoformat()
    deck_id = new_id("cdk")
    normalized_schedule = _normalize_schedule(schedule)
    try:
        conn.execute(
            """
            INSERT INTO card_decks (id, name, description, schedule_json, created_at, updated_at)
            VALUES (?, ?, ?, ?, ?, ?)
            """,
            (deck_id, name.strip(), description, json.dumps(normalized_schedule, sort_keys=True), now, now),
        )
        conn.commit()
    except IntegrityError as error:
        raise ValueError("Deck name already exists") from error
    created = execute_fetchone(
        conn,
        """
        SELECT id, name, description, schedule_json, created_at, updated_at
        FROM card_decks
        WHERE id = ?
        """,
        (deck_id,),
    )
    if created is None:
        raise RuntimeError("Deck creation failed")
    return _format_deck(created)


def update_deck(conn: Connection, deck_id: str, payload: dict) -> dict | None:
    ensure_default_deck(conn)
    deck = execute_fetchone(conn, "SELECT * FROM card_decks WHERE id = ?", (deck_id,))
    if deck is None:
        return None
    next_name = (payload.get("name") or deck["name"]).strip()
    next_description = payload["description"] if "description" in payload else deck.get("description")
    next_schedule = _normalize_schedule(payload.get("schedule") or deck.get("schedule_json"))
    updated_at = utc_now().isoformat()
    try:
        conn.execute(
            """
            UPDATE card_decks
            SET name = ?, description = ?, schedule_json = ?, updated_at = ?
            WHERE id = ?
            """,
            (next_name, next_description, json.dumps(next_schedule, sort_keys=True), updated_at, deck_id),
        )
        conn.commit()
    except IntegrityError as error:
        raise ValueError("Deck name already exists") from error
    updated = execute_fetchone(
        conn,
        """
        SELECT id, name, description, schedule_json, created_at, updated_at
        FROM card_decks
        WHERE id = ?
        """,
        (deck_id,),
    )
    return _format_deck(updated) if updated else None


def list_cards(conn: Connection, deck_id: str | None, tag: str | None, limit: int) -> list[dict]:
    default_deck = ensure_default_deck(conn)
    clauses = ["1 = 1"]
    params: list[object] = []
    effective_deck_id = deck_id if deck_id and deck_id != "all" else None
    if effective_deck_id:
        clauses.append("c.deck_id = ?")
        params.append(effective_deck_id)
    if tag:
        clauses.append("LOWER(c.tags_json) LIKE ?")
        params.append(f'%"{tag.strip().lower()}"%')
    params.append(limit)
    rows = execute_fetchall(
        conn,
        f"""
        SELECT
          c.id,
          c.card_set_version_id,
          c.artifact_id,
          c.note_block_id,
          COALESCE(c.deck_id, '{default_deck["id"]}') AS deck_id,
          c.card_type,
          c.prompt,
          c.answer,
          c.tags_json,
          c.suspended,
          c.due_at,
          c.interval_days,
          c.repetitions,
          c.ease_factor,
          c.created_at,
          c.updated_at
        FROM cards c
        WHERE {" AND ".join(clauses)}
        ORDER BY c.updated_at DESC, c.created_at DESC
        LIMIT ?
        """,
        tuple(params),
    )
    return [_format_card(row) for row in rows]


def _resolve_card_deck(conn: Connection, deck_id: str | None) -> dict:
    default_deck = ensure_default_deck(conn)
    if not deck_id:
        return default_deck
    deck = execute_fetchone(
        conn,
        """
        SELECT id, name, description, schedule_json, created_at, updated_at
        FROM card_decks
        WHERE id = ?
        """,
        (deck_id,),
    )
    if deck is None:
        raise ValueError("Deck not found")
    return _format_deck(deck)


def create_card(
    conn: Connection,
    *,
    prompt: str,
    answer: str,
    card_type: str,
    deck_id: str | None,
    tags: list[str] | None,
    due_at: datetime | None,
    interval_days: int | None,
    repetitions: int | None,
    ease_factor: float | None,
    suspended: bool,
    artifact_id: str | None,
    note_block_id: str | None,
) -> dict:
    deck = _resolve_card_deck(conn, deck_id)
    schedule = deck["schedule"]
    now = utc_now()
    now_iso = now.isoformat()
    effective_due_at = due_at or (now + timedelta(hours=int(schedule["new_cards_due_offset_hours"])))
    effective_interval_days = interval_days or int(schedule["initial_interval_days"])
    effective_repetitions = repetitions or 0
    effective_ease_factor = ease_factor or float(schedule["initial_ease_factor"])
    card_id = new_id("crd")
    conn.execute(
        """
        INSERT INTO cards (
          id, card_set_version_id, artifact_id, note_block_id, deck_id, card_type, prompt, answer,
          tags_json, suspended, due_at, interval_days, repetitions, ease_factor, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        """,
        (
            card_id,
            None,
            artifact_id,
            note_block_id,
            deck["id"],
            card_type,
            prompt.strip(),
            answer.strip(),
            json.dumps(_normalize_tags(tags), sort_keys=True),
            1 if suspended else 0,
            iso(effective_due_at),
            effective_interval_days,
            effective_repetitions,
            effective_ease_factor,
            now_iso,
            now_iso,
        ),
    )
    conn.commit()
    created = execute_fetchone(
        conn,
        """
        SELECT id, card_set_version_id, artifact_id, note_block_id, deck_id, card_type, prompt, answer,
               tags_json, suspended, due_at, interval_days, repetitions, ease_factor, created_at, updated_at
        FROM cards
        WHERE id = ?
        """,
        (card_id,),
    )
    if created is None:
        raise RuntimeError("Card creation failed")
    return _format_card(created)


def update_card(conn: Connection, card_id: str, payload: dict) -> dict | None:
    ensure_default_deck(conn)
    card = execute_fetchone(conn, "SELECT * FROM cards WHERE id = ?", (card_id,))
    if card is None:
        return None
    next_deck_id = card.get("deck_id")
    if "deck_id" in payload:
        next_deck_id = _resolve_card_deck(conn, payload.get("deck_id"))["id"]
    next_prompt = (payload.get("prompt") or card["prompt"]).strip()
    next_answer = (payload.get("answer") or card["answer"]).strip()
    next_tags = _normalize_tags(payload["tags"]) if "tags" in payload and payload["tags"] is not None else _normalize_tags(card.get("tags_json", []))
    if "due_at" in payload and payload["due_at"] is None:
        raise ValueError("due_at cannot be null")
    next_due_at = payload["due_at"] if "due_at" in payload else card["due_at"]
    next_interval_days = payload["interval_days"] if payload.get("interval_days") is not None else int(card["interval_days"])
    next_repetitions = payload["repetitions"] if payload.get("repetitions") is not None else int(card["repetitions"])
    next_ease_factor = payload["ease_factor"] if payload.get("ease_factor") is not None else float(card["ease_factor"])
    next_suspended = payload["suspended"] if payload.get("suspended") is not None else bool(card.get("suspended", 0))
    updated_at = utc_now().isoformat()
    conn.execute(
        """
        UPDATE cards
        SET prompt = ?, answer = ?, deck_id = ?, tags_json = ?, suspended = ?, due_at = ?,
            interval_days = ?, repetitions = ?, ease_factor = ?, updated_at = ?
        WHERE id = ?
        """,
        (
            next_prompt,
            next_answer,
            next_deck_id,
            json.dumps(next_tags, sort_keys=True),
            1 if next_suspended else 0,
            iso(next_due_at),
            next_interval_days,
            next_repetitions,
            next_ease_factor,
            updated_at,
            card_id,
        ),
    )
    conn.commit()
    updated = execute_fetchone(
        conn,
        """
        SELECT id, card_set_version_id, artifact_id, note_block_id, deck_id, card_type, prompt, answer,
               tags_json, suspended, due_at, interval_days, repetitions, ease_factor, created_at, updated_at
        FROM cards
        WHERE id = ?
        """,
        (card_id,),
    )
    return _format_card(updated) if updated else None


def due_cards(conn: Connection, limit: int) -> list[dict]:
    default_deck = ensure_default_deck(conn)
    now = utc_now().isoformat()
    rows = execute_fetchall(
        conn,
        f"""
        SELECT id, card_set_version_id, artifact_id, note_block_id, COALESCE(deck_id, '{default_deck["id"]}') AS deck_id,
               card_type, prompt, answer, tags_json, suspended, due_at, interval_days, repetitions, ease_factor,
               created_at, updated_at
        FROM cards
        WHERE suspended = 0 AND due_at <= ?
        ORDER BY due_at ASC
        LIMIT ?
        """,
        (now, limit),
    )
    return [_format_card(row) for row in rows]


def review_card(conn: Connection, card_id: str, rating: int, latency_ms: int | None) -> dict | None:
    ensure_default_deck(conn)
    card = execute_fetchone(conn, "SELECT * FROM cards WHERE id = ?", (card_id,))
    if card is None:
        return None

    repetitions = int(card["repetitions"])
    interval = int(card["interval_days"])
    ease = float(card["ease_factor"])

    if rating < 3:
        repetitions = 0
        interval = 1
    else:
        repetitions += 1
        if repetitions == 1:
            interval = 1
        elif repetitions == 2:
            interval = 6
        else:
            interval = max(1, round(interval * ease))

    ease = max(1.3, ease + (0.1 - (5 - rating) * (0.08 + (5 - rating) * 0.02)))
    next_due = utc_now() + timedelta(days=interval)

    conn.execute(
        "UPDATE cards SET due_at = ?, interval_days = ?, repetitions = ?, ease_factor = ?, updated_at = ? WHERE id = ?",
        (next_due.isoformat(), interval, repetitions, ease, utc_now().isoformat(), card_id),
    )
    conn.execute(
        "INSERT INTO review_events (id, card_id, rating, latency_ms, reviewed_at) VALUES (?, ?, ?, ?, ?)",
        (new_id("rev"), card_id, rating, latency_ms, utc_now().isoformat()),
    )
    events_service.emit(
        conn,
        "card.reviewed",
        {"card_id": card_id, "rating": rating, "interval_days": interval},
    )
    conn.commit()

    return {
        "card_id": card_id,
        "next_due_at": next_due.isoformat(),
        "interval_days": interval,
        "repetitions": repetitions,
        "ease_factor": ease,
    }
