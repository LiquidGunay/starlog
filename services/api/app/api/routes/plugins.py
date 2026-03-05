from sqlite3 import Connection

from fastapi import APIRouter, Depends, status

from app.api.deps import get_db, require_user_id
from app.schemas.plugins import PluginRegisterRequest, PluginResponse
from app.services import plugins_service

router = APIRouter(prefix="/plugins")


@router.post("", response_model=PluginResponse, status_code=status.HTTP_201_CREATED)
def register_plugin(
    payload: PluginRegisterRequest,
    _user_id: str = Depends(require_user_id),
    db: Connection = Depends(get_db),
) -> PluginResponse:
    created = plugins_service.register_plugin(
        db,
        name=payload.name,
        version=payload.version,
        capabilities=payload.capabilities,
        manifest=payload.manifest,
    )
    return PluginResponse.model_validate(created)


@router.get("", response_model=list[PluginResponse])
def list_plugins(
    _user_id: str = Depends(require_user_id),
    db: Connection = Depends(get_db),
) -> list[PluginResponse]:
    rows = plugins_service.list_plugins(db)
    return [PluginResponse.model_validate(item) for item in rows]
