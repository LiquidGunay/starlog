from app.main import app
from app.services import research_adapters
from fastapi.testclient import TestClient


def test_research_routes_are_registered() -> None:
    assert any(route.path == "/v1/research/sources" for route in app.router.routes)


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


def test_manual_research_pdf_ingest_creates_item(
    client: TestClient,
    auth_headers: dict[str, str],
    monkeypatch,
) -> None:
    monkeypatch.setattr(
        research_adapters.pdf_ingest_service,
        "extract_pdf_text",
        lambda _path: {
            "text": "Lecture one covers diffusion models, denoising, and score matching.",
            "provider": "test_extractor",
            "mode": "text_layer",
            "characters": 68,
            "usable": True,
            "alpha_ratio": 0.82,
            "space_ratio": 0.13,
            "unique_ratio": 0.24,
            "long_word_count": 12,
        },
    )

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
    assert payload["metadata"]["pdf_extraction"]["provider"] == "test_extractor"
    assert payload["metadata"]["pdf_extraction"]["notes_override_extracted"] is True
    assert payload["metadata"]["pdf_extraction"]["used_notes_fallback"] is False

    artifact_graph = client.get(f"/v1/artifacts/{payload['content_artifact_id']}/graph", headers=auth_headers)
    assert artifact_graph.status_code == 200
    artifact = artifact_graph.json()["artifact"]
    assert artifact["normalized_content"] == "Queue for deeper summary later."
    assert artifact["extracted_content"] == "Lecture one covers diffusion models, denoising, and score matching."


def test_manual_research_pdf_ingest_uses_extracted_text_when_no_notes(
    client: TestClient,
    auth_headers: dict[str, str],
    monkeypatch,
) -> None:
    monkeypatch.setattr(
        research_adapters.pdf_ingest_service,
        "extract_pdf_text",
        lambda _path: {
            "text": "Diffusion notes explain forward noising, reverse denoising, and score-based training for image generation systems.",
            "provider": "test_extractor",
            "mode": "text_layer",
            "characters": 112,
            "usable": True,
            "alpha_ratio": 0.85,
            "space_ratio": 0.12,
            "unique_ratio": 0.21,
            "long_word_count": 14,
        },
    )

    upload = client.post(
        "/v1/media/upload",
        files={"file": ("paper.pdf", b"%PDF-1.4 test payload", "application/pdf")},
        headers=auth_headers,
    )
    media_id = upload.json()["id"]

    response = client.post(
        "/v1/research/manual-pdf",
        json={"media_id": media_id, "title": "PDF without notes"},
        headers=auth_headers,
    )
    assert response.status_code == 201
    payload = response.json()
    extraction = payload["metadata"]["pdf_extraction"]
    assert extraction["usable"] is True
    assert extraction["notes_override_extracted"] is False
    assert extraction["used_notes_fallback"] is False

    artifact_graph = client.get(f"/v1/artifacts/{payload['content_artifact_id']}/graph", headers=auth_headers)
    artifact = artifact_graph.json()["artifact"]
    assert artifact["normalized_content"].startswith("Diffusion notes explain forward noising")
    assert artifact["extracted_content"].startswith("Diffusion notes explain forward noising")


def test_manual_research_pdf_ingest_rejects_unreadable_extraction_noise(
    client: TestClient,
    auth_headers: dict[str, str],
    monkeypatch,
) -> None:
    monkeypatch.setattr(
        research_adapters.pdf_ingest_service,
        "extract_pdf_text",
        lambda _path: {
            "text": "SbbbQQQMMMaaaZZZLLLPP MTdcrLsZ|kzb{fJWnZw~ ?JP```@@p``\\\\llNvvuEEG{",
            "provider": "strings",
            "mode": "heuristic_fallback",
            "characters": 76,
            "usable": False,
            "alpha_ratio": 0.34,
            "space_ratio": 0.04,
            "unique_ratio": 0.07,
            "long_word_count": 1,
        },
    )

    upload = client.post(
        "/v1/media/upload",
        files={"file": ("paper.pdf", b"%PDF-1.4 test payload", "application/pdf")},
        headers=auth_headers,
    )
    media_id = upload.json()["id"]

    response = client.post(
        "/v1/research/manual-pdf",
        json={"media_id": media_id, "title": "Unreadable PDF"},
        headers=auth_headers,
    )
    assert response.status_code == 201
    payload = response.json()
    extraction = payload["metadata"]["pdf_extraction"]
    assert extraction["usable"] is False
    assert extraction["rejected_as_noise"] is True
    assert extraction["used_notes_fallback"] is False

    artifact_graph = client.get(f"/v1/artifacts/{payload['content_artifact_id']}/graph", headers=auth_headers)
    artifact = artifact_graph.json()["artifact"]
    assert artifact["normalized_content"] == "Unreadable PDF"
    assert artifact["extracted_content"] is None


def test_manual_research_pdf_ingest_falls_back_from_noisy_ocr_to_readable_text(
    client: TestClient,
    auth_headers: dict[str, str],
    monkeypatch,
) -> None:
    monkeypatch.setattr(
        research_adapters.pdf_ingest_service,
        "_extract_with_ocr_server",
        lambda _path: "SbbbQQQMMMaaaZZZLLLPP MTdcrLsZ|kzb{fJWnZw~ ?JP```@@p``\\\\llNvvuEEG{",
    )
    monkeypatch.setattr(
        research_adapters.pdf_ingest_service,
        "_extract_with_pypdf",
        lambda _path: "Fallback PDF text explains diffusion scoring and sampling.",
    )
    monkeypatch.setattr(research_adapters.pdf_ingest_service, "_extract_with_strings", lambda _path: None)

    upload = client.post(
        "/v1/media/upload",
        files={"file": ("paper.pdf", b"%PDF-1.4 test payload", "application/pdf")},
        headers=auth_headers,
    )
    assert upload.status_code == 201
    media_id = upload.json()["id"]

    response = client.post(
        "/v1/research/manual-pdf",
        json={"media_id": media_id, "title": "Readable fallback PDF"},
        headers=auth_headers,
    )
    assert response.status_code == 201
    payload = response.json()
    extraction = payload["metadata"]["pdf_extraction"]
    assert extraction["provider"] == "pypdf"
    assert extraction["usable"] is False
    assert extraction["rejected_as_noise"] is False

    artifact_graph = client.get(f"/v1/artifacts/{payload['content_artifact_id']}/graph", headers=auth_headers)
    artifact = artifact_graph.json()["artifact"]
    assert artifact["normalized_content"] == "Fallback PDF text explains diffusion scoring and sampling."
    assert artifact["extracted_content"] == "Fallback PDF text explains diffusion scoring and sampling."


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
