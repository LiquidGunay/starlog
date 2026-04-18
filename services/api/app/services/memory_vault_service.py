from __future__ import annotations

import json
import re
from datetime import datetime, timedelta, timezone
from sqlite3 import Connection
from typing import Any

from app.core.time import utc_now
from app.services import conflict_service, events_service
from app.services.common import execute_fetchall, execute_fetchone, new_id

WIKI_NAMESPACES = {
    "wiki/projects",
    "wiki/concepts",
    "wiki/sources",
    "wiki/people",
    "wiki/decisions",
    "wiki/questions",
}
PROFILE_NAMESPACES = {
    "profile/goals",
    "profile/preferences",
    "profile/habits",
    "profile/constraints",
    "profile/learning",
}
ALLOWED_NAMESPACES = WIKI_NAMESPACES | PROFILE_NAMESPACES | {f"archive/{item}" for item in WIKI_NAMESPACES | PROFILE_NAMESPACES}
ALLOWED_STATUSES = {"active", "cooling", "archived"}
DEFAULT_CONFIDENCE = 0.6
RELEVANT_PAST_CLIP_MAX_AGE_DAYS = 120
COOLING_AFTER_DAYS = 21
ARCHIVE_AFTER_DAYS = 90
CHUNK_WORD_LIMIT = 120
CHUNK_STEP = 90
PATH_PATTERN = re.compile(r"^[a-z0-9/_\-.]+$")
WORD_PATTERN = re.compile(r"[a-z0-9]{4,}")
EXPLICIT_PATH_PATTERN = re.compile(r"\b(?:wiki|profile|archive)/[a-z0-9/_\-.]+\.md\b")


def _slugify(value: str) -> str:
    slug = re.sub(r"[^a-z0-9]+", "-", value.lower()).strip("-")
    return slug or "untitled"


def _json_or_default(value: object, default: object) -> object:
    if value is None:
        return default
    return value


def _parse_scalar(value: str) -> Any:
    text = value.strip()
    if not text:
        return ""
    if text in {"true", "false"}:
        return text == "true"
    if text == "null":
        return None
    if text.startswith("{") or text.startswith("[") or text.startswith('"'):
        return json.loads(text)
    if re.fullmatch(r"-?\d+", text):
        return int(text)
    if re.fullmatch(r"-?\d+\.\d+", text):
        return float(text)
    return text


def parse_markdown_source(markdown_source: str) -> tuple[dict[str, Any], str]:
    text = str(markdown_source or "")
    if not text.startswith("---\n"):
        raise ValueError("Markdown pages must start with frontmatter")

    marker = "\n---\n"
    end = text.find(marker, 4)
    if end < 0:
        raise ValueError("Markdown pages must include a closing frontmatter marker")

    header = text[4:end]
    body = text[end + len(marker) :]
    frontmatter: dict[str, Any] = {}
    for raw_line in header.splitlines():
        line = raw_line.strip()
        if not line:
            continue
        if ":" not in line:
            raise ValueError(f"Invalid frontmatter line: {raw_line}")
        key, raw_value = line.split(":", 1)
        frontmatter[key.strip()] = _parse_scalar(raw_value)
    return frontmatter, body.lstrip("\n")


def _frontmatter_line(key: str, value: Any) -> str:
    if isinstance(value, (dict, list)):
        rendered = json.dumps(value, sort_keys=True)
    elif isinstance(value, bool):
        rendered = "true" if value else "false"
    elif value is None:
        rendered = "null"
    else:
        rendered = str(value)
    return f"{key}: {rendered}"


def render_markdown_source(frontmatter: dict[str, Any], body_md: str) -> str:
    lines = ["---"]
    ordered_keys = [
        "id",
        "kind",
        "namespace",
        "status",
        "title",
        "tags",
        "source_refs",
        "entity_refs",
        "edge_refs",
        "confidence",
        "created_at",
        "updated_at",
        "last_activated_at",
        "review_after",
        "archived_at",
    ]
    for key in ordered_keys:
        lines.append(_frontmatter_line(key, frontmatter.get(key)))
    lines.append("---")
    lines.append("")
    if body_md:
        lines.append(body_md.rstrip())
    return "\n".join(lines).rstrip() + "\n"


def _validate_namespace(namespace: str, *, allow_profile: bool, allow_archive: bool = True) -> str:
    normalized = namespace.strip().strip("/")
    if normalized in WIKI_NAMESPACES:
        return normalized
    if allow_profile and normalized in PROFILE_NAMESPACES:
        return normalized
    if allow_archive and normalized in {f"archive/{item}" for item in WIKI_NAMESPACES | PROFILE_NAMESPACES}:
        return normalized
    raise ValueError(f"Unsupported memory namespace: {namespace}")


def _normalize_path(namespace: str, title: str, path: str | None) -> str:
    candidate = (path or f"{namespace}/{_slugify(title)}.md").strip().strip("/")
    if not candidate.endswith(".md"):
        candidate = f"{candidate}.md"
    if not candidate.startswith(f"{namespace}/"):
        candidate = f"{namespace}/{candidate.split('/')[-1]}"
    if not PATH_PATTERN.fullmatch(candidate):
        raise ValueError(f"Unsupported memory path: {candidate}")
    return candidate


def _normalize_refs(raw: object) -> list[dict[str, Any]]:
    if not isinstance(raw, list):
        return []
    output: list[dict[str, Any]] = []
    for item in raw:
        if not isinstance(item, dict):
            continue
        normalized = {str(key): value for key, value in item.items() if value is not None}
        if normalized:
            output.append(normalized)
    return output


def _resolve_archive_namespace(namespace: str, status: str) -> str:
    if status != "archived":
        return namespace.removeprefix("archive/") if namespace.startswith("archive/") else namespace
    return namespace if namespace.startswith("archive/") else f"archive/{namespace}"


def _normalize_frontmatter(
    frontmatter: dict[str, Any],
    *,
    page_id: str,
    title: str,
    kind: str,
    namespace: str,
    status: str,
    created_at: str,
    updated_at: str,
    path: str,
    last_activated_at: str | None = None,
    review_after: str | None = None,
    archived_at: str | None = None,
) -> dict[str, Any]:
    tags = frontmatter.get("tags")
    source_refs = frontmatter.get("source_refs")
    entity_refs = frontmatter.get("entity_refs")
    edge_refs = frontmatter.get("edge_refs")
    confidence = float(frontmatter.get("confidence") or DEFAULT_CONFIDENCE)
    normalized_status = status if status in ALLOWED_STATUSES else "active"
    effective_namespace = _resolve_archive_namespace(namespace, normalized_status)
    effective_path = _normalize_path(effective_namespace, title, path)
    effective_archived_at = archived_at if normalized_status == "archived" else None
    return {
        "id": page_id,
        "kind": kind,
        "namespace": effective_namespace,
        "status": normalized_status,
        "title": title,
        "tags": [str(item) for item in tags] if isinstance(tags, list) else [],
        "source_refs": _normalize_refs(source_refs),
        "entity_refs": _normalize_refs(entity_refs),
        "edge_refs": _normalize_refs(edge_refs),
        "confidence": max(0.0, min(confidence, 1.0)),
        "created_at": created_at,
        "updated_at": updated_at,
        "last_activated_at": last_activated_at,
        "review_after": review_after,
        "archived_at": effective_archived_at,
        "path": effective_path,
    }


