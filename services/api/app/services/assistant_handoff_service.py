from __future__ import annotations

from datetime import timedelta
from sqlite3 import Connection

from app.core.security import create_signed_token, verify_signed_token
from app.core.time import utc_now
from app.services import artifacts_service

HANDOFF_TOKEN_PURPOSE = "assistant_handoff"
HANDOFF_TOKEN_TTL_SECONDS = 15 * 60


def _validated_artifact_id(conn: Connection, artifact_id: str | None) -> str | None:
    normalized = str(artifact_id or "").strip() or None
    if normalized is None:
        return None
    artifact = artifacts_service.get_artifact(conn, normalized)
    if artifact is None:
        raise LookupError(f"Artifact not found: {normalized}")
    return normalized


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

    validated_artifact_id = _validated_artifact_id(conn, artifact_id)
    payload = _handoff_payload(
        user_id=user_id,
        source=source,
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
            "source": source,
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
    artifact_id = _validated_artifact_id(conn, payload.get("artifact_id"))

    return {
        "source": source,
        "artifact_id": artifact_id,
        "draft": draft,
    }
