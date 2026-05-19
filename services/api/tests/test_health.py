import asyncio
import sqlite3

from app.core.config import get_settings
from app.main import app


LIFESPAN_TIMEOUT_SECONDS = 10.0


def test_health_endpoint(client) -> None:
    response = client.get("/v1/health")

    assert response.status_code == 200
    assert response.headers.get("x-request-id")
    payload = response.json()
    assert payload["status"] == "ok"


def test_lifespan_startup_initializes_storage(tmp_path, monkeypatch) -> None:
    db_path = tmp_path / "lifespan-startup.db"
    monkeypatch.setenv("STARLOG_DB_PATH", str(db_path))
    get_settings.cache_clear()

    async def run_lifespan() -> None:
        async with app.router.lifespan_context(app):
            pass

    try:
        asyncio.run(asyncio.wait_for(run_lifespan(), timeout=LIFESPAN_TIMEOUT_SECONDS))

        with sqlite3.connect(db_path) as conn:
            row = conn.execute(
                "SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'users'"
            ).fetchone()

        assert row == ("users",)
    finally:
        get_settings.cache_clear()