def _page_from_row(row: dict[str, Any], *, markdown_source: str | None = None, body_md: str | None = None) -> dict[str, Any]:
    frontmatter = dict(row.get("frontmatter_json") or {})
    if "path" not in frontmatter:
        frontmatter["path"] = row["path"]
    return {
        "id": row["id"],
        "path": row["path"],
        "title": row["title"],
        "kind": row["kind"],
        "namespace": row["namespace"],
        "status": row["status"],
        "confidence": float(row["confidence"]),
        "latest_version": int(row["latest_version"]),
        "created_at": row["created_at"],
        "updated_at": row["updated_at"],
        "last_activated_at": row.get("last_activated_at"),
        "review_after": row.get("review_after"),
        "archived_at": row.get("archived_at"),
        "frontmatter": frontmatter,
        "markdown_source": markdown_source,
        "body_md": body_md,
    }


def _edge_payload(row: dict[str, Any]) -> dict[str, Any]:
    return {
        "id": row["id"],
        "source_page_id": row["source_page_id"],
        "relation_type": row["relation_type"],
        "target_type": row["target_type"],
        "target_id": row["target_id"],
        "metadata": row.get("metadata_json") or {},
        "created_at": row["created_at"],
        "updated_at": row["updated_at"],
    }


def _page_body_version(conn: Connection, page_id: str, version: int | None = None) -> dict[str, Any] | None:
    if version is None:
        return execute_fetchone(
            conn,
            """
            SELECT id, page_id, version, markdown_source, frontmatter_json, body_md, created_at
            FROM memory_page_versions
            WHERE page_id = ?
            ORDER BY version DESC
            LIMIT 1
            """,
            (page_id,),
        )
    return execute_fetchone(
        conn,
        """
        SELECT id, page_id, version, markdown_source, frontmatter_json, body_md, created_at
        FROM memory_page_versions
        WHERE page_id = ? AND version = ?
        """,
        (page_id, version),
    )


def _page_keywords(*parts: str) -> set[str]:
    output: set[str] = set()
    for part in parts:
        output.update(WORD_PATTERN.findall(part.lower()))
    return output


def _word_chunk(text: str) -> list[str]:
    words = text.split()
    if not words:
        return []
    if len(words) <= CHUNK_WORD_LIMIT:
        return [" ".join(words)]
    chunks: list[str] = []
    start = 0
    while start < len(words):
        chunks.append(" ".join(words[start : start + CHUNK_WORD_LIMIT]))
        if start + CHUNK_WORD_LIMIT >= len(words):
            break
        start += CHUNK_STEP
    return chunks


def record_activation(
    conn: Connection,
    *,
    page_id: str | None,
    source_type: str,
    source_id: str,
    event_type: str,
    weight: float = 1.0,
    metadata: dict[str, Any] | None = None,
    commit: bool = True,
) -> dict[str, Any]:
    event_id = new_id("mact")
    now = utc_now().isoformat()
    conn.execute(
        """
        INSERT INTO memory_activation_events (id, page_id, source_type, source_id, event_type, weight, metadata_json, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        """,
        (
            event_id,
            page_id,
            source_type,
            source_id,
            event_type,
            float(weight),
            json.dumps(metadata or {}, sort_keys=True),
            now,
        ),
    )
    if page_id:
        conn.execute(
            "UPDATE memory_pages SET last_activated_at = ? WHERE id = ?",
            (now, page_id),
        )
    if commit:
        conn.commit()
    return {
        "id": event_id,
        "page_id": page_id,
        "source_type": source_type,
        "source_id": source_id,
        "event_type": event_type,
        "weight": float(weight),
        "metadata": metadata or {},
        "created_at": now,
    }


def _replace_chunks(
    conn: Connection,
    *,
    source_type: str,
    source_id: str,
    page_id: str | None,
    status: str,
    text: str,
) -> None:
    conn.execute("DELETE FROM memory_chunks WHERE source_type = ? AND source_id = ?", (source_type, source_id))
    for index, chunk in enumerate(_word_chunk(text)):
        conn.execute(
            """
            INSERT INTO memory_chunks (id, page_id, source_type, source_id, chunk_index, status, content, created_at, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                new_id("mchk"),
                page_id,
                source_type,
                source_id,
                index,
                status,
                chunk,
                utc_now().isoformat(),
                utc_now().isoformat(),
            ),
        )


def index_artifact_capture(conn: Connection, artifact: dict[str, Any], *, commit: bool = True) -> None:
    text = str(
        artifact.get("extracted_content")
        or artifact.get("normalized_content")
        or artifact.get("raw_content")
        or ""
    ).strip()
    if not text:
        return
    _replace_chunks(
        conn,
        source_type="artifact",
        source_id=str(artifact["id"]),
        page_id=None,
        status="active",
        text=text,
    )
    if commit:
        conn.commit()


def _resolve_page_target(conn: Connection, target: str) -> str | None:
    direct = execute_fetchone(conn, "SELECT id FROM memory_pages WHERE id = ?", (target,))
    if direct is not None:
        return str(direct["id"])
    by_path = execute_fetchone(conn, "SELECT id FROM memory_pages WHERE path = ?", (target,))
    if by_path is not None:
        return str(by_path["id"])
    return None


def _replace_edges(
    conn: Connection,
    *,
    page_id: str,
    source_refs: list[dict[str, Any]],
    entity_refs: list[dict[str, Any]],
    edge_refs: list[dict[str, Any]],
) -> None:
    conn.execute("DELETE FROM memory_edges WHERE source_page_id = ?", (page_id,))
    now = utc_now().isoformat()
    synthesized: list[tuple[str, str, str, dict[str, Any]]] = []
    for item in source_refs:
        entity_type = str(item.get("entity_type") or item.get("target_type") or "").strip()
        entity_id = str(item.get("entity_id") or item.get("target_id") or "").strip()
        if entity_type and entity_id:
            synthesized.append(("derived_from", entity_type, entity_id, item))
    for item in entity_refs:
        entity_type = str(item.get("entity_type") or item.get("target_type") or "").strip()
        entity_id = str(item.get("entity_id") or item.get("target_id") or "").strip()
        if entity_type and entity_id:
            synthesized.append(("references", entity_type, entity_id, item))
    for item in edge_refs:
        relation_type = str(item.get("relation_type") or "related_to").strip() or "related_to"
        target_type = str(item.get("target_type") or "").strip()
        target_id = str(item.get("target_id") or "").strip()
        if target_type and target_id:
            synthesized.append((relation_type, target_type, target_id, item))

    for relation_type, target_type, target_id, metadata in synthesized:
        resolved_target_id = target_id
        if target_type == "page":
            maybe_page_id = _resolve_page_target(conn, target_id)
            if maybe_page_id is not None:
                resolved_target_id = maybe_page_id
        conn.execute(
            """
            INSERT INTO memory_edges (
              id, source_page_id, relation_type, target_type, target_id, metadata_json, created_at, updated_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                new_id("medg"),
                page_id,
                relation_type,
                target_type,
                resolved_target_id,
                json.dumps(metadata, sort_keys=True),
                now,
                now,
            ),
        )


