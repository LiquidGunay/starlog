from __future__ import annotations

from sqlite3 import IntegrityError

import pytest


def test_default_deck_bootstrap_recovers_when_insert_race_creates_same_name(monkeypatch: pytest.MonkeyPatch) -> None:
    from app.services import srs_service

    existing_default_deck = {
        "id": "cdk_existing",
        "name": srs_service.DEFAULT_DECK_NAME,
        "description": "Default deck for imported and generated cards.",
        "schedule_json": dict(srs_service.DEFAULT_SCHEDULE),
        "created_at": "2026-04-02T00:00:00+00:00",
        "updated_at": "2026-04-02T00:00:00+00:00",
    }
    conflict_deck_id = "cdk_conflict"

    query_calls: list[tuple[str, tuple | None]] = []

    class FakeConnection:
        def __init__(self) -> None:
            self.insert_attempted = False
            self.rollback_called = False
            self.reassigned_deck_id: str | None = None

        def execute(self, query: str, params: tuple | None = None):
            normalized = " ".join(query.split())
            if normalized.startswith("INSERT INTO card_decks"):
                self.insert_attempted = True
                raise IntegrityError("UNIQUE constraint failed: card_decks.name")
            if normalized.startswith("UPDATE cards SET deck_id = ?"):
                self.reassigned_deck_id = str((params or ("",))[0])
                return None
            raise AssertionError(f"Unexpected query: {normalized}")

        def commit(self) -> None:
            return None

        def rollback(self) -> None:
            self.rollback_called = True

    fake_conn = FakeConnection()

    def fake_fetchone(_conn, query: str, params: tuple):
        normalized = " ".join(query.split())
        query_calls.append((normalized, params))

        if "WHERE name = ?" in normalized:
            return existing_default_deck if fake_conn.insert_attempted else None
        if "WHERE id = ?" in normalized:
            if params and params[0] == existing_default_deck["id"]:
                return existing_default_deck
            return None
        raise AssertionError(f"Unexpected fetchone query: {normalized}")

    monkeypatch.setattr(srs_service, "execute_fetchone", fake_fetchone)
    monkeypatch.setattr(srs_service, "new_id", lambda _prefix: conflict_deck_id)

    payload = srs_service.ensure_default_deck(fake_conn)  # type: ignore[arg-type]

    assert payload["id"] == existing_default_deck["id"]
    assert fake_conn.rollback_called is True
    assert fake_conn.reassigned_deck_id == existing_default_deck["id"]
    assert not any(
        normalized.startswith("SELECT id, name, description, schedule_json, created_at, updated_at")
        and params is not None
        and params[0] == conflict_deck_id
        for normalized, params in query_calls
    )
