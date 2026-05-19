def test_health_endpoint(client) -> None:
    response = client.get("/v1/health")

    assert response.status_code == 200
    assert response.headers.get("x-request-id")
    payload = response.json()
    assert payload["status"] == "ok"
