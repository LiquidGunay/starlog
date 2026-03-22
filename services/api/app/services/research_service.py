from __future__ import annotations

from datetime import date, datetime, timezone
import json
from sqlite3 import Connection
from typing import Any

from app.core.time import utc_now
from app.services.common import execute_fetchall, execute_fetchone, new_id
from app.services.research_adapters import build_default_adapters

DEFAULT_SOURCES = (
    ("arxiv", "arXiv"),
    ("manual_url", "Manual URL"),
    ("manual_pdf", "Manual PDF"),
)
ADAPTERS = build_default_adapters()
RESEARCH_DIGEST_PROVIDER = "heuristic_research_digest_v1"
RESEARCH_DEEP_SUMMARY_PROVIDER = "heuristic_research_deep_summary_v1"


def _json_object(raw: Any) -> dict[str, Any]:
    if isinstance(raw, dict):
        return raw
    if isinstance(raw, str) and raw:
        return json.loads(raw)
    return {}


def _json_list(raw: Any) -> list[Any]:
    if isinstance(raw, list):
        return raw
    if isinstance(raw, str) and raw:
        return json.loads(raw)
    return []


def _parse_iso_datetime(value: str | None) -> datetime | None:
    if not value:
        return None
    normalized = value.replace("Z", "+00:00")
    parsed = datetime.fromisoformat(normalized)
    if parsed.tzinfo is None:
        parsed = parsed.replace(tzinfo=timezone.utc)
    return parsed.astimezone(timezone.utc)


def _source_payload(row: dict) -> dict[str, Any]:
    return {
        "id": row["id"],
        "source_kind": row["source_kind"],
        "label": row["label"],
        "enabled": bool(row["enabled"]),
        "config": _json_object(row["config_json"]),
        "created_at": row["created_at"],
        "updated_at": row["updated_at"],
    }


def _item_payload(row: dict) -> dict[str, Any]:
    return {
        "id": row["id"],
        "source_id": row.get("source_id"),
        "external_id": row.get("external_id"),
        "title": row["title"],
        "url": row.get("url"),
        "authors": _json_list(row["authors_json"]),
        "abstract": row.get("abstract"),
        "published_at": row.get("published_at"),
        "content_artifact_id": row.get("content_artifact_id"),
        "metadata": _json_object(row["metadata_json"]),
        "created_at": row["created_at"],
        "updated_at": row["updated_at"],
    }


def _digest_payload(row: dict) -> dict[str, Any]:
    return {
        "id": row["id"],
        "digest_date": row["digest_date"],
        "title": row["title"],
        "summary_md": row["summary_md"],
        "items": _json_list(row["items_json"]),
        "provider": row["provider"],
        "created_at": row["created_at"],
    }


def ensure_default_sources(conn: Connection) -> None:
    now = utc_now().isoformat()
    for source_kind, label in DEFAULT_SOURCES:
        existing = execute_fetchone(conn, "SELECT * FROM research_sources WHERE source_kind = ?", (source_kind,))
        if existing is not None:
            continue
        conn.execute(
            """
            INSERT INTO research_sources (id, source_kind, label, enabled, config_json, created_at, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, ?)
            """,
            (new_id("rsrc"), source_kind, label, 1, json.dumps({}, sort_keys=True), now, now),
        )
    conn.commit()


def list_sources(conn: Connection) -> list[dict[str, Any]]:
    ensure_default_sources(conn)
    rows = execute_fetchall(conn, "SELECT * FROM research_sources ORDER BY label ASC")
    return [_source_payload(row) for row in rows]


def upsert_source(
    conn: Connection,
    *,
    source_kind: str,
    label: str,
    enabled: bool,
    config: dict[str, Any],
) -> dict[str, Any]:
    existing = execute_fetchone(conn, "SELECT * FROM research_sources WHERE source_kind = ?", (source_kind,))
    now = utc_now().isoformat()
    if existing is None:
        source_id = new_id("rsrc")
        conn.execute(
            """
            INSERT INTO research_sources (id, source_kind, label, enabled, config_json, created_at, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, ?)
            """,
            (source_id, source_kind, label, 1 if enabled else 0, json.dumps(config, sort_keys=True), now, now),
        )
    else:
        source_id = str(existing["id"])
        conn.execute(
            """
            UPDATE research_sources
            SET label = ?, enabled = ?, config_json = ?, updated_at = ?
            WHERE id = ?
            """,
            (label, 1 if enabled else 0, json.dumps(config, sort_keys=True), now, source_id),
        )
    conn.commit()
    row = execute_fetchone(conn, "SELECT * FROM research_sources WHERE id = ?", (source_id,))
    if row is None:
        raise RuntimeError("Research source save failed")
    return _source_payload(row)