def _assert_unique_path(conn: Connection, path: str, *, exclude_page_id: str | None = None) -> None:
    row = execute_fetchone(conn, "SELECT id FROM memory_pages WHERE path = ?", (path,))
    if row is None:
        return
    if exclude_page_id and str(row["id"]) == exclude_page_id:
        return
    raise ValueError(f"Memory path already exists: {path}")


def _build_frontmatter(
    *,
    page_id: str,
    title: str,
    kind: str,
    namespace: str,
    path: str,
    status: str,
    tags: list[str],
    source_refs: list[dict[str, Any]],
    entity_refs: list[dict[str, Any]],
    edge_refs: list[dict[str, Any]],
    confidence: float,
    created_at: str,
    updated_at: str,
    last_activated_at: str | None = None,
    review_after: str | None = None,
    archived_at: str | None = None,
) -> dict[str, Any]:
    return _normalize_frontmatter(
        {
            "tags": tags,
            "source_refs": source_refs,
            "entity_refs": entity_refs,
            "edge_refs": edge_refs,
            "confidence": confidence,
        },
        page_id=page_id,
        title=title,
        kind=kind,
        namespace=namespace,
        status=status,
        created_at=created_at,
        updated_at=updated_at,
        path=path,
        last_activated_at=last_activated_at,
        review_after=review_after,
        archived_at=archived_at,
    )


def create_page(
    conn: Connection,
    *,
    title: str,
    body_md: str,
    kind: str,
    namespace: str,
    path: str | None = None,
    tags: list[str] | None = None,
    source_refs: list[dict[str, Any]] | None = None,
    entity_refs: list[dict[str, Any]] | None = None,
    edge_refs: list[dict[str, Any]] | None = None,
    confidence: float = DEFAULT_CONFIDENCE,
    status: str = "active",
    review_after: str | None = None,
    allow_profile: bool = False,
    commit: bool = True,
) -> dict[str, Any]:
    normalized_namespace = _validate_namespace(namespace, allow_profile=allow_profile, allow_archive=False)
    now = utc_now().isoformat()
    page_id = new_id("mpg")
    normalized_path = _normalize_path(normalized_namespace, title, path)
    _assert_unique_path(conn, normalized_path)
    normalized_frontmatter = _build_frontmatter(
        page_id=page_id,
        title=title.strip() or "Untitled",
        kind=kind.strip() or "page",
        namespace=normalized_namespace,
        path=normalized_path,
        status=status,
        tags=[str(item) for item in (tags or [])],
        source_refs=_normalize_refs(source_refs),
        entity_refs=_normalize_refs(entity_refs),
        edge_refs=_normalize_refs(edge_refs),
        confidence=confidence,
        created_at=now,
        updated_at=now,
        review_after=review_after,
    )
    markdown_source = render_markdown_source(normalized_frontmatter, body_md)
    conn.execute(
        """
        INSERT INTO memory_pages (
          id, path, title, kind, namespace, status, confidence, latest_version, frontmatter_json,
          created_at, updated_at, last_activated_at, review_after, archived_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        """,
        (
            page_id,
            normalized_frontmatter["path"],
            normalized_frontmatter["title"],
            normalized_frontmatter["kind"],
            normalized_frontmatter["namespace"],
            normalized_frontmatter["status"],
            normalized_frontmatter["confidence"],
            1,
            json.dumps(normalized_frontmatter, sort_keys=True),
            now,
            now,
            normalized_frontmatter["last_activated_at"],
            normalized_frontmatter["review_after"],
            normalized_frontmatter["archived_at"],
        ),
    )
    conn.execute(
        """
        INSERT INTO memory_page_versions (id, page_id, version, markdown_source, frontmatter_json, body_md, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?)
        """,
        (
            new_id("mpv"),
            page_id,
            1,
            markdown_source,
            json.dumps(normalized_frontmatter, sort_keys=True),
            body_md,
            now,
        ),
    )
    _replace_edges(
        conn,
        page_id=page_id,
        source_refs=normalized_frontmatter["source_refs"],
        entity_refs=normalized_frontmatter["entity_refs"],
        edge_refs=normalized_frontmatter["edge_refs"],
    )
    _replace_chunks(
        conn,
        source_type="page",
        source_id=page_id,
        page_id=page_id,
        status=normalized_frontmatter["status"],
        text=f"{normalized_frontmatter['title']}\n\n{body_md}",
    )
    record_activation(
        conn,
        page_id=page_id,
        source_type="page",
        source_id=page_id,
        event_type="page_created",
        weight=1.0,
        metadata={"path": normalized_frontmatter["path"]},
        commit=False,
    )
    events_service.emit(
        conn,
        "memory.page_created",
        {"page_id": page_id, "path": normalized_frontmatter["path"], "namespace": normalized_frontmatter["namespace"]},
    )
    if commit:
        conn.commit()
    created = get_page(conn, page_id, record_access=False)
    if created is None:
        raise RuntimeError("Memory page creation failed")
    return created


