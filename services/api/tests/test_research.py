from app.services import research_adapters
from fastapi.testclient import TestClient


def test_research_sources_bootstrap(client: TestClient, auth_headers: dict[str, str]) -> None:
    response = client.get("/v1/research/sources", headers=auth_headers)
    assert response.status_code == 200
    payload = response.json()
    kinds = {item["source_kind"] for item in payload}
    assert {"arxiv", "manual_url", "manual_pdf"} <= kinds


def test_manual_research_url_ingest_creates_item(client: TestClient, auth_headers: dict[str, str]) -> None:
    response = client.post(
        "/v1/research/manual-url",
        json={
            "title": "Example paper",
            "url": "https://arxiv.org/abs/1234.5678",
            "notes": "Read for retrieval systems.",
        },
        headers=auth_headers,
    )
    assert response.status_code == 201
    payload = response.json()
    assert payload["title"] == "Example paper"
    assert payload["content_artifact_id"].startswith("art_")

    items = client.get("/v1/research/items", headers=auth_headers)
    assert items.status_code == 200
    assert items.json()[0]["id"] == payload["id"]


def test_manual_research_pdf_ingest_creates_item(client: TestClient, auth_headers: dict[str, str]) -> None:
    upload = client.post(
        "/v1/media/upload",
        files={"file": ("paper.pdf", b"%PDF-1.4 test payload", "application/pdf")},
        headers=auth_headers,
    )
    assert upload.status_code == 201
    media_id = upload.json()["id"]

    response = client.post(
        "/v1/research/manual-pdf",
        json={
            "media_id": media_id,
            "title": "PDF paper",
            "notes": "Queue for deeper summary later.",
        },
        headers=auth_headers,
    )
    assert response.status_code == 201
    payload = response.json()
    assert payload["title"] == "PDF paper"
    assert payload["metadata"]["ingest_kind"] == "manual_pdf"


def test_arxiv_ingest_uses_adapter_and_persists_item(
    client: TestClient,
    auth_headers: dict[str, str],
    monkeypatch,
) -> None:
    monkeypatch.setattr(
        research_adapters,
        "fetch_arxiv_entry",
        lambda _arxiv_id: {
            "arxiv_id": "2403.01234",
            "title": "Voice-native Research Agent",
            "summary": "A paper about ranking and summarization.",
            "entry_id": "http://arxiv.org/abs/2403.01234v1",
            "url": "https://arxiv.org/abs/2403.01234",
            "authors": ["A. Researcher", "B. Builder"],
            "published_at": "2026-03-20T12:00:00Z",
            "categories": ["cs.IR"],
        },
    )

    response = client.post(
        "/v1/research/arxiv",
        json={"url": "https://arxiv.org/abs/2403.01234"},
        headers=auth_headers,
    )
    assert response.status_code == 201
    payload = response.json()
    assert payload["external_id"] == "2403.01234"
    assert payload["authors"] == ["A. Researcher", "B. Builder"]
    assert payload["metadata"]["source_kind"] == "arxiv"


def test_generate_digest_ranks_and_persists_items(client: TestClient, auth_headers: dict[str, str]) -> None:
    client.post(
        "/v1/research/manual-url",
        json={
            "title": "Older note",
            "url": "https://example.com/old",
            "notes": "Short note",
        },
        headers=auth_headers,
    )
    client.post(
        "/v1/research/manual-url",
        json={
            "title": "Richer note",
            "url": "https://example.com/richer",
            "notes": "This note has a substantially longer abstract-like body for ranking.",
        },
        headers=auth_headers,
    )

    response = client.post(
        "/v1/research/digests/generate",
        json={"limit": 2, "title": "Top 2 research"},
        headers=auth_headers,
    )
    assert response.status_code == 201
    payload = response.json()
    assert payload["title"] == "Top 2 research"
    assert payload["provider"] == "heuristic_research_digest_v1"
    assert len(payload["items"]) == 2
    assert payload["summary_md"].startswith("# Top 2 research")

    listing = client.get("/v1/research/digests", headers=auth_headers)
    assert listing.status_code == 200
    assert listing.json()[0]["id"] == payload["id"]


def test_deep_summary_returns_markdown_for_item(client: TestClient, auth_headers: dict[str, str]) -> None:
    created = client.post(
        "/v1/research/manual-url",
        json={
            "title": "Deep dive",
            "url": "https://example.com/deep",
            "notes": "This is the core abstract for a deeper summary.",
        },
        headers=auth_headers,
    )
    assert created.status_code == 201
    item_id = created.json()["id"]

    response = client.post(
        f"/v1/research/items/{item_id}/deep-summary",
        json={"focus": "ranking strategy"},
        headers=auth_headers,
    )
    assert response.status_code == 200
    payload = response.json()
    assert payload["item_id"] == item_id
    assert "ranking strategy" in payload["summary_md"]
    assert payload["provider"] == "heuristic_research_deep_summary_v1"
