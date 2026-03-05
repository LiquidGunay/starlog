from datetime import timedelta
from sqlite3 import Connection

from app.core.time import utc_now
from app.services import events_service
from app.services.common import execute_fetchall, execute_fetchone, new_id


def due_cards(conn: Connection, limit: int) -> list[dict]:
    now = utc_now().isoformat()
    return execute_fetchall(
        conn,
        """
        SELECT id, card_set_version_id, artifact_id, note_block_id, card_type, prompt, answer,
               due_at, interval_days, repetitions, ease_factor, created_at
        FROM cards
        WHERE due_at <= ?
        ORDER BY due_at ASC
        LIMIT ?
        """,
        (now, limit),
    )


def review_card(conn: Connection, card_id: str, rating: int, latency_ms: int | None) -> dict | None:
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
        "UPDATE cards SET due_at = ?, interval_days = ?, repetitions = ?, ease_factor = ? WHERE id = ?",
        (next_due.isoformat(), interval, repetitions, ease, card_id),
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
