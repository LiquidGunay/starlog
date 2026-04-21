from sqlite3 import Connection

from fastapi import APIRouter, Depends, HTTPException, Query, status

from app.api.deps import get_db, require_user_id
from app.schemas.srs import (
    CardCreateRequest,
    CardDeckCreateRequest,
    CardDeckResponse,
    CardDeckUpdateRequest,
    CardResponse,
    CardUpdateRequest,
    ReviewCreateRequest,
    ReviewResponse,
)
from app.services import assistant_event_service, srs_service


def _review_rating_label(rating: int) -> str:
    return {
        1: "Again",
        2: "Again",
        3: "Hard",
        4: "Good",
        5: "Easy",
    }.get(rating, f"Rating {rating}")

router = APIRouter()


@router.get("/cards", response_model=list[CardResponse])
def list_cards(
    deck_id: str | None = Query(default=None),
    tag: str | None = Query(default=None),
    limit: int = Query(default=200, ge=1, le=500),
    _user_id: str = Depends(require_user_id),
    db: Connection = Depends(get_db),
) -> list[CardResponse]:
    cards = srs_service.list_cards(db, deck_id=deck_id, tag=tag, limit=limit)
    return [CardResponse.model_validate(card) for card in cards]


@router.get("/cards/due", response_model=list[CardResponse])
def list_due_cards(
    limit: int = Query(default=20, ge=1, le=200),
    _user_id: str = Depends(require_user_id),
    db: Connection = Depends(get_db),
) -> list[CardResponse]:
    cards = srs_service.due_cards(db, limit)
    return [CardResponse.model_validate(card) for card in cards]


@router.post("/cards", response_model=CardResponse, status_code=status.HTTP_201_CREATED)
def create_card(
    payload: CardCreateRequest,
    _user_id: str = Depends(require_user_id),
    db: Connection = Depends(get_db),
) -> CardResponse:
    created = srs_service.create_card(
        db,
        prompt=payload.prompt,
        answer=payload.answer,
        card_type=payload.card_type,
        deck_id=payload.deck_id,
        tags=payload.tags,
        due_at=payload.due_at,
        interval_days=payload.interval_days,
        repetitions=payload.repetitions,
        ease_factor=payload.ease_factor,
        suspended=payload.suspended,
        artifact_id=payload.artifact_id,
        note_block_id=payload.note_block_id,
    )
    return CardResponse.model_validate(created)


@router.patch("/cards/{card_id}", response_model=CardResponse)
def update_card(
    card_id: str,
    payload: CardUpdateRequest,
    _user_id: str = Depends(require_user_id),
    db: Connection = Depends(get_db),
) -> CardResponse:
    try:
        updated = srs_service.update_card(db, card_id=card_id, payload=payload.model_dump(exclude_unset=True))
    except ValueError as error:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail=str(error)) from error
    if updated is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Card not found")
    return CardResponse.model_validate(updated)


@router.get("/cards/decks", response_model=list[CardDeckResponse])
def list_card_decks(
    _user_id: str = Depends(require_user_id),
    db: Connection = Depends(get_db),
) -> list[CardDeckResponse]:
    decks = srs_service.list_decks(db)
    return [CardDeckResponse.model_validate(deck) for deck in decks]


@router.post("/cards/decks", response_model=CardDeckResponse, status_code=status.HTTP_201_CREATED)
def create_card_deck(
    payload: CardDeckCreateRequest,
    _user_id: str = Depends(require_user_id),
    db: Connection = Depends(get_db),
) -> CardDeckResponse:
    try:
        deck = srs_service.create_deck(
            db,
            name=payload.name,
            description=payload.description,
            schedule=payload.schedule.model_dump(),
        )
    except ValueError as error:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail=str(error)) from error
    return CardDeckResponse.model_validate(deck)


@router.patch("/cards/decks/{deck_id}", response_model=CardDeckResponse)
def update_card_deck(
    deck_id: str,
    payload: CardDeckUpdateRequest,
    _user_id: str = Depends(require_user_id),
    db: Connection = Depends(get_db),
) -> CardDeckResponse:
    update_payload = payload.model_dump(exclude_unset=True)
    try:
        updated = srs_service.update_deck(db, deck_id=deck_id, payload=update_payload)
    except ValueError as error:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail=str(error)) from error
    if updated is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Deck not found")
    return CardDeckResponse.model_validate(updated)


@router.post("/reviews", response_model=ReviewResponse, status_code=status.HTTP_201_CREATED)
def review_card(
    payload: ReviewCreateRequest,
    user_id: str = Depends(require_user_id),
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
    try:
        rating_label = _review_rating_label(payload.rating)
        assistant_event_service.create_surface_event(
            db,
            thread_id="primary",
            source_surface="review",
            kind="review.answer.graded",
            entity_ref={"entity_type": "card", "entity_id": payload.card_id, "href": "/review"},
            payload={
                "card_id": payload.card_id,
                "rating": payload.rating,
                "label": f"Review graded: {rating_label}",
                "body": f"Next due {str(reviewed['next_due_at'])[:10]}",
                **reviewed,
            },
            visibility="ambient",
            user_id=user_id,
        )
    except Exception:
        # Review submission is primary; assistant reflection should not block the SRS path.
        pass
    return ReviewResponse.model_validate(reviewed)
