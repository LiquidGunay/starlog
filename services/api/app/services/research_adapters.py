from __future__ import annotations

import json
import re
from sqlite3 import Connection
from typing import Any, Protocol
from urllib.parse import quote, urlparse
from urllib.request import Request, urlopen
from xml.etree import ElementTree

from app.core.time import utc_now
from app.services import capture_service, media_service
from app.services.common import execute_fetchone, new_id

ARXIV_FEED_URL = "https://export.arxiv.org/api/query?id_list={arxiv_id}"
ARXIV_NAMESPACES = {
    "atom": "http://www.w3.org/2005/Atom",
    "arxiv": "http://arxiv.org/schemas/atom",
}
ARXIV_ID_PATTERN = re.compile(r"(?:arxiv\.org/(?:abs|pdf)/)?(?P<id>\d{4}\.\d{4,5}(?:v\d+)?)")


class ResearchSourceAdapter(Protocol):
    source_kind: str

    def ingest(self, conn: Connection, payload: dict[str, Any]) -> str: ...


def extract_arxiv_id(value: str) -> str | None:
    match = ARXIV_ID_PATTERN.search(value)
    if match is None:
        return None
    return match.group("id")


def _normalize_text(value: str | None) -> str | None:
    if value is None:
        return None
    collapsed = " ".join(value.split())
    return collapsed or None


def _source_id(conn: Connection, source_kind: str) -> str:
    row = execute_fetchone(conn, "SELECT id FROM research_sources WHERE source_kind = ?", (source_kind,))
    if row is None:
        raise LookupError(f"Research source not found: {source_kind}")
    return str(row["id"])


def _persist_research_item(
    conn: Connection,
    *,
    source_kind: str,
    external_id: str | None,
    title: str,
    url: str | None,
    authors: list[str],
    abstract: str | None,
    published_at: str | None,
    metadata: dict[str, Any],
    capture_title: str,
    capture_source: str,
    capture_source_url: str | None,
    capture_tags: list[str],
    capture_raw: dict[str, Any],
    capture_normalized: dict[str, Any] | None,
    capture_extracted: dict[str, Any] | None,
) -> str:
    artifact = capture_service.ingest_capture(
        conn,
        source_type=f"research_{source_kind}",
        capture_source=capture_source,
        title=capture_title,
        source_url=capture_source_url,
        raw=capture_raw,
        normalized=capture_normalized,
        extracted=capture_extracted,
        tags=capture_tags,
        metadata={"research": metadata},
    )
    now = utc_now().isoformat()
    item_id = new_id("ritm")
    conn.execute(
        """
        INSERT INTO research_items (
          id, source_id, external_id, title, url, authors_json, abstract, published_at,
          content_artifact_id, metadata_json, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        """,
        (
            item_id,
            _source_id(conn, source_kind),
            external_id,
            title,
            url,
            json.dumps(authors, sort_keys=True),
            abstract,
            published_at,
            artifact["id"],
            json.dumps(metadata, sort_keys=True),
            now,
            now,
        ),
    )
    conn.commit()
    return item_id


def fetch_arxiv_entry(arxiv_id: str) -> dict[str, Any]:
    request = Request(
        ARXIV_FEED_URL.format(arxiv_id=quote(arxiv_id)),
        headers={"User-Agent": "Starlog/0.1 (research-ingest)"},
    )
    with urlopen(request, timeout=20) as response:
        payload = response.read()

    root = ElementTree.fromstring(payload)
    entry = root.find("atom:entry", ARXIV_NAMESPACES)
    if entry is None:
        raise LookupError(f"arXiv entry not found: {arxiv_id}")

    title = _normalize_text(entry.findtext("atom:title", default="", namespaces=ARXIV_NAMESPACES)) or arxiv_id
    summary = _normalize_text(entry.findtext("atom:summary", default="", namespaces=ARXIV_NAMESPACES))
    entry_id = _normalize_text(entry.findtext("atom:id", default="", namespaces=ARXIV_NAMESPACES))
    published_at = _normalize_text(entry.findtext("atom:published", default="", namespaces=ARXIV_NAMESPACES))
    authors = [
        _normalize_text(node.findtext("atom:name", default="", namespaces=ARXIV_NAMESPACES)) or "Unknown author"
        for node in entry.findall("atom:author", ARXIV_NAMESPACES)
    ]
    categories = [node.attrib.get("term", "") for node in entry.findall("atom:category", ARXIV_NAMESPACES)]
    source_url = None
    for node in entry.findall("atom:link", ARXIV_NAMESPACES):
        href = node.attrib.get("href")
        if not href:
            continue
        parsed = urlparse(href)
        if parsed.netloc.endswith("arxiv.org") and "/abs/" in parsed.path:
            source_url = href
            break
    if source_url is None and entry_id:
        source_url = entry_id

    resolved_id = extract_arxiv_id(source_url or entry_id or arxiv_id) or arxiv_id
    return {
        "arxiv_id": resolved_id,
        "title": title,
        "summary": summary,
        "entry_id": entry_id,
        "url": source_url,
        "authors": [author for author in authors if author],
        "published_at": published_at,
        "categories": [category for category in categories if category],
    }


