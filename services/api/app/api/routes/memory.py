from sqlite3 import Connection

from fastapi import APIRouter, Depends, HTTPException, Query, status

from app.api.deps import get_db, require_user_id
from app.schemas.memory import (
    MemoryPageCreateRequest,
    MemoryPageResponse,
    MemoryPageUpdateRequest,
    MemoryPageVersionResponse,
    MemorySuggestionResponse,
    MemoryTreeResponse,
    ProfileProposalResponse,
)
from app.services import memory_vault_service

router = APIRouter(prefix="/memory")


@router.get("/tree", response_model=MemoryTreeResponse)
def get_memory_tree(
    _user_id: str = Depends(require_user_id),
    db: Connection = Depends(get_db),
) -> MemoryTreeResponse:
    return MemoryTreeResponse.model_validate({"tree": memory_vault_service.list_tree(db)})


@router.get("/pages/{page_id}", response_model=MemoryPageResponse)
def get_memory_page(
    page_id: str,
    _user_id: str = Depends(require_user_id),
    db: Connection = Depends(get_db),
) -> MemoryPageResponse:
    page = memory_vault_service.get_page(db, page_id)
    if page is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Memory page not found")
    return MemoryPageResponse.model_validate(page)


@router.post("/pages", response_model=MemoryPageResponse, status_code=status.HTTP_201_CREATED)
def create_memory_page(
    payload: MemoryPageCreateRequest,
    _user_id: str = Depends(require_user_id),
    db: Connection = Depends(get_db),
) -> MemoryPageResponse:
    try:
        page = memory_vault_service.create_page(
            db,
            title=payload.title,
            body_md=payload.body_md,
            kind=payload.kind,
            namespace=payload.namespace,
            path=payload.path,
            tags=payload.tags,
            source_refs=[item.model_dump(mode="json") for item in payload.source_refs],
            entity_refs=[item.model_dump(mode="json") for item in payload.entity_refs],
            edge_refs=[item.model_dump(mode="json") for item in payload.edge_refs],
            confidence=payload.confidence,
            status=payload.status,
            review_after=payload.review_after.isoformat() if payload.review_after else None,
        )
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc
    return MemoryPageResponse.model_validate(page)


@router.put("/pages/{page_id}", response_model=MemoryPageResponse)
def update_memory_page(
    page_id: str,
    payload: MemoryPageUpdateRequest,
    _user_id: str = Depends(require_user_id),
    db: Connection = Depends(get_db),
) -> MemoryPageResponse:
    try:
        page = memory_vault_service.update_page(
            db,
            page_id,
            markdown_source=payload.markdown_source,
            base_version=payload.base_version,
        )
    except memory_vault_service.conflict_service.RevisionConflictError as exc:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail={"code": "revision_conflict", "conflict": exc.conflict},
        ) from exc
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc
    if page is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Memory page not found")
    return MemoryPageResponse.model_validate(page)


@router.get("/pages/{page_id}/versions", response_model=list[MemoryPageVersionResponse])
def list_memory_page_versions(
    page_id: str,
    _user_id: str = Depends(require_user_id),
    db: Connection = Depends(get_db),
) -> list[MemoryPageVersionResponse]:
    return [
        MemoryPageVersionResponse.model_validate(item)
        for item in memory_vault_service.list_page_versions(db, page_id)
    ]


@router.get("/profile-proposals", response_model=list[ProfileProposalResponse])
def list_memory_profile_proposals(
    status_filter: str | None = Query(default="pending", alias="status"),
    _user_id: str = Depends(require_user_id),
    db: Connection = Depends(get_db),
) -> list[ProfileProposalResponse]:
    return [
        ProfileProposalResponse.model_validate(item)
        for item in memory_vault_service.list_profile_proposals(db, status=status_filter)
    ]


@router.post("/profile-proposals/{proposal_id}/confirm", response_model=MemoryPageResponse)
def confirm_memory_profile_proposal(
    proposal_id: str,
    _user_id: str = Depends(require_user_id),
    db: Connection = Depends(get_db),
) -> MemoryPageResponse:
    try:
        page = memory_vault_service.confirm_profile_proposal(db, proposal_id)
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc
    if page is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Memory profile proposal not found")
    return MemoryPageResponse.model_validate(page)


@router.post("/profile-proposals/{proposal_id}/dismiss", response_model=ProfileProposalResponse)
def dismiss_memory_profile_proposal(
    proposal_id: str,
    _user_id: str = Depends(require_user_id),
    db: Connection = Depends(get_db),
) -> ProfileProposalResponse:
    proposal = memory_vault_service.dismiss_profile_proposal(db, proposal_id)
    if proposal is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Memory profile proposal not found")
    return ProfileProposalResponse.model_validate(
        {
            "id": proposal["id"],
            "page_id": proposal.get("page_id"),
            "proposed_page_id": proposal["proposed_page_id"],
            "path": proposal["path"],
            "title": proposal["title"],
            "kind": proposal["kind"],
            "namespace": proposal["namespace"],
            "status": proposal["status"],
            "rationale": proposal.get("rationale"),
            "markdown_source": proposal["proposal_markdown_source"],
            "frontmatter": proposal.get("frontmatter_json") or {},
            "body_md": proposal["body_md"],
            "metadata": proposal.get("metadata_json") or {},
            "created_at": proposal["created_at"],
            "updated_at": proposal["updated_at"],
            "resolved_at": proposal.get("resolved_at"),
        }
    )


@router.get("/suggestions", response_model=list[MemorySuggestionResponse])
def list_memory_suggestions(
    surface: str = Query(..., pattern=r"^(assistant|briefing)$"),
    _user_id: str = Depends(require_user_id),
    db: Connection = Depends(get_db),
) -> list[MemorySuggestionResponse]:
    return [
        MemorySuggestionResponse.model_validate(item)
        for item in memory_vault_service.list_suggestions(db, surface=surface, refresh=True)
    ]