def _update_page_from_frontmatter(
    conn: Connection,
    current: dict[str, Any],
    *,
    body_md: str,
    frontmatter: dict[str, Any],
    activate: bool = True,
    commit: bool = True,
) -> dict[str, Any]:
    latest_version = int(current["latest_version"]) + 1
    created_at = str(current["created_at"])
    current_frontmatter = dict(current.get("frontmatter_json") or {})
    normalized_status = str(frontmatter.get("status") or current["status"] or "active")
    if normalized_status not in ALLOWED_STATUSES:
        normalized_status = "active"
    requested_namespace = _validate_namespace(
        str(frontmatter.get("namespace") or current["namespace"]),
        allow_profile=True,
        allow_archive=True,
    )
    effective_namespace = _resolve_archive_namespace(requested_namespace, normalized_status)
    requested_path = str(frontmatter.get("path") or current["path"])
    normalized_path = _normalize_path(effective_namespace, str(frontmatter.get("title") or current["title"]), requested_path)
    _assert_unique_path(conn, normalized_path, exclude_page_id=str(current["id"]))
    now = utc_now().isoformat()
    archived_at = frontmatter.get("archived_at")
    if normalized_status == "archived":
        archived_at = str(archived_at or current.get("archived_at") or now)
    else:
        archived_at = None
    normalized_frontmatter = _normalize_frontmatter(
        {
            **current_frontmatter,
            **frontmatter,
        },
        page_id=str(current["id"]),
        title=str(frontmatter.get("title") or current["title"]),
        kind=str(frontmatter.get("kind") or current["kind"]),
        namespace=effective_namespace,
        status=normalized_status,
        created_at=created_at,
        updated_at=now,
        path=normalized_path,
        last_activated_at=str(frontmatter.get("last_activated_at") or current.get("last_activated_at")) if (frontmatter.get("last_activated_at") or current.get("last_activated_at")) else None,
        review_after=str(frontmatter.get("review_after") or current.get("review_after")) if (frontmatter.get("review_after") or current.get("review_after")) else None,
        archived_at=str(archived_at) if archived_at else None,
    )
    markdown_source = render_markdown_source(normalized_frontmatter, body_md)
    conn.execute(
        """
        UPDATE memory_pages
        SET path = ?, title = ?, kind = ?, namespace = ?, status = ?, confidence = ?, latest_version = ?,
            frontmatter_json = ?, updated_at = ?, last_activated_at = ?, review_after = ?, archived_at = ?
        WHERE id = ?
        """,
        (
            normalized_frontmatter["path"],
            normalized_frontmatter["title"],
            normalized_frontmatter["kind"],
            normalized_frontmatter["namespace"],
            normalized_frontmatter["status"],
            normalized_frontmatter["confidence"],
            latest_version,
            json.dumps(normalized_frontmatter, sort_keys=True),
            now,
            normalized_frontmatter["last_activated_at"],
            normalized_frontmatter["review_after"],
            normalized_frontmatter["archived_at"],
            current["id"],
        ),
    )
    conn.execute(
        """
        INSERT INTO memory_page_versions (id, page_id, version, markdown_source, frontmatter_json, body_md, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?)
        """,
        (
            new_id("mpv"),
            current["id"],
            latest_version,
            markdown_source,
            json.dumps(normalized_frontmatter, sort_keys=True),
            body_md,
            now,
        ),
    )
    _replace_edges(
        conn,
        page_id=str(current["id"]),
        source_refs=normalized_frontmatter["source_refs"],
        entity_refs=normalized_frontmatter["entity_refs"],
        edge_refs=normalized_frontmatter["edge_refs"],
    )
    _replace_chunks(
        conn,
        source_type="page",
        source_id=str(current["id"]),
        page_id=str(current["id"]),
        status=normalized_frontmatter["status"],
        text=f"{normalized_frontmatter['title']}\n\n{body_md}",
    )
    if activate:
        record_activation(
            conn,
            page_id=str(current["id"]),
            source_type="page",
            source_id=str(current["id"]),
            event_type="page_updated",
            weight=1.0,
            metadata={"path": normalized_frontmatter["path"]},
            commit=False,
        )
    events_service.emit(
        conn,
        "memory.page_updated",
        {"page_id": current["id"], "path": normalized_frontmatter["path"], "namespace": normalized_frontmatter["namespace"]},
    )
    if commit:
        conn.commit()
    updated = get_page(conn, str(current["id"]), record_access=False)
    if updated is None:
        raise RuntimeError("Memory page update failed")
    return updated


def update_page(
    conn: Connection,
    page_id: str,
    *,
    markdown_source: str,
    base_version: int | None = None,
) -> dict | None:
    current = execute_fetchone(conn, "SELECT * FROM memory_pages WHERE id = ?", (page_id,))
    if current is None:
        return None

    current_version = int(current["latest_version"])
    if base_version is not None and int(base_version) != current_version:
        latest_version = _page_body_version(conn, page_id)
        conflict = conflict_service.create_conflict(
            conn,
            entity_type="memory_page",
            entity_id=page_id,
            operation="update",
            base_revision=int(base_version),
            current_revision=current_version,
            local_payload={"markdown_source": markdown_source},
            server_payload={
                "id": current["id"],
                "path": current["path"],
                "title": current["title"],
                "version": current_version,
                "markdown_source": latest_version["markdown_source"] if latest_version else "",
                "updated_at": current["updated_at"],
            },
        )
        raise conflict_service.RevisionConflictError(conflict)

    frontmatter, body_md = parse_markdown_source(markdown_source)
    return _update_page_from_frontmatter(conn, current, body_md=body_md, frontmatter=frontmatter)


def get_page(conn: Connection, page_id: str, *, record_access: bool = True) -> dict | None:
    row = execute_fetchone(conn, "SELECT * FROM memory_pages WHERE id = ?", (page_id,))
    if row is None:
        return None
    latest = _page_body_version(conn, page_id)
    if latest is None:
        return None
    backlinks = execute_fetchall(
        conn,
        """
        SELECT id, source_page_id, relation_type, target_type, target_id, metadata_json, created_at, updated_at
        FROM memory_edges
        WHERE target_type = 'page' AND target_id = ?
        ORDER BY updated_at DESC
        """,
        (page_id,),
    )
    linked_entities = execute_fetchall(
        conn,
        """
        SELECT id, source_page_id, relation_type, target_type, target_id, metadata_json, created_at, updated_at
        FROM memory_edges
        WHERE source_page_id = ?
        ORDER BY updated_at DESC
        """,
        (page_id,),
    )
    if record_access:
        record_activation(
            conn,
            page_id=page_id,
            source_type="page",
            source_id=page_id,
            event_type="page_opened",
            weight=0.8,
            metadata={"path": row["path"]},
            commit=True,
        )
    payload = _page_from_row(row, markdown_source=str(latest["markdown_source"]), body_md=str(latest["body_md"]))
    payload["backlinks"] = [_edge_payload(item) for item in backlinks]
    payload["linked_entities"] = [_edge_payload(item) for item in linked_entities]
    payload["versions_count"] = int(row["latest_version"])
    return payload


