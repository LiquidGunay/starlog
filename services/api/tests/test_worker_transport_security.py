from fastapi.testclient import TestClient

from app.core.config import get_settings


def _set_prod_env(monkeypatch) -> None:
    monkeypatch.setenv("STARLOG_ENV", "prod")
    get_settings.cache_clear()


def test_worker_refresh_rejects_plain_http_in_prod(client: TestClient, monkeypatch) -> None:
    _set_prod_env(monkeypatch)

    response = client.post(
        "/v1/workers/auth/refresh",
        json={"worker_id": "wrk_demo", "refresh_token": "x" * 24},
    )

    assert response.status_code == 400
    assert "require HTTPS" in response.json()["detail"]


def test_worker_refresh_allows_forwarded_https_in_prod(client: TestClient, monkeypatch) -> None:
    _set_prod_env(monkeypatch)

    response = client.post(
        "/v1/workers/auth/refresh",
        json={"worker_id": "wrk_demo", "refresh_token": "x" * 24},
        headers={"X-Forwarded-Proto": "https"},
    )

    # Secure transport check passes, then auth validation runs.
    assert response.status_code == 401


def test_worker_refresh_rejects_forwarded_http_in_prod(client: TestClient, monkeypatch) -> None:
    _set_prod_env(monkeypatch)

    response = client.post(
        "/v1/workers/auth/refresh",
        json={"worker_id": "wrk_demo", "refresh_token": "x" * 24},
        headers={"X-Forwarded-Proto": "http"},
    )

    assert response.status_code == 400


def test_worker_session_route_accepts_first_forwarded_scheme_entry(client: TestClient, monkeypatch) -> None:
    _set_prod_env(monkeypatch)

    response = client.post(
        "/v1/ai/jobs/claim-next",
        json={},
        headers={"X-Forwarded-Proto": "https, http"},
    )

    # Transport is accepted; missing worker auth token becomes the next failure.
    assert response.status_code == 401
