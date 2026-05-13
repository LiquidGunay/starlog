import json
from sqlite3 import Connection, IntegrityError
from typing import Any

from app.core.time import utc_now
from app.services import events_service
from app.services.common import execute_fetchall, execute_fetchone, new_id


def _json(payload: dict[str, Any] | None) -> str:
    return json.dumps(payload or {}, sort_keys=True)


def _format_source(row: dict) -> dict:
    payload = dict(row)
    payload["metadata"] = payload.pop("metadata_json", {})
    return payload


def _format_topic(row: dict) -> dict:
    payload = dict(row)
    payload["status"] = payload.pop("progress_status", None) or "locked"
    payload["manually_unlocked"] = bool(payload.pop("progress_manually_unlocked", 0))
    payload["unlocked_at"] = payload.pop("progress_unlocked_at", None)
    payload["read_at"] = payload.pop("progress_read_at", None)
    return payload


def _format_chunk(row: dict) -> dict:
    payload = dict(row)
    payload["metadata"] = payload.pop("metadata_json", {})
    return payload


def _format_link(row: dict) -> dict:
    payload = dict(row)
    payload["gate_required"] = bool(payload.get("gate_required", 1))
    return payload


def _format_practice_item(row: dict) -> dict:
    payload = dict(row)
    payload["metadata"] = payload.pop("metadata_json", {})
    return payload


def _format_practice_attempt(row: dict) -> dict:
    payload = dict(row)
    payload["metadata"] = payload.pop("metadata_json", {})
    payload["correct"] = None if payload.get("correct") is None else bool(payload["correct"])
    return payload


def _format_question_request(row: dict) -> dict:
    payload = dict(row)
    payload["response"] = payload.pop("response_json", {})
    return payload


def _topic_select_sql(where_clause: str) -> str:
    return f"""
        SELECT
          t.id,
          t.source_id,
          t.parent_topic_id,
          t.title,
          t.summary,
          t.display_order,
          COALESCE(p.status, 'locked') AS progress_status,
          COALESCE(p.manually_unlocked, 0) AS progress_manually_unlocked,
          p.unlocked_at AS progress_unlocked_at,
          p.read_at AS progress_read_at,
          t.created_at,
          t.updated_at
        FROM study_topics t
        LEFT JOIN study_topic_progress p ON p.topic_id = t.id
        WHERE {where_clause}
    """


def _ensure_source(conn: Connection, source_id: str) -> dict:
    source = execute_fetchone(conn, "SELECT * FROM study_sources WHERE id = ?", (source_id,))
    if source is None:
        raise LookupError("Study source not found")
    return source


def _ensure_topic(conn: Connection, topic_id: str) -> dict:
    topic = execute_fetchone(conn, "SELECT * FROM study_topics WHERE id = ?", (topic_id,))
    if topic is None:
        raise LookupError("Study topic not found")
    return topic


def create_source(
    conn: Connection,
    *,
    title: str,
    source_type: str,
    artifact_id: str | None,
    url: str | None,
    metadata: dict[str, Any] | None,
) -> dict:
    now = utc_now().isoformat()
    source_id = new_id("study_src")
    conn.execute(
        """
        INSERT INTO study_sources (id, title, source_type, artifact_id, url, metadata_json, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        """,
        (source_id, title.strip(), source_type.strip(), artifact_id, url, _json(metadata), now, now),
    )
    conn.commit()
    row = execute_fetchone(conn, "SELECT * FROM study_sources WHERE id = ?", (source_id,))
    if row is None:
        raise RuntimeError("Study source creation failed")
    return _format_source(row)


def list_sources(conn: Connection, *, limit: int) -> list[dict]:
    rows = execute_fetchall(
        conn,
        """
        SELECT *
        FROM study_sources
        ORDER BY updated_at DESC, created_at DESC
        LIMIT ?
        """,
        (limit,),
    )
    return [_format_source(row) for row in rows]


