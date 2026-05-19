from collections.abc import Iterator
import asyncio
import sys
from typing import Any

import httpx
import pytest

from app.core.config import get_settings
from app.db.storage import init_storage
from app.main import app


def pytest_sessionstart(session: pytest.Session) -> None:
    if sys.version_info[:2] != (3, 12):
        pytest.exit(
            "Starlog API tests target Python 3.12. "
            "Use `uv run --project services/api --extra dev --python 3.12 pytest ...`; "
            "sync TestClient paths can hang under Python 3.13 on this host.",
            returncode=2,
        )


@pytest.fixture(autouse=True)
def isolate_ai_runtime_base_url(monkeypatch: pytest.MonkeyPatch) -> Iterator[None]:
    monkeypatch.delenv("STARLOG_AI_RUNTIME_BASE_URL", raising=False)
    yield


class LocalASGITestClient:
    """Synchronous test facade over httpx.ASGITransport with a per-request deadline."""

    def __init__(self, *, request_timeout_seconds: float = 10.0) -> None:
        self._request_timeout_seconds = request_timeout_seconds

    def request(self, method: str, url: str, **kwargs: Any) -> httpx.Response:
        return asyncio.run(self._request(method, url, **kwargs))

    async def _request(self, method: str, url: str, **kwargs: Any) -> httpx.Response:
        # ASGITransport exercises routes only; FastAPI lifespan coverage lives in test_health.py.
        transport = httpx.ASGITransport(app=app, raise_app_exceptions=True)
        async with httpx.AsyncClient(
            transport=transport,
            base_url="http://testserver",
            follow_redirects=True,
        ) as async_client:
            return await asyncio.wait_for(
                async_client.request(method, url, **kwargs),
                timeout=self._request_timeout_seconds,
            )

    def get(self, url: str, **kwargs: Any) -> httpx.Response:
        return self.request("GET", url, **kwargs)

    def post(self, url: str, **kwargs: Any) -> httpx.Response:
        return self.request("POST", url, **kwargs)

    def patch(self, url: str, **kwargs: Any) -> httpx.Response:
        return self.request("PATCH", url, **kwargs)

    def put(self, url: str, **kwargs: Any) -> httpx.Response:
        return self.request("PUT", url, **kwargs)

    def delete(self, url: str, **kwargs: Any) -> httpx.Response:
        return self.request("DELETE", url, **kwargs)


@pytest.fixture
def client(tmp_path, monkeypatch: pytest.MonkeyPatch) -> Iterator[LocalASGITestClient]:
    monkeypatch.setenv("STARLOG_DB_PATH", str(tmp_path / "starlog-test.db"))
    get_settings.cache_clear()
    init_storage()
    yield LocalASGITestClient()
    get_settings.cache_clear()


@pytest.fixture
def auth_headers(client: LocalASGITestClient) -> dict[str, str]:
    client.post("/v1/auth/bootstrap", json={"passphrase": "correct horse battery staple"})
    response = client.post("/v1/auth/login", json={"passphrase": "correct horse battery staple"})
    token = response.json()["access_token"]
    return {"Authorization": f"Bearer {token}"}
