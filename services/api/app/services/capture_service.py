from copy import deepcopy
from sqlite3 import Connection

from app.services import artifacts_service, events_service


def _layer_text(layer: dict | None) -> str | None:
    if layer is None:
        return None
    text = layer.get("text")
    if text is None:
        return None
    return str(text)


def _compact_layer(layer: dict | None) -> dict | None:
    if layer is None:
        return None
    compact = {key: value for key, value in layer.items() if value is not None}
    return compact or None


def ingest_capture(
    conn: Connection,
    source_type: str,
    capture_source: str,
    title: str | None,
    source_url: str | None,
    raw: dict | None,
    normalized: dict | None,
    extracted: dict | None,
    tags: list[str],
    metadata: dict,
) -> dict:
    merged_metadata = deepcopy(metadata)
    merged_metadata["capture"] = {
        "capture_source": capture_source,
        "source_url": source_url,
        "tags": tags,
        "layers": {
            "raw": _compact_layer(raw),
            "normalized": _compact_layer(normalized),
            "extracted": _compact_layer(extracted),
        },
    }

    raw_content = _layer_text(raw)
    normalized_content = _layer_text(normalized) or raw_content
    extracted_content = _layer_text(extracted)

    artifact = artifacts_service.create_artifact(
        conn,
        source_type=source_type,
        title=title,
        raw_content=raw_content,
        normalized_content=normalized_content,
        extracted_content=extracted_content,
        metadata=merged_metadata,
    )

    events_service.emit(
        conn,
        "capture.ingested",
        {
            "artifact_id": artifact["id"],
            "capture_source": capture_source,
            "source_type": source_type,
        },
    )
    conn.commit()

    return artifact