class ManualUrlResearchAdapter:
    source_kind = "manual_url"

    def ingest(self, conn: Connection, payload: dict[str, Any]) -> str:
        url = str(payload["url"])
        notes = payload.get("notes")
        resolved_title = payload.get("title") or url
        metadata = {
            "source_kind": self.source_kind,
            "ingest_kind": self.source_kind,
            "url": url,
        }
        return _persist_research_item(
            conn,
            source_kind=self.source_kind,
            external_id=None,
            title=resolved_title,
            url=url,
            authors=[],
            abstract=notes,
            published_at=None,
            metadata=metadata,
            capture_title=resolved_title,
            capture_source="research_manual",
            capture_source_url=url,
            capture_tags=["research", "manual_url"],
            capture_raw={"text": notes or url, "mime_type": "text/plain"},
            capture_normalized={"text": notes or url, "mime_type": "text/plain"},
            capture_extracted={"text": notes or url, "mime_type": "text/plain"},
        )


class ManualPdfResearchAdapter:
    source_kind = "manual_pdf"

    def ingest(self, conn: Connection, payload: dict[str, Any]) -> str:
        media_id = str(payload["media_id"])
        notes = payload.get("notes")
        asset = media_service.get_media_asset(conn, media_id)
        if asset is None:
            raise LookupError(f"Media asset not found: {media_id}")
        resolved_title = payload.get("title") or asset.get("source_filename") or media_id
        metadata = {
            "source_kind": self.source_kind,
            "ingest_kind": self.source_kind,
            "media_id": media_id,
        }
        return _persist_research_item(
            conn,
            source_kind=self.source_kind,
            external_id=None,
            title=resolved_title,
            url=asset["content_url"],
            authors=[],
            abstract=notes,
            published_at=None,
            metadata=metadata,
            capture_title=resolved_title,
            capture_source="research_pdf",
            capture_source_url=None,
            capture_tags=["research", "manual_pdf"],
            capture_raw={
                "blob_ref": asset["blob_ref"],
                "mime_type": asset.get("content_type"),
                "filename": asset.get("source_filename"),
            },
            capture_normalized={"text": notes or resolved_title, "mime_type": "text/plain"},
            capture_extracted=None,
        )


class ArxivResearchAdapter:
    source_kind = "arxiv"

    def ingest(self, conn: Connection, payload: dict[str, Any]) -> str:
        explicit_id = payload.get("arxiv_id")
        explicit_url = payload.get("url")
        notes = payload.get("notes")
        candidate = str(explicit_id or explicit_url or "").strip()
        resolved_id = extract_arxiv_id(candidate)
        if resolved_id is None:
            raise ValueError("A valid arXiv id or arXiv URL is required")

        entry = fetch_arxiv_entry(resolved_id)
        title = payload.get("title") or entry["title"]
        summary = entry["summary"] or notes
        metadata = {
            "source_kind": self.source_kind,
            "ingest_kind": self.source_kind,
            "arxiv_id": entry["arxiv_id"],
            "entry_id": entry["entry_id"],
            "categories": entry["categories"],
            "notes": notes,
        }
        return _persist_research_item(
            conn,
            source_kind=self.source_kind,
            external_id=entry["arxiv_id"],
            title=title,
            url=entry["url"],
            authors=entry["authors"],
            abstract=summary,
            published_at=entry["published_at"],
            metadata=metadata,
            capture_title=title,
            capture_source="research_arxiv",
            capture_source_url=entry["url"],
            capture_tags=["research", "arxiv"],
            capture_raw={"text": summary or title, "mime_type": "text/plain"},
            capture_normalized={"text": summary or title, "mime_type": "text/plain"},
            capture_extracted={"text": summary or title, "mime_type": "text/plain"},
        )


def build_default_adapters() -> dict[str, ResearchSourceAdapter]:
    adapters: list[ResearchSourceAdapter] = [
        ArxivResearchAdapter(),
        ManualUrlResearchAdapter(),
        ManualPdfResearchAdapter(),
    ]
    return {adapter.source_kind: adapter for adapter in adapters}
