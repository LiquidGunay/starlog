from __future__ import annotations

from pathlib import Path

import pytest

from app.core.config import get_settings
from app.db.storage import get_connection, init_storage
from app.services import artifacts_service


@pytest.fixture
def db_conn(tmp_path: Path, monkeypatch: pytest.MonkeyPatch):
    monkeypatch.setenv("STARLOG_DB_PATH", str(tmp_path / "starlog-test.db"))
    monkeypatch.setenv("STARLOG_MEDIA_DIR", str(tmp_path / "media"))
    get_settings.cache_clear()
    init_storage()
    with get_connection() as conn:
        yield conn
    get_settings.cache_clear()


def test_card_action_blocks_unreadable_manual_pdf_extraction(db_conn, monkeypatch: pytest.MonkeyPatch) -> None:
    artifact = artifacts_service.create_artifact(
        db_conn,
        source_type="research_manual_pdf",
        title="Inference Engineering",
        raw_content="blob_ref",
        normalized_content="Inference Engineering",
        extracted_content=None,
        metadata={
            "research": {
                "pdf_extraction": {
                    "provider": "strings",
                    "mode": "heuristic_fallback",
                    "usable": False,
                    "readable": False,
                    "rejected_as_noise": True,
                    "used_notes_fallback": False,
                    "notes_override_extracted": False,
                }
            }
        },
    )

    def fail_if_called(*_args, **_kwargs):
        raise AssertionError("llm_cards should not run for unreadable PDF extraction")

    monkeypatch.setattr(artifacts_service.ai_service, "run", fail_if_called)

    status, output_ref = artifacts_service.run_action(db_conn, str(artifact["id"]), "cards")

    assert status == "blocked"
    assert output_ref is None
    assert db_conn.execute("SELECT COUNT(*) FROM card_set_versions").fetchone()[0] == 0
    action_run = db_conn.execute("SELECT status, output_ref FROM action_runs WHERE action = 'cards'").fetchone()
    assert action_run["status"] == "blocked"
    assert action_run["output_ref"] is None


def test_card_action_allows_manual_pdf_notes_fallback(db_conn, monkeypatch: pytest.MonkeyPatch) -> None:
    artifact = artifacts_service.create_artifact(
        db_conn,
        source_type="research_manual_pdf",
        title="Inference Engineering",
        raw_content="blob_ref",
        normalized_content="Trusted local notes about inference systems.",
        extracted_content=None,
        metadata={
            "research": {
                "pdf_extraction": {
                    "provider": "none",
                    "mode": "unavailable",
                    "usable": False,
                    "readable": False,
                    "rejected_as_noise": False,
                    "used_notes_fallback": True,
                    "notes_override_extracted": False,
                }
            }
        },
    )

    monkeypatch.setattr(
        artifacts_service.ai_service,
        "run",
        lambda *_args, **_kwargs: (
            "test_provider",
            "completed",
            {
                "cards": [
                    {
                        "prompt": "What should the inference notes preserve?",
                        "answer": "Trusted local notes.",
                        "card_type": "qa",
                    }
                ]
            },
        ),
    )

    status, output_ref = artifacts_service.run_action(db_conn, str(artifact["id"]), "cards")

    assert status == "completed"
    assert output_ref is not None
    assert db_conn.execute("SELECT COUNT(*) FROM card_set_versions").fetchone()[0] == 1
    assert db_conn.execute("SELECT COUNT(*) FROM cards").fetchone()[0] == 1