def create_topic(
    conn: Connection,
    *,
    source_id: str,
    parent_topic_id: str | None,
    title: str,
    summary: str | None,
    display_order: int,
) -> dict:
    _ensure_source(conn, source_id)
    if parent_topic_id:
        parent = _ensure_topic(conn, parent_topic_id)
        if parent["source_id"] != source_id:
            raise ValueError("Parent topic must belong to the same study source")
    now = utc_now().isoformat()
    topic_id = new_id("study_topic")
    conn.execute(
        """
        INSERT INTO study_topics (id, source_id, parent_topic_id, title, summary, display_order, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        """,
        (topic_id, source_id, parent_topic_id, title.strip(), summary, display_order, now, now),
    )
    conn.commit()
    topic = execute_fetchone(conn, _topic_select_sql("t.id = ?"), (topic_id,))
    if topic is None:
        raise RuntimeError("Study topic creation failed")
    return _format_topic(topic)


def list_topics(conn: Connection, *, source_id: str | None, limit: int) -> list[dict]:
    params: list[object] = []
    where = "1 = 1"
    if source_id:
        where = "t.source_id = ?"
        params.append(source_id)
    params.append(limit)
    rows = execute_fetchall(
        conn,
        _topic_select_sql(where) + " ORDER BY t.source_id, t.display_order ASC, t.created_at ASC LIMIT ?",
        tuple(params),
    )
    return [_format_topic(row) for row in rows]


def get_topic(conn: Connection, topic_id: str) -> dict | None:
    row = execute_fetchone(conn, _topic_select_sql("t.id = ?"), (topic_id,))
    return _format_topic(row) if row else None


def unlock_topic(conn: Connection, topic_id: str) -> dict:
    _ensure_topic(conn, topic_id)
    now = utc_now().isoformat()
    progress = execute_fetchone(conn, "SELECT * FROM study_topic_progress WHERE topic_id = ?", (topic_id,))
    if progress and progress.get("read_at"):
        return get_topic(conn, topic_id) or {}
    conn.execute(
        """
        INSERT INTO study_topic_progress (
          topic_id, status, manually_unlocked, unlocked_at, read_at, created_at, updated_at
        )
        VALUES (?, 'unlocked', 1, ?, NULL, ?, ?)
        ON CONFLICT(topic_id) DO UPDATE SET
          status = CASE WHEN study_topic_progress.read_at IS NULL THEN 'unlocked' ELSE 'read' END,
          manually_unlocked = 1,
          unlocked_at = COALESCE(study_topic_progress.unlocked_at, excluded.unlocked_at),
          updated_at = excluded.updated_at
        """,
        (topic_id, now, now, now),
    )
    conn.commit()
    topic = get_topic(conn, topic_id)
    if topic is None:
        raise RuntimeError("Study topic unlock failed")
    events_service.emit(conn, "study.topic.unlocked", {"topic_id": topic_id, "source_id": topic["source_id"]})
    conn.commit()
    return topic


def mark_topic_read(conn: Connection, topic_id: str) -> dict:
    _ensure_topic(conn, topic_id)
    now = utc_now().isoformat()
    conn.execute(
        """
        INSERT INTO study_topic_progress (
          topic_id, status, manually_unlocked, unlocked_at, read_at, created_at, updated_at
        )
        VALUES (?, 'read', 0, ?, ?, ?, ?)
        ON CONFLICT(topic_id) DO UPDATE SET
          status = 'read',
          unlocked_at = COALESCE(study_topic_progress.unlocked_at, excluded.unlocked_at),
          read_at = excluded.read_at,
          updated_at = excluded.updated_at
        """,
        (topic_id, now, now, now, now),
    )
    conn.commit()
    topic = get_topic(conn, topic_id)
    if topic is None:
        raise RuntimeError("Study topic read failed")
    events_service.emit(
        conn,
        "study.topic.read",
        {"topic_id": topic_id, "source_id": topic["source_id"], "title": topic["title"]},
    )
    conn.commit()
    return topic


