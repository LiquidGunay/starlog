from fastapi import APIRouter

from app.api.routes import (
    agent,
    ai,
    artifacts,
    auth,
    briefings,
    calendar,
    conversations,
    capture,
    conflicts,
    events,
    export,
    health,
    importing,
    integrations,
    media,
    notes,
    ops,
    planning,
    plugins,
    search,
    srs,
    sync,
    tasks,
    workers,
)

api_router = APIRouter(prefix="/v1")
api_router.include_router(health.router, tags=["health"])
api_router.include_router(auth.router, tags=["auth"])
api_router.include_router(agent.router, tags=["agent"])
api_router.include_router(ai.router, tags=["ai"])
api_router.include_router(conversations.router, tags=["conversations"])
api_router.include_router(sync.router, tags=["sync"])
api_router.include_router(capture.router, tags=["capture"])
api_router.include_router(media.router, tags=["media"])
api_router.include_router(artifacts.router, tags=["artifacts"])
api_router.include_router(notes.router, tags=["notes"])
api_router.include_router(tasks.router, tags=["tasks"])
api_router.include_router(calendar.router, tags=["calendar"])
api_router.include_router(planning.router, tags=["planning"])
api_router.include_router(srs.router, tags=["srs"])
api_router.include_router(search.router, tags=["search"])
api_router.include_router(briefings.router, tags=["briefings"])
api_router.include_router(events.router, tags=["events"])
api_router.include_router(integrations.router, tags=["integrations"])
api_router.include_router(plugins.router, tags=["plugins"])
api_router.include_router(importing.router, tags=["import"])
api_router.include_router(ops.router, tags=["ops"])
api_router.include_router(export.router, tags=["export"])
api_router.include_router(workers.router, tags=["workers"])
api_router.include_router(conflicts.router, tags=["conflicts"])
