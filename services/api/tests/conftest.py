from collections.abc import Iterator

import pytest
from fastapi.testclient import TestClient

from app.core.config import get_settings
from app.main import app


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
