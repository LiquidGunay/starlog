from sqlite3 import Connection

from fastapi import APIRouter, Depends

from app.api.deps import get_db
from app.core.config import get_settings

router = APIRouter()


@router.get("/health")
def health(db: Connection = Depends(get_db)) -> dict[str, str | int]:
    settings = get_settings()
    user_count = db.execute("SELECT COUNT(*) FROM users").fetchone()[0]
    return {"status": "ok", "env": settings.env, "users": int(user_count)}
