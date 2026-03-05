from fastapi import APIRouter, Depends

from app.api.deps import require_user_id
from app.schemas.ai import AIRequest, AIResponse
from app.services import ai_service

router = APIRouter(prefix="/ai")


@router.post("/run", response_model=AIResponse)
def run_ai(payload: AIRequest, _user_id: str = Depends(require_user_id)) -> AIResponse:
    provider, status_text, output = ai_service.run(
        capability=payload.capability,
        payload=payload.input,
        prefer_local=payload.prefer_local,
    )
    return AIResponse(
        capability=payload.capability,
        provider_used=provider,
        status=status_text,
        output=output,
    )