def create_source_chunk(
    conn: Connection,
    *,
    source_id: str,
    topic_id: str | None,
    artifact_id: str | None,
    chunk_index: int,
    content: str,
    metadata: dict[str, Any] | None,
) -> dict:
    _ensure_source(conn, source_id)
    if topic_id:
        topic = _ensure_topic(conn, topic_id)
        if topic["source_id"] != source_id:
            raise ValueError("Chunk topic must belong to the same study source")
    now = utc_now().isoformat()
    chunk_id = new_id("study_chunk")
    try:
        conn.execute(
            """
            INSERT INTO source_chunks (id, source_id, topic_id, artifact_id, chunk_index, content, metadata_json, created_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (chunk_id, source_id, topic_id, artifact_id, chunk_index, content.strip(), _json(metadata), now),
        )
        conn.commit()
    except IntegrityError as error:
        raise ValueError("Source chunk index already exists for this source") from error
    row = execute_fetchone(conn, "SELECT * FROM source_chunks WHERE id = ?", (chunk_id,))
    if row is None:
        raise RuntimeError("Source chunk creation failed")
    return _format_chunk(row)


def link_card_to_topic(conn: Connection, *, card_id: str, topic_id: str, gate_required: bool) -> dict:
    card = execute_fetchone(conn, "SELECT id FROM cards WHERE id = ?", (card_id,))
    if card is None:
        raise LookupError("Card not found")
    _ensure_topic(conn, topic_id)
    now = utc_now().isoformat()
    link_id = new_id("card_topic")
    conn.execute(
        """
        INSERT INTO card_topic_links (id, card_id, topic_id, gate_required, created_at)
        VALUES (?, ?, ?, ?, ?)
        ON CONFLICT(card_id, topic_id) DO UPDATE SET gate_required = excluded.gate_required
        """,
        (link_id, card_id, topic_id, 1 if gate_required else 0, now),
    )
    conn.commit()
    row = execute_fetchone(
        conn,
        "SELECT * FROM card_topic_links WHERE card_id = ? AND topic_id = ?",
        (card_id, topic_id),
    )
    if row is None:
        raise RuntimeError("Card topic link creation failed")
    return _format_link(row)


def create_practice_item(
    conn: Connection,
    *,
    source_id: str | None,
    topic_id: str | None,
    item_type: str,
    prompt: str,
    answer: str | None,
    metadata: dict[str, Any] | None,
) -> dict:
    if source_id:
        _ensure_source(conn, source_id)
    if topic_id:
        topic = _ensure_topic(conn, topic_id)
        if source_id and topic["source_id"] != source_id:
            raise ValueError("Practice item topic must belong to the same study source")
    now = utc_now().isoformat()
    item_id = new_id("practice")
    conn.execute(
        """
        INSERT INTO practice_items (id, source_id, topic_id, item_type, prompt, answer, metadata_json, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        """,
        (item_id, source_id, topic_id, item_type.strip(), prompt.strip(), answer, _json(metadata), now, now),
    )
    conn.commit()
    row = execute_fetchone(conn, "SELECT * FROM practice_items WHERE id = ?", (item_id,))
    if row is None:
        raise RuntimeError("Practice item creation failed")
    return _format_practice_item(row)


def create_practice_attempt(
    conn: Connection,
    *,
    practice_item_id: str | None,
    topic_id: str | None,
    rating: int | None,
    response_text: str | None,
    correct: bool | None,
    latency_ms: int | None,
    metadata: dict[str, Any] | None,
) -> dict:
    if not practice_item_id and not topic_id:
        raise ValueError("practice_item_id or topic_id is required")
    if practice_item_id:
        item = execute_fetchone(conn, "SELECT * FROM practice_items WHERE id = ?", (practice_item_id,))
        if item is None:
            raise LookupError("Practice item not found")
        if topic_id and item.get("topic_id") and item["topic_id"] != topic_id:
            raise ValueError("Attempt topic must match the practice item topic")
        topic_id = topic_id or item.get("topic_id")
    if topic_id:
        _ensure_topic(conn, topic_id)
    now = utc_now().isoformat()
    attempt_id = new_id("attempt")
    conn.execute(
        """
        INSERT INTO practice_attempts (
          id, practice_item_id, topic_id, rating, response_text, correct, latency_ms, metadata_json, attempted_at
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        """,
        (
            attempt_id,
            practice_item_id,
            topic_id,
            rating,
            response_text,
            None if correct is None else (1 if correct else 0),
            latency_ms,
            _json(metadata),
            now,
        ),
    )
    conn.commit()
    row = execute_fetchone(conn, "SELECT * FROM practice_attempts WHERE id = ?", (attempt_id,))
    if row is None:
        raise RuntimeError("Practice attempt creation failed")
    attempt = _format_practice_attempt(row)
    events_service.emit(
        conn,
        "practice.attempt.logged",
        {
            "attempt_id": attempt["id"],
            "practice_item_id": attempt.get("practice_item_id"),
            "topic_id": attempt.get("topic_id"),
            "rating": attempt.get("rating"),
            "correct": attempt.get("correct"),
        },
    )
    conn.commit()
    return attempt


def progress_summary(conn: Connection) -> dict:
    topic_counts = execute_fetchone(
        conn,
        """
        SELECT
          COUNT(*) AS topic_count,
          SUM(CASE WHEN COALESCE(p.read_at, '') != '' OR COALESCE(p.status, '') = 'read' THEN 1 ELSE 0 END) AS read_topic_count,
          SUM(
            CASE
              WHEN (COALESCE(p.read_at, '') = '' AND COALESCE(p.status, '') = 'unlocked')
              THEN 1
              ELSE 0
            END
          ) AS unlocked_topic_count
        FROM study_topics t
        LEFT JOIN study_topic_progress p ON p.topic_id = t.id
        """,
    ) or {}
    source_counts = execute_fetchone(conn, "SELECT COUNT(*) AS source_count FROM study_sources") or {}
    now = utc_now().isoformat()
    due_cards = execute_fetchone(
        conn,
        """
        SELECT COUNT(*) AS due_unlocked_card_count
        FROM cards c
        WHERE c.suspended = 0
          AND c.due_at <= ?
          AND EXISTS (SELECT 1 FROM card_topic_links ctl WHERE ctl.card_id = c.id)
          AND NOT EXISTS (
            SELECT 1
            FROM card_topic_links ctl
            LEFT JOIN study_topic_progress stp ON stp.topic_id = ctl.topic_id
            WHERE ctl.card_id = c.id
              AND ctl.gate_required = 1
              AND COALESCE(stp.read_at, '') = ''
              AND COALESCE(stp.status, '') != 'read'
          )
        """,
        (now,),
    ) or {}
    topic_count = int(topic_counts.get("topic_count") or 0)
    read_topic_count = int(topic_counts.get("read_topic_count") or 0)
    unlocked_topic_count = int(topic_counts.get("unlocked_topic_count") or 0)
    locked_topic_count = max(0, topic_count - read_topic_count - unlocked_topic_count)
    return {
        "source_count": int(source_counts.get("source_count") or 0),
        "topic_count": topic_count,
        "read_topic_count": read_topic_count,
        "unlocked_topic_count": unlocked_topic_count,
        "locked_topic_count": locked_topic_count,
        "due_unlocked_card_count": int(due_cards.get("due_unlocked_card_count") or 0),
    }


def create_question_request(
    conn: Connection,
    *,
    source_id: str | None,
    topic_id: str | None,
    question: str,
    status: str,
    response: dict[str, Any] | None,
) -> dict:
    if source_id:
        _ensure_source(conn, source_id)
    if topic_id:
        topic = _ensure_topic(conn, topic_id)
        if source_id and topic["source_id"] != source_id:
            raise ValueError("Question topic must belong to the same study source")
        source_id = source_id or topic["source_id"]
    now = utc_now().isoformat()
    request_id = new_id("study_question")
    conn.execute(
        """
        INSERT INTO study_question_requests (
          id, source_id, topic_id, question, status, response_json, created_at, updated_at
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        """,
        (request_id, source_id, topic_id, question.strip(), status.strip(), _json(response), now, now),
    )
    conn.commit()
    row = execute_fetchone(conn, "SELECT * FROM study_question_requests WHERE id = ?", (request_id,))
    if row is None:
        raise RuntimeError("Study question request creation failed")
    events_service.emit(
        conn,
        "study.question.requested",
        {"request_id": request_id, "topic_id": topic_id, "source_id": source_id, "question": question.strip()},
    )
    conn.commit()
    return _format_question_request(row)
