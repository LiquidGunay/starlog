from sqlite3 import Connection

from fastapi import APIRouter, Depends

from app.api.deps import get_db, require_user_id
from app.schemas.integrations import (
    CodexBridgeContractResponse,
    ExecutionPolicyRequest,
    ExecutionPolicyResponse,
    MobileLLMContractResponse,
    ProviderConfigRequest,
    ProviderConfigResponse,
    ProviderHealthResponse,
)
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


@router.get("/providers/codex_bridge/contract", response_model=CodexBridgeContractResponse)
def codex_bridge_contract(
    _user_id: str = Depends(require_user_id),
    db: Connection = Depends(get_db),
) -> CodexBridgeContractResponse:
    contract = integrations_service.codex_bridge_contract(db)
    return CodexBridgeContractResponse.model_validate(contract)


@router.get("/providers/mobile_llm/contract", response_model=MobileLLMContractResponse)
def mobile_llm_contract(
    _user_id: str = Depends(require_user_id),
    db: Connection = Depends(get_db),
) -> MobileLLMContractResponse:
    contract = integrations_service.mobile_llm_contract(db)
    return MobileLLMContractResponse.model_validate(contract)


@router.get("/providers/{provider_name}/health", response_model=ProviderHealthResponse)
def provider_health(
    provider_name: str,
    _user_id: str = Depends(require_user_id),
    db: Connection = Depends(get_db),
) -> ProviderHealthResponse:
    health = integrations_service.provider_health(db, provider_name)
    return ProviderHealthResponse.model_validate(health)


@router.get("/execution-policy", response_model=ExecutionPolicyResponse)
def get_execution_policy(
    _user_id: str = Depends(require_user_id),
    db: Connection = Depends(get_db),
) -> ExecutionPolicyResponse:
    policy = integrations_service.get_execution_policy(db)
    return ExecutionPolicyResponse.model_validate(policy)


@router.post("/execution-policy", response_model=ExecutionPolicyResponse)
def save_execution_policy(
    payload: ExecutionPolicyRequest,
    _user_id: str = Depends(require_user_id),
    db: Connection = Depends(get_db),
) -> ExecutionPolicyResponse:
    policy = integrations_service.upsert_execution_policy(db, payload.model_dump())
    return ExecutionPolicyResponse.model_validate(policy)