def list_page_versions(conn: Connection, page_id: str) -> list[dict[str, Any]]:
    rows = execute_fetchall(
        conn,
        """
        SELECT id, page_id, version, markdown_source, frontmatter_json, body_md, created_at
        FROM memory_page_versions
        WHERE page_id = ?
        ORDER BY version DESC
        """,
        (page_id,),
    )
    return [
        {
            "id": row["id"],
            "page_id": row["page_id"],
            "version": int(row["version"]),
            "markdown_source": row["markdown_source"],
            "frontmatter": row.get("frontmatter_json") or {},
            "body_md": row["body_md"],
            "created_at": row["created_at"],
        }
        for row in rows
    ]


def list_profile_proposals(conn: Connection, *, status: str | None = "pending") -> list[dict[str, Any]]:
    if status:
        rows = execute_fetchall(
            conn,
            """
            SELECT * FROM memory_profile_proposals
            WHERE status = ?
            ORDER BY created_at DESC
            """,
            (status,),
        )
    else:
        rows = execute_fetchall(conn, "SELECT * FROM memory_profile_proposals ORDER BY created_at DESC")
    return [
        {
            "id": row["id"],
            "page_id": row.get("page_id"),
            "proposed_page_id": row["proposed_page_id"],
            "path": row["path"],
            "title": row["title"],
            "kind": row["kind"],
            "namespace": row["namespace"],
            "status": row["status"],
            "rationale": row.get("rationale"),
            "markdown_source": row["proposal_markdown_source"],
            "frontmatter": row.get("frontmatter_json") or {},
            "body_md": row["body_md"],
            "metadata": row.get("metadata_json") or {},
            "created_at": row["created_at"],
            "updated_at": row["updated_at"],
            "resolved_at": row.get("resolved_at"),
        }
        for row in rows
    ]


def create_profile_proposal(
    conn: Connection,
    *,
    title: str,
    body_md: str,
    kind: str,
    namespace: str,
    page_id: str | None = None,
    path: str | None = None,
    tags: list[str] | None = None,
    source_refs: list[dict[str, Any]] | None = None,
    entity_refs: list[dict[str, Any]] | None = None,
    edge_refs: list[dict[str, Any]] | None = None,
    confidence: float = DEFAULT_CONFIDENCE,
    rationale: str | None = None,
    metadata: dict[str, Any] | None = None,
    commit: bool = True,
) -> dict[str, Any]:
    normalized_namespace = _validate_namespace(namespace, allow_profile=True, allow_archive=False)
    if normalized_namespace not in PROFILE_NAMESPACES:
        raise ValueError("Profile proposals must target a profile namespace")
    now = utc_now().isoformat()
    proposal_id = new_id("mpp")
    proposed_page_id = page_id or new_id("mpg")
    normalized_path = _normalize_path(normalized_namespace, title, path)
    frontmatter = _build_frontmatter(
        page_id=proposed_page_id,
        title=title.strip() or "Untitled",
        kind=kind.strip() or "profile",
        namespace=normalized_namespace,
        path=normalized_path,
        status="active",
        tags=[str(item) for item in (tags or [])],
        source_refs=_normalize_refs(source_refs),
        entity_refs=_normalize_refs(entity_refs),
        edge_refs=_normalize_refs(edge_refs),
        confidence=confidence,
        created_at=now,
        updated_at=now,
    )
    markdown_source = render_markdown_source(frontmatter, body_md)
    conn.execute(
        """
        INSERT INTO memory_profile_proposals (
          id, page_id, proposed_page_id, path, title, kind, namespace, proposal_markdown_source, frontmatter_json,
          body_md, rationale, status, metadata_json, created_at, updated_at, resolved_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        """,
        (
            proposal_id,
            page_id,
            proposed_page_id,
            normalized_path,
            frontmatter["title"],
            frontmatter["kind"],
            frontmatter["namespace"],
            markdown_source,
            json.dumps(frontmatter, sort_keys=True),
            body_md,
            rationale,
            "pending",
            json.dumps(metadata or {}, sort_keys=True),
            now,
            now,
            None,
        ),
    )
    events_service.emit(
        conn,
        "memory.profile_proposal_created",
        {"proposal_id": proposal_id, "path": normalized_path, "namespace": normalized_namespace},
    )
    if commit:
        conn.commit()
    return list_profile_proposals(conn, status=None)[0]


def confirm_profile_proposal(conn: Connection, proposal_id: str) -> dict | None:
    proposal = execute_fetchone(conn, "SELECT * FROM memory_profile_proposals WHERE id = ?", (proposal_id,))
    if proposal is None:
        return None
    if proposal["status"] != "pending":
        confirmed = get_page(conn, str(proposal["proposed_page_id"]))
        return confirmed

    existing = execute_fetchone(conn, "SELECT * FROM memory_pages WHERE id = ?", (proposal["proposed_page_id"],))
    frontmatter = dict(proposal.get("frontmatter_json") or {})
    body_md = str(proposal.get("body_md") or "")
    if existing is None:
        created = create_page(
            conn,
            title=str(proposal["title"]),
            body_md=body_md,
            kind=str(proposal["kind"]),
            namespace=str(proposal["namespace"]),
            path=str(proposal["path"]),
            tags=frontmatter.get("tags") if isinstance(frontmatter.get("tags"), list) else [],
            source_refs=frontmatter.get("source_refs") if isinstance(frontmatter.get("source_refs"), list) else [],
            entity_refs=frontmatter.get("entity_refs") if isinstance(frontmatter.get("entity_refs"), list) else [],
            edge_refs=frontmatter.get("edge_refs") if isinstance(frontmatter.get("edge_refs"), list) else [],
            confidence=float(frontmatter.get("confidence") or DEFAULT_CONFIDENCE),
            status="active",
            review_after=frontmatter.get("review_after"),
            allow_profile=True,
            commit=False,
        )
    else:
        created = _update_page_from_frontmatter(conn, existing, body_md=body_md, frontmatter=frontmatter, commit=False)

    now = utc_now().isoformat()
    conn.execute(
        "UPDATE memory_profile_proposals SET status = ?, updated_at = ?, resolved_at = ? WHERE id = ?",
        ("confirmed", now, now, proposal_id),
    )
    events_service.emit(
        conn,
        "memory.profile_proposal_confirmed",
        {"proposal_id": proposal_id, "page_id": created["id"], "path": created["path"]},
    )
    conn.commit()
    return created


