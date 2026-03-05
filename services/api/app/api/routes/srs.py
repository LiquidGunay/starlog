from sqlite3 import Connection

from fastapi import APIRouter, Depends, HTTPException, Query, status

from app.api.deps import get_db, require_user_id
from app.schemas.srs import CardResponse, ReviewCreateRequest, ReviewResponse
from app.services import srs_service

router = APIRouter()


@router.get("/cards/due", response_model=list[CardResponse])
def list_due_cards(
    limit: int = Query(default=20, ge=1, le=200),
    _user_id: str = Depends(require_user_id),
    db: Connection = Depends(get_db),
) -> list[CardResponse]:
    cards = srs_service.due_cards(db, limit)
    return [CardResponse.model_validate(card) for card in cards]


@router.post("/reviews", response_model=ReviewResponse, status_code=status.HTTP_201_CREATED)
def review_card(
    payload: ReviewCreateRequest,
    _user_id: str = Depends(require_user_id),
    db: Connection = Depends(get_db),
) -> ReviewResponse:
    reviewed = srs_service.review_card(
        db,
        card_id=payload.card_id,
        rating=payload.rating,
        latency_ms=payload.latency_ms,
    )
    if reviewed is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Card not found")
    return ReviewResponse.model_validate(reviewed)
