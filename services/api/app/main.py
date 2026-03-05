from collections.abc import AsyncIterator
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.api.router import api_router
from app.core.config import get_settings
from app.core.logging import configure_logging
from app.db.storage import init_storage
from app.middleware_request_id import request_id_middleware

@asynccontextmanager
async def lifespan(_: FastAPI) -> AsyncIterator[None]:
    configure_logging()
    init_storage()
    yield


app = FastAPI(title="Starlog API", version="0.2.0", lifespan=lifespan)

settings = get_settings()
allow_origins = [origin.strip() for origin in settings.cors_allow_origins.split(",")]
app.add_middleware(
    CORSMiddleware,
    allow_origins=allow_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.middleware("http")(request_id_middleware)

app.include_router(api_router)
