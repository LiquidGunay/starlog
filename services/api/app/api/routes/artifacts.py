from sqlite3 import Connection

from fastapi import APIRouter, Depends, HTTPException, status

from app.api.deps import get_db, require_user_id
from app.schemas.artifacts import (
    ArtifactActionRequest,
    ArtifactActionResponse,
    ArtifactCreateRequest,
    ArtifactGraphResponse,
    ArtifactResponse,
    ArtifactVersionsResponse,
)
from app.services import artifacts_service

router = APIRouter(prefix="/artifacts")


@router.post("", response_model=ArtifactResponse, status_code=status.HTTP_201_CREATED)
def create_artifact(
    payload: ArtifactCreateRequest,
    _user_id: str = Depends(require_user_id),
    db: Connection = Depends(get_db),
) -> ArtifactResponse:
    return ArtifactResponse.model_validate(
        artifacts_service.create_artifact(
            db,
            source_type=payload.source_type,
            title=payload.title,
            raw_content=payload.raw_content,
            normalized_content=payload.normalized_content,
            extracted_content=payload.extracted_content,
            metadata=payload.metadata,
        )
    )


@router.get("", response_model=list[ArtifactResponse])
def list_artifacts(
    _user_id: str = Depends(require_user_id),
    db: Connection = Depends(get_db),
) -> list[ArtifactResponse]:
    rows = artifacts_service.list_artifacts(db)
    return [ArtifactResponse.model_validate(row) for row in rows]


@router.post("/{artifact_id}/actions", response_model=ArtifactActionResponse)
def run_artifact_action(
    artifact_id: str,
    payload: ArtifactActionRequest,
    _user_id: str = Depends(require_user_id),
    db: Connection = Depends(get_db),
) -> ArtifactActionResponse:
    status_text, output_ref = artifacts_service.run_action(
        db,
        artifact_id,
        payload.action,
        defer=payload.defer,
        provider_hint=payload.provider_hint,
    )
    if status_text == "not_found":
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Artifact not found")

    return ArtifactActionResponse(
        artifact_id=artifact_id,
        action=payload.action,
        status=status_text,
        output_ref=output_ref,
    )


@router.get("/{artifact_id}/graph", response_model=ArtifactGraphResponse)
def artifact_graph(
    artifact_id: str,
    _user_id: str = Depends(require_user_id),
    db: Connection = Depends(get_db),
) -> ArtifactGraphResponse:
    graph = artifacts_service.get_artifact_graph(db, artifact_id)
    if graph is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Artifact not found")
    return ArtifactGraphResponse.model_validate(graph)


@router.get("/{artifact_id}/versions", response_model=ArtifactVersionsResponse)
def artifact_versions(
    artifact_id: str,
    _user_id: str = Depends(require_user_id),
    db: Connection = Depends(get_db),
) -> ArtifactVersionsResponse:
    versions = artifacts_service.get_artifact_versions(db, artifact_id)
    if versions is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Artifact not found")
    return ArtifactVersionsResponse.model_validate(versions)
