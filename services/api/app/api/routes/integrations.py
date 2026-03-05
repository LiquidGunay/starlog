from sqlite3 import Connection

from fastapi import APIRouter, Depends

from app.api.deps import get_db, require_user_id
from app.schemas.integrations import ProviderConfigRequest, ProviderConfigResponse, ProviderHealthResponse
from app.services import integrations_service

router = APIRouter(prefix="/integrations")


@router.get("/providers", response_model=list[ProviderConfigResponse])
def list_providers(
    _user_id: str = Depends(require_user_id),
    db: Connection = Depends(get_db),
) -> list[ProviderConfigResponse]:
    rows = integrations_service.list_provider_configs(db)
    return [ProviderConfigResponse.model_validate(item) for item in rows]


@router.post("/providers/{provider_name}", response_model=ProviderConfigResponse)
def configure_provider(
    provider_name: str,
    payload: ProviderConfigRequest,
    _user_id: str = Depends(require_user_id),
    db: Connection = Depends(get_db),
) -> ProviderConfigResponse:
    config = integrations_service.upsert_provider_config(
        db,
        provider_name=provider_name,
        enabled=payload.enabled,
        mode=payload.mode,
        config=payload.config,
    )
    return ProviderConfigResponse.model_validate(config)


@router.get("/providers/{provider_name}/health", response_model=ProviderHealthResponse)
def provider_health(
    provider_name: str,
    _user_id: str = Depends(require_user_id),
    db: Connection = Depends(get_db),
) -> ProviderHealthResponse:
    health = integrations_service.provider_health(db, provider_name)
    return ProviderHealthResponse.model_validate(health)