def _source_id(conn: Connection, source_kind: str) -> str:
    ensure_default_sources(conn)
    row = execute_fetchone(conn, "SELECT id FROM research_sources WHERE source_kind = ?", (source_kind,))
    if row is None:
        raise LookupError(f"Research source not found: {source_kind}")
    return str(row["id"])


def list_items(conn: Connection, limit: int = 50) -> list[dict[str, Any]]:
    rows = execute_fetchall(
        conn,
        "SELECT * FROM research_items ORDER BY updated_at DESC LIMIT ?",
        (limit,),
    )
    return [_item_payload(row) for row in rows]


def get_item(conn: Connection, item_id: str) -> dict[str, Any] | None:
    row = execute_fetchone(conn, "SELECT * FROM research_items WHERE id = ?", (item_id,))
    if row is None:
        return None
    return _item_payload(row)


def list_digests(conn: Connection, limit: int = 20) -> list[dict[str, Any]]:
    rows = execute_fetchall(
        conn,
        "SELECT * FROM research_digests ORDER BY digest_date DESC, created_at DESC LIMIT ?",
        (limit,),
    )
    return [_digest_payload(row) for row in rows]


def record_manual_url(
    conn: Connection,
    *,
    title: str | None,
    url: str,
    notes: str | None,
) -> dict[str, Any]:
    ensure_default_sources(conn)
    item_id = ADAPTERS["manual_url"].ingest(conn, {"title": title, "url": url, "notes": notes})
    row = execute_fetchone(conn, "SELECT * FROM research_items WHERE id = ?", (item_id,))
    if row is None:
        raise RuntimeError("Manual research URL ingest failed")
    return _item_payload(row)


def record_manual_pdf(
    conn: Connection,
    *,
    media_id: str,
    title: str | None,
    notes: str | None,
) -> dict[str, Any]:
    ensure_default_sources(conn)
    item_id = ADAPTERS["manual_pdf"].ingest(
        conn,
        {"media_id": media_id, "title": title, "notes": notes},
    )
    row = execute_fetchone(conn, "SELECT * FROM research_items WHERE id = ?", (item_id,))
    if row is None:
        raise RuntimeError("Manual research PDF ingest failed")
    return _item_payload(row)


def record_arxiv_entry(
    conn: Connection,
    *,
    arxiv_id: str | None,
    url: str | None,
    title: str | None,
    notes: str | None,
) -> dict[str, Any]:
    ensure_default_sources(conn)
    item_id = ADAPTERS["arxiv"].ingest(
        conn,
        {
            "arxiv_id": arxiv_id,
            "url": url,
            "title": title,
            "notes": notes,
        },
    )
    row = execute_fetchone(conn, "SELECT * FROM research_items WHERE id = ?", (item_id,))
    if row is None:
        raise RuntimeError("arXiv research ingest failed")
    return _item_payload(row)


def _candidate_items(conn: Connection, source_kind: str | None, limit: int) -> list[dict[str, Any]]:
    if source_kind:
        source_id = _source_id(conn, source_kind)
        rows = execute_fetchall(
            conn,
            "SELECT * FROM research_items WHERE source_id = ? ORDER BY updated_at DESC LIMIT ?",
            (source_id, limit * 4),
        )
    else:
        rows = execute_fetchall(
            conn,
            "SELECT * FROM research_items ORDER BY updated_at DESC LIMIT ?",
            (limit * 4,),
        )
    return [_item_payload(row) for row in rows]


def _ranking_details(item: dict[str, Any]) -> tuple[float, list[str]]:
    score = 1.0
    reasons: list[str] = []
    source_kind = str(item.get("metadata", {}).get("source_kind") or "")
    if source_kind == "arxiv":
        score += 3.0
        reasons.append("arXiv adapter ingest")
    if item.get("abstract"):
        score += 1.5
        reasons.append("has abstract text")
    author_count = len(item.get("authors") or [])
    if author_count:
        score += min(author_count, 4) * 0.2
        reasons.append(f"{author_count} author(s)")

    published_at = _parse_iso_datetime(item.get("published_at"))
    updated_at = _parse_iso_datetime(item.get("updated_at"))
    reference_time = published_at or updated_at
    if reference_time is not None:
        age_days = max((utc_now() - reference_time).days, 0)
        freshness = max(0.0, 30.0 - min(age_days, 30)) / 10.0
        if freshness > 0:
            score += freshness
            reasons.append(f"recent ({age_days} day(s) old)")
    return round(score, 3), reasons