def dismiss_profile_proposal(conn: Connection, proposal_id: str) -> dict | None:
    proposal = execute_fetchone(conn, "SELECT * FROM memory_profile_proposals WHERE id = ?", (proposal_id,))
    if proposal is None:
        return None
    now = utc_now().isoformat()
    conn.execute(
        "UPDATE memory_profile_proposals SET status = ?, updated_at = ?, resolved_at = ? WHERE id = ?",
        ("dismissed", now, now, proposal_id),
    )
    events_service.emit(conn, "memory.profile_proposal_dismissed", {"proposal_id": proposal_id})
    conn.commit()
    return execute_fetchone(conn, "SELECT * FROM memory_profile_proposals WHERE id = ?", (proposal_id,))


def list_tree(conn: Connection) -> dict[str, Any]:
    pages = execute_fetchall(
        conn,
        """
        SELECT id, path, title, kind, namespace, status, confidence, latest_version, frontmatter_json,
               created_at, updated_at, last_activated_at, review_after, archived_at
        FROM memory_pages
        ORDER BY path ASC
        """
    )
    root: dict[str, Any] = {"kind": "directory", "name": "memory", "path": "", "children": {}}
    for page in pages:
        parts = str(page["path"]).split("/")
        cursor = root
        current_path: list[str] = []
        for segment in parts[:-1]:
            current_path.append(segment)
            children = cursor.setdefault("children", {})
            if segment not in children:
                children[segment] = {
                    "kind": "directory",
                    "name": segment,
                    "path": "/".join(current_path),
                    "children": {},
                }
            cursor = children[segment]
        children = cursor.setdefault("children", {})
        children[parts[-1]] = {
            "kind": "page",
            "name": parts[-1],
            "path": page["path"],
            "page_id": page["id"],
            "title": page["title"],
            "namespace": page["namespace"],
            "status": page["status"],
        }

    def finalize(node: dict[str, Any]) -> dict[str, Any]:
        children = node.get("children")
        if isinstance(children, dict):
            node["children"] = [finalize(children[key]) for key in sorted(children)]
        return node

    return finalize(root)


def _updated_at_or_created(row: dict[str, Any]) -> datetime:
    raw = str(row.get("last_activated_at") or row.get("updated_at") or row.get("created_at") or utc_now().isoformat())
    return datetime.fromisoformat(raw)


def apply_decay(conn: Connection, *, commit: bool = True) -> None:
    now = utc_now()
    rows = execute_fetchall(
        conn,
        "SELECT id, path, title, kind, namespace, status, confidence, latest_version, frontmatter_json, created_at, updated_at, last_activated_at, review_after, archived_at FROM memory_pages",
    )
    for row in rows:
        age = now - _updated_at_or_created(row)
        current_status = str(row["status"])
        if current_status == "archived":
            continue
        next_status = current_status
        if age >= timedelta(days=ARCHIVE_AFTER_DAYS):
            next_status = "archived"
        elif age >= timedelta(days=COOLING_AFTER_DAYS):
            next_status = "cooling"
        if next_status == current_status:
            continue
        frontmatter = dict(row.get("frontmatter_json") or {})
        if next_status == "archived":
            frontmatter["archived_at"] = frontmatter.get("archived_at") or now.isoformat()
        frontmatter["status"] = next_status
        latest = _page_body_version(conn, str(row["id"]))
        if latest is None:
            continue
        _update_page_from_frontmatter(
            conn,
            row,
            body_md=str(latest["body_md"]),
            frontmatter=frontmatter,
            activate=False,
            commit=False,
        )
    if commit:
        conn.commit()


def _delete_surface_suggestions(conn: Connection, surface: str) -> None:
    conn.execute("DELETE FROM memory_suggestions WHERE surface = ?", (surface,))


def _insert_suggestion(
    conn: Connection,
    *,
    surface: str,
    suggestion_type: str,
    title: str,
    body: str,
    weight: float,
    entity_type: str,
    entity_id: str,
    page_id: str | None = None,
    metadata: dict[str, Any] | None = None,
) -> dict[str, Any]:
    suggestion_id = new_id("msug")
    now = utc_now().isoformat()
    conn.execute(
        """
        INSERT INTO memory_suggestions (
          id, surface, suggestion_type, title, body, weight, entity_type, entity_id, page_id,
          status, metadata_json, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        """,
        (
            suggestion_id,
            surface,
            suggestion_type,
            title,
            body,
            float(weight),
            entity_type,
            entity_id,
            page_id,
            "active",
            json.dumps(metadata or {}, sort_keys=True),
            now,
            now,
        ),
    )
    return {
        "id": suggestion_id,
        "surface": surface,
        "suggestion_type": suggestion_type,
        "title": title,
        "body": body,
        "weight": float(weight),
        "entity_type": entity_type,
        "entity_id": entity_id,
        "page_id": page_id,
        "status": "active",
        "metadata": metadata or {},
        "created_at": now,
        "updated_at": now,
    }


def _artifact_texts(conn: Connection) -> list[dict[str, Any]]:
    return execute_fetchall(
        conn,
        """
        SELECT id, title, source_type, normalized_content, extracted_content, raw_content, created_at, updated_at, metadata_json
        FROM artifacts
        ORDER BY updated_at DESC
        LIMIT 200
        """
    )


def _page_rows(conn: Connection, *, namespaces: set[str] | None = None, include_archived: bool = False) -> list[dict[str, Any]]:
    rows = execute_fetchall(
        conn,
        """
        SELECT id, path, title, kind, namespace, status, confidence, latest_version, frontmatter_json,
               created_at, updated_at, last_activated_at, review_after, archived_at
        FROM memory_pages
        ORDER BY updated_at DESC
        """
    )
    filtered: list[dict[str, Any]] = []
    for row in rows:
        if namespaces and str(row["namespace"]) not in namespaces:
            continue
        if not include_archived and str(row["status"]) == "archived":
            continue
        filtered.append(row)
    return filtered


