from sqlite3 import Connection

from fastapi import APIRouter, Depends, Query

from app.api.deps import get_db, require_user_id
from app.schemas.search import SearchResponse, SearchResultResponse
from app.services import search_service

router = APIRouter(prefix="/search")


@router.get("", response_model=SearchResponse)
def search(
    q: str = Query(..., min_length=1),
    limit: int = Query(default=20, ge=1, le=100),
    _user_id: str = Depends(require_user_id),
    db: Connection = Depends(get_db),
) -> SearchResponse:
    results = search_service.search(db, q.strip(), limit)
    return SearchResponse(
        query=q.strip(),
        total=len(results),
        results=[SearchResultResponse.model_validate(item) for item in results],
    )
