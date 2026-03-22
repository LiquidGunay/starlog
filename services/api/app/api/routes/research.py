from sqlite3 import Connection

from fastapi import APIRouter, Depends, HTTPException, status

from app.api.deps import get_db, require_user_id
from app.schemas.research import (
    ArxivResearchIngestRequest,
    ManualResearchPdfRequest,
    ManualResearchUrlRequest,
    ResearchDeepSummaryRequest,
    ResearchDeepSummaryResponse,
    ResearchDigestGenerateRequest,
    ResearchDigestResponse,
    ResearchItemResponse,
    ResearchSourceResponse,
    ResearchSourceUpsertRequest,
)
from app.services import research_service

router = APIRouter(prefix="/research")


@router.get("/sources", response_model=list[ResearchSourceResponse])
def list_research_sources(
    _user_id: str = Depends(require_user_id),
    db: Connection = Depends(get_db),
) -> list[ResearchSourceResponse]:
    return [ResearchSourceResponse.model_validate(item) for item in research_service.list_sources(db)]


@router.post("/sources", response_model=ResearchSourceResponse, status_code=status.HTTP_201_CREATED)
def save_research_source(
    payload: ResearchSourceUpsertRequest,
    _user_id: str = Depends(require_user_id),
    db: Connection = Depends(get_db),
) -> ResearchSourceResponse:
    item = research_service.upsert_source(
        db,
        source_kind=payload.source_kind,
        label=payload.label,
        enabled=payload.enabled,
        config=payload.config,
    )
    return ResearchSourceResponse.model_validate(item)


@router.get("/items", response_model=list[ResearchItemResponse])
def list_research_items(
    _user_id: str = Depends(require_user_id),
    db: Connection = Depends(get_db),
) -> list[ResearchItemResponse]:
    return [ResearchItemResponse.model_validate(item) for item in research_service.list_items(db)]


@router.post("/manual-url", response_model=ResearchItemResponse, status_code=status.HTTP_201_CREATED)
def ingest_manual_url(
    payload: ManualResearchUrlRequest,
    _user_id: str = Depends(require_user_id),
    db: Connection = Depends(get_db),
) -> ResearchItemResponse:
    item = research_service.record_manual_url(
        db,
        title=payload.title,
        url=str(payload.url),
        notes=payload.notes,
    )
    return ResearchItemResponse.model_validate(item)


@router.post("/manual-pdf", response_model=ResearchItemResponse, status_code=status.HTTP_201_CREATED)
def ingest_manual_pdf(
    payload: ManualResearchPdfRequest,
    _user_id: str = Depends(require_user_id),
    db: Connection = Depends(get_db),
) -> ResearchItemResponse:
    try:
        item = research_service.record_manual_pdf(
            db,
            media_id=payload.media_id,
            title=payload.title,
            notes=payload.notes,
        )
    except LookupError as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc)) from exc
    return ResearchItemResponse.model_validate(item)


@router.get("/digests", response_model=list[ResearchDigestResponse])
def list_research_digests(
    _user_id: str = Depends(require_user_id),
    db: Connection = Depends(get_db),
) -> list[ResearchDigestResponse]:
    return [ResearchDigestResponse.model_validate(item) for item in research_service.list_digests(db)]


@router.post("/arxiv", response_model=ResearchItemResponse, status_code=status.HTTP_201_CREATED)
def ingest_arxiv_entry(
    payload: ArxivResearchIngestRequest,
    _user_id: str = Depends(require_user_id),
    db: Connection = Depends(get_db),
) -> ResearchItemResponse:
    try:
        item = research_service.record_arxiv_entry(
            db,
            arxiv_id=payload.arxiv_id,
            url=str(payload.url) if payload.url is not None else None,
            title=payload.title,
            notes=payload.notes,
        )
    except LookupError as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc)) from exc
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail=str(exc)) from exc
    return ResearchItemResponse.model_validate(item)


@router.post("/digests/generate", response_model=ResearchDigestResponse, status_code=status.HTTP_201_CREATED)
def generate_research_digest(
    payload: ResearchDigestGenerateRequest,
    _user_id: str = Depends(require_user_id),
    db: Connection = Depends(get_db),
) -> ResearchDigestResponse:
    digest = research_service.generate_digest(
        db,
        digest_date=payload.digest_date,
        limit=payload.limit,
        source_kind=payload.source_kind,
        title=payload.title,
    )
    return ResearchDigestResponse.model_validate(digest)


@router.post("/items/{item_id}/deep-summary", response_model=ResearchDeepSummaryResponse)
def deep_summary_for_item(
    item_id: str,
    payload: ResearchDeepSummaryRequest,
    _user_id: str = Depends(require_user_id),
    db: Connection = Depends(get_db),
) -> ResearchDeepSummaryResponse:
    try:
        summary = research_service.generate_deep_summary(db, item_id=item_id, focus=payload.focus)
    except LookupError as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc)) from exc
    return ResearchDeepSummaryResponse.model_validate(summary)