def sync_suggestions(conn: Connection, surface: str) -> list[dict[str, Any]]:
    apply_decay(conn, commit=False)
    _delete_surface_suggestions(conn, surface)
    suggestions: list[dict[str, Any]] = []
    pending_proposals = list_profile_proposals(conn, status="pending")
    for proposal in pending_proposals[:4]:
        suggestions.append(
            _insert_suggestion(
                conn,
                surface=surface,
                suggestion_type="confirm_profile_update",
                title=f"Confirm profile update: {proposal['title']}",
                body=proposal["rationale"] or "A pending profile change needs explicit confirmation.",
                weight=1.0,
                entity_type="profile_proposal",
                entity_id=str(proposal["id"]),
                page_id=str(proposal.get("page_id") or proposal["proposed_page_id"]),
                metadata={"proposal_id": proposal["id"], "path": proposal["path"]},
            )
        )
        if proposal.get("page_id"):
            existing = execute_fetchone(conn, "SELECT * FROM memory_pages WHERE id = ?", (proposal["page_id"],))
            if existing is not None:
                latest = _page_body_version(conn, str(existing["id"]))
                existing_body = str(latest["body_md"]) if latest else ""
                if existing_body.strip() and existing_body.strip() != str(proposal["body_md"]).strip():
                    suggestions.append(
                        _insert_suggestion(
                            conn,
                            surface=surface,
                            suggestion_type="contradiction_to_resolve",
                            title=f"Resolve profile contradiction: {proposal['title']}",
                            body="A pending profile update conflicts with the currently confirmed page.",
                            weight=0.95,
                            entity_type="profile_proposal",
                            entity_id=str(proposal["id"]),
                            page_id=str(existing["id"]),
                            metadata={"proposal_id": proposal["id"], "path": proposal["path"]},
                        )
                    )

    now_iso = utc_now().isoformat()
    forgotten_tasks = execute_fetchall(
        conn,
        """
        SELECT id, title, status, due_at, priority, updated_at
        FROM tasks
        WHERE status NOT IN ('done', 'cancelled')
        ORDER BY priority DESC, COALESCE(due_at, updated_at) ASC
        LIMIT 8
        """
    )
    for task in forgotten_tasks:
        due_at = str(task.get("due_at") or "")
        if due_at and due_at < now_iso:
            suggestions.append(
                _insert_suggestion(
                    conn,
                    surface=surface,
                    suggestion_type="forgotten_commitment",
                    title=f"Revisit task: {task['title']}",
                    body=f"Task is overdue since {due_at}.",
                    weight=0.92,
                    entity_type="task",
                    entity_id=str(task["id"]),
                    metadata={"status": task["status"], "due_at": due_at},
                )
            )

    stale_projects = _page_rows(conn, namespaces={"wiki/projects"}, include_archived=False)
    for row in stale_projects[:4]:
        age = utc_now() - _updated_at_or_created(row)
        if age < timedelta(days=COOLING_AFTER_DAYS):
            continue
        suggestions.append(
            _insert_suggestion(
                conn,
                surface=surface,
                suggestion_type="stale_project_thread",
                title=f"Stale project thread: {row['title']}",
                body=f"No meaningful activity has touched this project page for {age.days} days.",
                weight=0.84,
                entity_type="memory_page",
                entity_id=str(row["id"]),
                page_id=str(row["id"]),
                metadata={"path": row["path"], "status": row["status"]},
            )
        )

    goal_pages = _page_rows(conn, namespaces={"profile/goals", "profile/learning"}, include_archived=False)
    goal_keywords: dict[str, set[str]] = {}
    for page in goal_pages[:8]:
        latest = _page_body_version(conn, str(page["id"]))
        goal_keywords[str(page["id"])] = _page_keywords(str(page["title"]), str(latest["body_md"]) if latest else "")

    linked_artifacts = {
        str(edge["target_id"])
        for edge in execute_fetchall(
            conn,
            "SELECT target_id FROM memory_edges WHERE target_type = 'artifact'"
        )
    }
    for artifact in _artifact_texts(conn):
        if str(artifact["id"]) in linked_artifacts:
            continue
        artifact_text = str(artifact.get("extracted_content") or artifact.get("normalized_content") or artifact.get("raw_content") or "")
        artifact_keywords = _page_keywords(str(artifact.get("title") or ""), artifact_text)
        if not artifact_keywords:
            continue
        created_at = datetime.fromisoformat(str(artifact["created_at"]))
        if utc_now() - created_at > timedelta(days=RELEVANT_PAST_CLIP_MAX_AGE_DAYS):
            continue
        best_goal_id = ""
        best_overlap = 0
        for goal_id, keywords in goal_keywords.items():
            overlap = len(keywords & artifact_keywords)
            if overlap > best_overlap:
                best_goal_id = goal_id
                best_overlap = overlap
        if best_overlap >= 2:
            suggestions.append(
                _insert_suggestion(
                    conn,
                    surface=surface,
                    suggestion_type="relevant_past_clip",
                    title=f"Relevant past clip: {artifact.get('title') or artifact['id']}",
                    body="This older clip overlaps with one of your active goals or learning pages.",
                    weight=min(0.6 + (best_overlap * 0.08), 0.93),
                    entity_type="artifact",
                    entity_id=str(artifact["id"]),
                    page_id=best_goal_id or None,
                    metadata={"goal_page_id": best_goal_id, "source_type": artifact.get("source_type")},
                )
            )

    blocked_tasks = execute_fetchall(
        conn,
        """
        SELECT id, title, status, source_artifact_id, updated_at
        FROM tasks
        WHERE lower(status) IN ('blocked', 'stalled') OR lower(title) LIKE '%blocked%' OR lower(title) LIKE '%stuck%'
        ORDER BY updated_at DESC
        LIMIT 6
        """
    )
    for task in blocked_tasks:
        task_keywords = _page_keywords(str(task["title"]))
        best_goal_id = ""
        best_overlap = 0
        for goal_id, keywords in goal_keywords.items():
            overlap = len(keywords & task_keywords)
            if overlap > best_overlap:
                best_goal_id = goal_id
                best_overlap = overlap
        if best_goal_id or task.get("source_artifact_id"):
            suggestions.append(
                _insert_suggestion(
                    conn,
                    surface=surface,
                    suggestion_type="learn_next_from_blocker",
                    title=f"Learn next from blocker: {task['title']}",
                    body="A blocked task suggests a concrete follow-up learning target.",
                    weight=0.9,
                    entity_type="task",
                    entity_id=str(task["id"]),
                    page_id=best_goal_id or None,
                    metadata={"goal_page_id": best_goal_id, "source_artifact_id": task.get("source_artifact_id")},
                )
            )

    conn.commit()
    rows = execute_fetchall(
        conn,
        """
        SELECT id, surface, suggestion_type, title, body, weight, entity_type, entity_id, page_id,
               status, metadata_json, created_at, updated_at
        FROM memory_suggestions
        WHERE surface = ?
        ORDER BY weight DESC, updated_at DESC
        """,
        (surface,),
    )
    return [
        {
            "id": row["id"],
            "surface": row["surface"],
            "suggestion_type": row["suggestion_type"],
            "title": row["title"],
            "body": row["body"],
            "weight": float(row["weight"]),
            "entity_type": row["entity_type"],
            "entity_id": row["entity_id"],
            "page_id": row.get("page_id"),
            "status": row["status"],
            "metadata": row.get("metadata_json") or {},
            "created_at": row["created_at"],
            "updated_at": row["updated_at"],
        }
        for row in rows
    ]


