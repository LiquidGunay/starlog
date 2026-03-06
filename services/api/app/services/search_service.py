from sqlite3 import Connection

from app.services.common import execute_fetchall


def _snippet(text: str, query: str, max_length: int = 180) -> str:
    normalized = text.strip()
    if not normalized:
        return ""

    index = normalized.lower().find(query.lower())
    if index < 0:
        return normalized[:max_length]

    start = max(index - 40, 0)
    end = min(start + max_length, len(normalized))
    return normalized[start:end]


def search(conn: Connection, query: str, limit: int) -> list[dict]:
    needle = f"%{query.lower()}%"
    results: list[dict] = []

    artifact_rows = execute_fetchall(
        conn,
        """
        SELECT id, COALESCE(title, id) AS title, COALESCE(normalized_content, extracted_content, raw_content, '') AS content,
               updated_at, source_type
        FROM artifacts
        WHERE lower(COALESCE(title, '')) LIKE ?
           OR lower(COALESCE(normalized_content, '')) LIKE ?
           OR lower(COALESCE(extracted_content, '')) LIKE ?
           OR lower(COALESCE(raw_content, '')) LIKE ?
        ORDER BY updated_at DESC
        LIMIT ?
        """,
        (needle, needle, needle, needle, limit),
    )
    for row in artifact_rows:
        results.append(
            {
                "kind": "artifact",
                "id": row["id"],
                "title": row["title"],
                "snippet": _snippet(str(row["content"]), query),
                "updated_at": row["updated_at"],
                "metadata": {"source_type": row["source_type"]},
            }
        )

    note_rows = execute_fetchall(
        conn,
        """
        SELECT id, title, body_md, version, updated_at
        FROM notes
        WHERE lower(title) LIKE ? OR lower(body_md) LIKE ?
        ORDER BY updated_at DESC
        LIMIT ?
        """,
        (needle, needle, limit),
    )
    for row in note_rows:
        results.append(
            {
                "kind": "note",
                "id": row["id"],
                "title": row["title"],
                "snippet": _snippet(str(row["body_md"]), query),
                "updated_at": row["updated_at"],
                "metadata": {"version": row.get("version", 1)},
            }
        )

    task_rows = execute_fetchall(
        conn,
        """
        SELECT id, title, status, due_at, updated_at
        FROM tasks
        WHERE lower(title) LIKE ?
        ORDER BY updated_at DESC
        LIMIT ?
        """,
        (needle, limit),
    )
    for row in task_rows:
        results.append(
            {
                "kind": "task",
                "id": row["id"],
                "title": row["title"],
                "snippet": f"Status: {row['status']}" + (f" | Due: {row['due_at']}" if row.get("due_at") else ""),
                "updated_at": row["updated_at"],
                "metadata": {"status": row["status"]},
            }
        )

    calendar_rows = execute_fetchall(
        conn,
        """
        SELECT id, title, starts_at, ends_at, updated_at
        FROM calendar_events
        WHERE deleted = 0 AND lower(title) LIKE ?
        ORDER BY updated_at DESC
        LIMIT ?
        """,
        (needle, limit),
    )
    for row in calendar_rows:
        results.append(
            {
                "kind": "calendar_event",
                "id": row["id"],
                "title": row["title"],
                "snippet": f"{row['starts_at']} -> {row['ends_at']}",
                "updated_at": row["updated_at"],
                "metadata": {"starts_at": row["starts_at"], "ends_at": row["ends_at"]},
            }
        )

    results.sort(key=lambda item: str(item["updated_at"]), reverse=True)
    return results[:limit]
