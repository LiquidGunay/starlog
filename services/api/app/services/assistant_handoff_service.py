from __future__ import annotations

from datetime import timedelta
from sqlite3 import Connection

from app.core.security import create_signed_token, verify_signed_token
from app.core.time import utc_now
from app.services import artifacts_service

HANDOFF_TOKEN_PURPOSE = "assistant_handoff"
HANDOFF_TOKEN_TTL_SECONDS = 15 * 60


def _artifact_capture_source(artifact: dict) -> str:
    metadata = artifact.get("metadata") if isinstance(artifact.get("metadata"), dict) else {}
    capture = metadata.get("capture") if isinstance(metadata.get("capture"), dict) else {}
    return str(capture.get("capture_source") or metadata.get("capture_source") or "").strip().lower()


def _artifact_handoff_source(artifact: dict) -> str:
    capture_source = _artifact_capture_source(artifact)
    source_type = str(artifact.get("source_type") or "").strip().lower()
    if capture_source.startswith("desktop_helper") or source_type == "clip_desktop_helper":
        return "desktop_helper"
    return "library"


def _validated_artifact(conn: Connection, artifact_id: str | None) -> dict | None:
    normalized = str(artifact_id or "").strip() or None
    if normalized is None:
        return None
    artifact = artifacts_service.get_artifact(conn, normalized)
    if artifact is None:
        raise LookupError(f"Artifact not found: {normalized}")
    return artifact


def _handoff_payload(*, user_id: str, source: str, artifact_id: str | None, draft: str) -> dict[str, str]:
    return {
        "user_id": user_id,
        "source": source,
        "artifact_id": artifact_id or "",
        "draft": draft,
    }


def issue_handoff(
    conn: Connection,
    *,
    user_id: str,
    source: str,
    draft: str,
    artifact_id: str | None = None,
) -> dict:
    normalized_draft = draft.strip()
    if not normalized_draft:
        raise ValueError("Handoff draft cannot be empty")

    artifact = _validated_artifact(conn, artifact_id)
    validated_artifact_id = str(artifact.get("id")) if artifact else None
    resolved_source = source
    if artifact is not None:
        resolved_source = _artifact_handoff_source(artifact)
        if source != resolved_source:
            raise ValueError(
                f"Artifact origin requires source_surface={resolved_source}, not {source}"
            )

    payload = _handoff_payload(
        user_id=user_id,
        source=resolved_source,
        artifact_id=validated_artifact_id,
        draft=normalized_draft,
    )
    token = create_signed_token(
        purpose=HANDOFF_TOKEN_PURPOSE,
        payload=payload,
        ttl_seconds=HANDOFF_TOKEN_TTL_SECONDS,
    )
    expires_at = utc_now() + timedelta(seconds=HANDOFF_TOKEN_TTL_SECONDS)
    return {
        "token": token,
        "handoff": {
            "source": resolved_source,
            "artifact_id": validated_artifact_id,
            "draft": normalized_draft,
        },
        "expires_at": expires_at,
    }


def resolve_handoff(conn: Connection, *, token: str, user_id: str) -> dict:
    payload = verify_signed_token(purpose=HANDOFF_TOKEN_PURPOSE, token=token)
    token_user_id = str(payload.get("user_id") or "").strip()
    if token_user_id != user_id:
        raise PermissionError("Handoff token does not belong to the current user")

    source = str(payload.get("source") or "").strip()
    if not source:
        raise ValueError("Handoff token is missing a source")
    draft = str(payload.get("draft") or "").strip()
    if not draft:
        raise ValueError("Handoff token is missing a draft")
    artifact = _validated_artifact(conn, payload.get("artifact_id"))
    artifact_id = str(artifact.get("id")) if artifact else None
    if artifact is not None:
        source = _artifact_handoff_source(artifact)

    return {
        "source": source,
        "artifact_id": artifact_id,
        "draft": draft,
    }
