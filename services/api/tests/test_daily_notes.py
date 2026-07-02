from datetime import datetime, timedelta, timezone

from app.db.storage import get_connection


def test_daily_note_upsert_creates_date_unique_entry_and_linked_note(client, auth_headers: dict[str, str]) -> None:
    missing = client.get("/v1/daily-notes/2026-07-01", headers=auth_headers)
    assert missing.status_code == 404

    created = client.put(
        "/v1/daily-notes/2026-07-01",
        json={
            "morning_plan_md": "- Make three cards\n- Review due queue",
            "evening_reflection_md": "Manual card creation worked better than bulk generation.",
        },
        headers=auth_headers,
    )
    assert created.status_code == 200
    payload = created.json()
    assert payload["date"] == "2026-07-01"
    assert payload["version"] == 1
    assert payload["morning_plan_md"].startswith("- Make three cards")
    note_id = payload["note_id"]

    fetched = client.get("/v1/daily-notes/2026-07-01", headers=auth_headers)
    assert fetched.status_code == 200
    assert fetched.json()["id"] == payload["id"]
    assert fetched.json()["note_id"] == note_id

    linked_note = client.get(f"/v1/notes/{note_id}", headers=auth_headers)
    assert linked_note.status_code == 200
    note_payload = linked_note.json()
    assert note_payload["title"] == "Daily 2026-07-01"
    assert "## Morning plan" in note_payload["body_md"]
    assert "- Make three cards" in note_payload["body_md"]
    assert "## Evening reflection" in note_payload["body_md"]
    assert "Manual card creation worked" in note_payload["body_md"]

    updated = client.put(
        "/v1/daily-notes/2026-07-01",
        json={
            "morning_plan_md": "Plan one focused study block.",
            "evening_reflection_md": "The review queue stayed small.",
        },
        headers=auth_headers,
    )
    assert updated.status_code == 200
    updated_payload = updated.json()
    assert updated_payload["id"] == payload["id"]
    assert updated_payload["note_id"] == note_id
    assert updated_payload["version"] == 2

    listed = client.get("/v1/daily-notes?limit=30", headers=auth_headers)
    assert listed.status_code == 200
    assert [item["date"] for item in listed.json()] == ["2026-07-01"]

    updated_note = client.get(f"/v1/notes/{note_id}", headers=auth_headers)
    assert updated_note.status_code == 200
    assert "Plan one focused study block." in updated_note.json()["body_md"]
    assert "Make three cards" not in updated_note.json()["body_md"]


def test_daily_note_requires_auth_and_valid_date(client) -> None:
    unauthorized = client.get("/v1/daily-notes/2026-07-01")
    assert unauthorized.status_code == 401

    client.post("/v1/auth/bootstrap", json={"passphrase": "correct horse battery staple"})
    login = client.post("/v1/auth/login", json={"passphrase": "correct horse battery staple"})
    headers = {"Authorization": f"Bearer {login.json()['access_token']}"}

    invalid_date = client.put(
        "/v1/daily-notes/not-a-date",
        json={"morning_plan_md": "Plan", "evening_reflection_md": "Reflect"},
        headers=headers,
    )
    assert invalid_date.status_code == 422


def test_manual_card_creation_uses_default_tomorrow_schedule(client, auth_headers: dict[str, str]) -> None:
    before = datetime.now(timezone.utc)
    created = client.post(
        "/v1/cards",
        json={
            "prompt": "What makes manual card writing useful?",
            "answer": "It forces retrieval framing during creation.",
        },
        headers=auth_headers,
    )
    after = datetime.now(timezone.utc)

    assert created.status_code == 201
    due_at = datetime.fromisoformat(created.json()["due_at"])
    earliest = before + timedelta(hours=23, minutes=59)
    latest = after + timedelta(hours=24, minutes=1)
    assert earliest <= due_at <= latest

    due_now = client.get("/v1/cards/due?limit=10", headers=auth_headers)
    assert due_now.status_code == 200
    assert created.json()["id"] not in {card["id"] for card in due_now.json()}

    with get_connection() as conn:
        deck = conn.execute("SELECT name FROM card_decks WHERE id = ?", (created.json()["deck_id"],)).fetchone()
    assert deck is not None
    assert deck["name"] == "Inbox"
