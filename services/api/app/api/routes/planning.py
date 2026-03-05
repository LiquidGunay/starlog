from sqlite3 import Connection

from fastapi import APIRouter, Depends

from app.api.deps import get_db, require_user_id
from app.schemas.planning import GenerateBlocksRequest, GenerateBlocksResponse, TimeBlockResponse
from app.services import planning_service

router = APIRouter(prefix="/planning")


@router.post("/blocks/generate", response_model=GenerateBlocksResponse)
def generate_blocks(
    payload: GenerateBlocksRequest,
    _user_id: str = Depends(require_user_id),
    db: Connection = Depends(get_db),
) -> GenerateBlocksResponse:
    blocks = planning_service.generate_time_blocks(
        db,
        date=payload.date,
        day_start_hour=payload.day_start_hour,
        day_end_hour=payload.day_end_hour,
    )
    return GenerateBlocksResponse(
        date=payload.date,
        generated=len(blocks),
        blocks=[TimeBlockResponse.model_validate(block) for block in blocks],
    )


@router.get("/blocks/{date}", response_model=list[TimeBlockResponse])
def list_blocks(
    date: str,
    _user_id: str = Depends(require_user_id),
    db: Connection = Depends(get_db),
) -> list[TimeBlockResponse]:
    rows = planning_service.list_blocks_for_date(db, date)
    return [TimeBlockResponse.model_validate(item) for item in rows]