def generate_digest(
    conn: Connection,
    *,
    digest_date: date | None = None,
    limit: int = 10,
    source_kind: str | None = None,
    title: str | None = None,
) -> dict[str, Any]:
    resolved_date = (digest_date or utc_now().date()).isoformat()
    candidates = _candidate_items(conn, source_kind, limit)
    ranked = []
    for item in candidates:
        score, reasons = _ranking_details(item)
        ranked.append(
            {
                "item": item,
                "score": score,
                "reasons": reasons,
            }
        )
    ranked.sort(
        key=lambda entry: (
            entry["score"],
            entry["item"].get("published_at") or entry["item"].get("updated_at") or "",
        ),
        reverse=True,
    )
    selected = ranked[:limit]
    resolved_title = title or f"Research digest for {resolved_date}"
    summary_lines = [
        f"# {resolved_title}",
        "",
        f"Selected {len(selected)} item(s) from {len(candidates)} candidate(s).",
        "",
    ]
    digest_items: list[dict[str, Any]] = []
    for index, entry in enumerate(selected, start=1):
        item = entry["item"]
        digest_items.append(
            {
                "id": item["id"],
                "title": item["title"],
                "url": item.get("url"),
                "score": entry["score"],
                "reasons": entry["reasons"],
                "published_at": item.get("published_at"),
                "source_kind": item.get("metadata", {}).get("source_kind"),
            }
        )
        summary_lines.extend(
            [
                f"{index}. **{item['title']}**",
                f"   - Score: {entry['score']}",
                f"   - Why it surfaced: {', '.join(entry['reasons']) or 'available research item'}",
            ]
        )
        if item.get("authors"):
            summary_lines.append(f"   - Authors: {', '.join(item['authors'])}")
        if item.get("abstract"):
            summary_lines.append(f"   - Abstract: {item['abstract']}")
        if item.get("url"):
            summary_lines.append(f"   - Link: {item['url']}")
        summary_lines.append("")

    now = utc_now().isoformat()
    digest_id = new_id("rdig")
    conn.execute(
        """
        INSERT INTO research_digests (id, digest_date, title, summary_md, items_json, provider, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?)
        """,
        (
            digest_id,
            resolved_date,
            resolved_title,
            "\n".join(summary_lines).strip(),
            json.dumps(digest_items, sort_keys=True),
            RESEARCH_DIGEST_PROVIDER,
            now,
        ),
    )
    conn.commit()
    row = execute_fetchone(conn, "SELECT * FROM research_digests WHERE id = ?", (digest_id,))
    if row is None:
        raise RuntimeError("Research digest generation failed")
    return _digest_payload(row)


def generate_deep_summary(
    conn: Connection,
    *,
    item_id: str,
    focus: str | None,
) -> dict[str, Any]:
    item = get_item(conn, item_id)
    if item is None:
        raise LookupError(f"Research item not found: {item_id}")
    summary_lines = [
        f"## Deep summary: {item['title']}",
        "",
        f"- Source: {item.get('metadata', {}).get('source_kind', 'unknown')}",
    ]
    if focus:
        summary_lines.append(f"- Requested focus: {focus}")
    if item.get("authors"):
        summary_lines.append(f"- Authors: {', '.join(item['authors'])}")
    if item.get("published_at"):
        summary_lines.append(f"- Published: {item['published_at']}")
    if item.get("abstract"):
        summary_lines.extend(
            [
                "",
                "### Core abstract",
                item["abstract"],
            ]
        )
    if item.get("url"):
        summary_lines.extend(["", f"Source link: {item['url']}"])
    return {
        "item_id": item["id"],
        "title": item["title"],
        "summary_md": "\n".join(summary_lines).strip(),
        "provider": RESEARCH_DEEP_SUMMARY_PROVIDER,
        "context": {
            "focus": focus,
            "source_kind": item.get("metadata", {}).get("source_kind"),
            "published_at": item.get("published_at"),
        },
    }
