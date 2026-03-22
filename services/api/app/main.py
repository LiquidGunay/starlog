from collections.abc import AsyncIterator
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.api.router import api_router
from app.core.config import get_settings
from app.core.logging import configure_logging
from app.db.storage import init_storage
from app.middleware_request_id import request_id_middleware

LOCAL_COMPANION_CORS_ORIGINS = (
    "http://127.0.0.1:4173",
    "http://localhost:4173",
    "http://127.0.0.1:1420",
    "http://localhost:1420",
    "http://tauri.localhost",
    "https://tauri.localhost",
    "tauri://localhost",
    "null",
)


def resolved_cors_origins(raw_origins: str) -> list[str]:
    configured_origins = [origin.strip() for origin in raw_origins.split(",") if origin.strip()]
    if not configured_origins:
        return []
    if configured_origins == ["*"]:
        return ["*"]

    merged_origins: list[str] = []
    seen: set[str] = set()
    for origin in [*configured_origins, *LOCAL_COMPANION_CORS_ORIGINS]:
        if origin in seen:
            continue
        seen.add(origin)
        merged_origins.append(origin)
    return merged_origins


@asynccontextmanager
async def lifespan(_: FastAPI) -> AsyncIterator[None]:
    configure_logging()
    init_storage()
    yield


app = FastAPI(title="Starlog API", version="0.2.0", lifespan=lifespan)

settings = get_settings()
allow_origins = resolved_cors_origins(settings.cors_allow_origins)
app.add_middleware(
    CORSMiddleware,
    allow_origins=allow_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.middleware("http")(request_id_middleware)

app.include_router(api_router)
