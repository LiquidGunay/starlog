from copy import deepcopy
from sqlite3 import Connection

from app.core.time import utc_now
from app.services import ai_jobs_service, artifacts_service, events_service, integrations_service, memory_vault_service
from app.services.common import new_id


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
    existing_capture = merged_metadata.get("capture")
    if not isinstance(existing_capture, dict):
        existing_capture = {}
    existing_layers = existing_capture.get("layers")
    if not isinstance(existing_layers, dict):
        existing_layers = {}
    merged_metadata["capture"] = {
        **existing_capture,
        "capture_source": capture_source,
        "source_url": source_url,
        "tags": tags,
        "layers": {
            **existing_layers,
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
    memory_vault_service.index_artifact_capture(conn, artifact, commit=False)
    conn.commit()

    return artifact


def ingest_voice_capture(
    conn: Connection,
    *,
    title: str | None,
    source_url: str | None,
    blob_ref: str,
    mime_type: str | None,
    checksum_sha256: str,
    duration_ms: int | None,
    provider_hint: str | None,
) -> tuple[dict, str]:
    resolved_provider_hint = provider_hint or integrations_service.default_batch_provider_hint(conn, "stt") or "desktop_bridge_stt"
    metadata = {
        "voice_note": {
            "duration_ms": duration_ms,
            "provider_hint": resolved_provider_hint,
        }
    }
    artifact = ingest_capture(
        conn,
        source_type="voice_note",
        capture_source="mobile_voice",
        title=title,
        source_url=source_url,
        raw={
            "blob_ref": blob_ref,
            "mime_type": mime_type,
            "checksum_sha256": checksum_sha256,
        },
        normalized=None,
        extracted=None,
        tags=[],
        metadata=metadata,
    )

    job = ai_jobs_service.create_job(
        conn,
        capability="stt",
        payload={
            "blob_ref": blob_ref,
            "content_type": mime_type,
            "title": title or artifact["id"],
        },
        provider_hint=resolved_provider_hint,
        requested_targets=integrations_service.capability_execution_order(
            conn,
            "stt",
            executable_targets={"mobile_bridge", "desktop_bridge", "api"},
            prefer_local=True,
        ),
        artifact_id=artifact["id"],
        action="transcribe",
    )
    conn.execute(
        "INSERT INTO action_runs (id, artifact_id, action, status, output_ref, created_at) VALUES (?, ?, ?, ?, ?, ?)",
        (new_id("act"), artifact["id"], "transcribe", "queued", job["id"], utc_now().isoformat()),
    )
    events_service.emit(
        conn,
        "artifact.action_queued",
        {"artifact_id": artifact["id"], "action": "transcribe", "job_id": job["id"]},
    )
    conn.commit()
    return artifact, str(job["id"])