def list_suggestions(conn: Connection, *, surface: str, refresh: bool = True) -> list[dict[str, Any]]:
    if refresh:
        return sync_suggestions(conn, surface)
    rows = execute_fetchall(
        conn,
        """
        SELECT id, surface, suggestion_type, title, body, weight, entity_type, entity_id, page_id,
               status, metadata_json, created_at, updated_at
        FROM memory_suggestions
        WHERE surface = ?
        ORDER BY weight DESC, updated_at DESC
        """,
        (surface,),
    )
    return [
        {
            "id": row["id"],
            "surface": row["surface"],
            "suggestion_type": row["suggestion_type"],
            "title": row["title"],
            "body": row["body"],
            "weight": float(row["weight"]),
            "entity_type": row["entity_type"],
            "entity_id": row["entity_id"],
            "page_id": row.get("page_id"),
            "status": row["status"],
            "metadata": row.get("metadata_json") or {},
            "created_at": row["created_at"],
            "updated_at": row["updated_at"],
        }
        for row in rows
    ]


def runtime_memory_context(conn: Connection, *, query: str, limit: int = 4) -> dict[str, Any]:
    text = str(query or "").strip()
    explicit_paths = EXPLICIT_PATH_PATTERN.findall(text.lower())
    query_keywords = _page_keywords(text)
    pages = _page_rows(conn, namespaces=WIKI_NAMESPACES | PROFILE_NAMESPACES, include_archived=False)
    scored_pages: list[tuple[int, dict[str, Any], str]] = []
    for page in pages:
        latest = _page_body_version(conn, str(page["id"]))
        body_md = str(latest["body_md"]) if latest else ""
        score = 0
        if str(page["path"]).lower() in explicit_paths:
            score += 10
        page_keywords = _page_keywords(str(page["title"]), str(page["path"]), body_md)
        score += len(page_keywords & query_keywords)
        if score <= 0 and explicit_paths:
            continue
        if score <= 0:
            continue
        excerpt = body_md[:240]
        scored_pages.append((score, page, excerpt))
    scored_pages.sort(key=lambda item: (item[0], str(item[1]["updated_at"])), reverse=True)

    wiki_pages: list[dict[str, Any]] = []
    profile_pages: list[dict[str, Any]] = []
    for score, page, excerpt in scored_pages:
        payload = {
            "id": page["id"],
            "path": page["path"],
            "title": page["title"],
            "kind": page["kind"],
            "namespace": page["namespace"],
            "status": page["status"],
            "score": score,
            "excerpt": excerpt,
        }
        if str(page["namespace"]).startswith("profile/"):
            if len(profile_pages) < max(2, limit // 2):
                profile_pages.append(payload)
        else:
            if len(wiki_pages) < limit:
                wiki_pages.append(payload)

    artifact_rows = _artifact_texts(conn)
    artifact_matches: list[dict[str, Any]] = []
    for row in artifact_rows:
        content = str(row.get("extracted_content") or row.get("normalized_content") or row.get("raw_content") or "")
        keywords = _page_keywords(str(row.get("title") or ""), content)
        overlap = len(keywords & query_keywords)
        if overlap <= 0:
            continue
        artifact_matches.append(
            {
                "id": row["id"],
                "title": row.get("title") or row["id"],
                "score": overlap,
                "excerpt": content[:240],
                "source_type": row.get("source_type"),
            }
        )
    artifact_matches.sort(key=lambda item: item["score"], reverse=True)
    return {
        "wiki_pages": wiki_pages[:limit],
        "profile_pages": profile_pages[: max(2, limit // 2)],
        "artifact_matches": artifact_matches[: min(3, limit)],
    }


def promote_artifact_summary(
    conn: Connection,
    *,
    artifact: dict[str, Any],
    summary_id: str,
    summary_text: str,
) -> dict[str, Any]:
    existing_edge = execute_fetchone(
        conn,
        """
        SELECT source_page_id
        FROM memory_edges
        WHERE target_type = 'artifact' AND target_id = ?
        ORDER BY updated_at DESC
        LIMIT 1
        """,
        (artifact["id"],),
    )
    body_md = "\n".join(
        [
            f"# {artifact.get('title') or 'Captured source'}",
            "",
            "## Summary",
            summary_text.strip(),
            "",
            "## Source excerpt",
            str(artifact.get("extracted_content") or artifact.get("normalized_content") or artifact.get("raw_content") or "").strip()[:1200],
        ]
    ).strip()
    source_refs = [
        {"entity_type": "artifact", "entity_id": str(artifact["id"]), "label": artifact.get("title") or artifact["id"]},
        {"entity_type": "summary_version", "entity_id": summary_id, "label": "Latest summary"},
    ]
    entity_refs = []
    edge_refs = [
        {"relation_type": "summarized_by", "target_type": "summary_version", "target_id": summary_id},
        {"relation_type": "derived_from", "target_type": "artifact", "target_id": str(artifact["id"])},
    ]
    if existing_edge is None:
        created = create_page(
            conn,
            title=str(artifact.get("title") or "Captured source"),
            body_md=body_md,
            kind="source",
            namespace="wiki/sources",
            path=None,
            tags=["capture", str(artifact.get("source_type") or "artifact")],
            source_refs=source_refs,
            entity_refs=entity_refs,
            edge_refs=edge_refs,
            confidence=0.7,
            status="active",
            commit=False,
        )
    else:
        row = execute_fetchone(conn, "SELECT * FROM memory_pages WHERE id = ?", (existing_edge["source_page_id"],))
        if row is None:
            created = create_page(
                conn,
                title=str(artifact.get("title") or "Captured source"),
                body_md=body_md,
                kind="source",
                namespace="wiki/sources",
                tags=["capture", str(artifact.get("source_type") or "artifact")],
                source_refs=source_refs,
                edge_refs=edge_refs,
                confidence=0.7,
                status="active",
                commit=False,
            )
        else:
            frontmatter = dict(row.get("frontmatter_json") or {})
            frontmatter.update(
                {
                    "title": str(artifact.get("title") or row["title"]),
                    "kind": "source",
                    "namespace": "wiki/sources",
                    "status": "active",
                    "tags": sorted(set([*frontmatter.get("tags", []), "capture", str(artifact.get("source_type") or "artifact")])),
                    "source_refs": source_refs,
                    "entity_refs": entity_refs,
                    "edge_refs": edge_refs,
                    "confidence": max(float(frontmatter.get("confidence") or 0.0), 0.7),
                }
            )
            created = _update_page_from_frontmatter(conn, row, body_md=body_md, frontmatter=frontmatter, commit=False)
    conn.commit()
    return created
