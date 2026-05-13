from collections.abc import Iterator
import sys

import pytest
from fastapi.testclient import TestClient

from app.core.config import get_settings
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


@pytest.fixture
def client(tmp_path, monkeypatch: pytest.MonkeyPatch) -> Iterator[TestClient]:
    monkeypatch.setenv("STARLOG_DB_PATH", str(tmp_path / "starlog-test.db"))
    get_settings.cache_clear()
    with TestClient(app) as test_client:
        yield test_client
    get_settings.cache_clear()


@pytest.fixture
def auth_headers(client: TestClient) -> dict[str, str]:
    client.post("/v1/auth/bootstrap", json={"passphrase": "correct horse battery staple"})
    response = client.post("/v1/auth/login", json={"passphrase": "correct horse battery staple"})
    token = response.json()["access_token"]
    return {"Authorization": f"Bearer {token}"}
