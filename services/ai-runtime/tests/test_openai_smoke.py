import json
import importlib.util
from pathlib import Path

import pytest


def _load_openai_smoke_module():
    module_path = Path(__file__).resolve().parents[1] / "scripts" / "openai_smoke.py"
    spec = importlib.util.spec_from_file_location("starlog_openai_smoke", module_path)
    if spec is None or spec.loader is None:
        raise RuntimeError("Unable to load openai_smoke.py")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def test_build_request_payload_defaults_to_ping(monkeypatch: pytest.MonkeyPatch) -> None:
    openai_smoke = _load_openai_smoke_module()
    monkeypatch.delenv("STARLOG_OPENAI_SMOKE_WORKFLOW", raising=False)

    workflow, payload = openai_smoke.build_request_payload("gpt-5.4-mini")

    assert workflow == "ping"
    assert payload["model"] == "gpt-5.4-mini"
    assert "Reply with JSON only" in str(payload["input"])


def test_build_request_payload_uses_workflow_prompts(monkeypatch: pytest.MonkeyPatch) -> None:
    openai_smoke = _load_openai_smoke_module()
    monkeypatch.setenv("STARLOG_OPENAI_SMOKE_WORKFLOW", "research_digest")
    monkeypatch.setenv("STARLOG_OPENAI_SMOKE_TITLE", "Arxiv smoke")
    monkeypatch.setenv("STARLOG_OPENAI_SMOKE_TEXT", "Rank these papers.")
    monkeypatch.setenv("STARLOG_OPENAI_SMOKE_CONTEXT", json.dumps({"source": "arxiv"}))

    workflow, payload = openai_smoke.build_request_payload("gpt-5.4-mini")

    assert workflow == "research_digest"
    assert "Workflow: research_digest" in str(payload["input"])
    assert "Arxiv smoke" in str(payload["input"])
    assert "Rank these papers." in str(payload["input"])


def test_load_context_requires_json_object(monkeypatch: pytest.MonkeyPatch) -> None:
    openai_smoke = _load_openai_smoke_module()
    monkeypatch.setenv("STARLOG_OPENAI_SMOKE_WORKFLOW", "chat_turn")
    monkeypatch.setenv("STARLOG_OPENAI_SMOKE_CONTEXT", json.dumps(["not", "an", "object"]))

    with pytest.raises(ValueError):
        openai_smoke.build_request_payload("gpt-5.4-mini")
