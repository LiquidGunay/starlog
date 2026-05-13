from __future__ import annotations

import importlib
import sys
import types
from pathlib import Path


REPO_ROOT = Path(__file__).resolve().parents[2]
SCRIPTS_DIR = REPO_ROOT / "scripts"
if str(SCRIPTS_DIR) not in sys.path:
    sys.path.insert(0, str(SCRIPTS_DIR))


def _load_server_with_fastapi_stub(monkeypatch):
    module = types.ModuleType("fastapi")

    class FastAPI:
        def __init__(self, *_args, **_kwargs) -> None:
            pass

        def get(self, *_args, **_kwargs):
            return lambda func: func

        def post(self, *_args, **_kwargs):
            return lambda func: func

    class HTTPException(Exception):
        def __init__(self, status_code: int, detail: str) -> None:
            super().__init__(detail)
            self.status_code = status_code
            self.detail = detail

    class UploadFile:
        pass

    module.FastAPI = FastAPI
    module.File = lambda *args, **kwargs: None
    module.Form = lambda default="", *args, **kwargs: default
    module.HTTPException = HTTPException
    module.UploadFile = UploadFile
    monkeypatch.setitem(sys.modules, "fastapi", module)
    sys.modules.pop("liteparse_parse_server", None)
    return importlib.import_module("liteparse_parse_server")


def test_liteparse_payload_text_uses_top_level_text_first(monkeypatch) -> None:
    server = _load_server_with_fastapi_stub(monkeypatch)

    text = server._text_from_liteparse_payload(
        {
            "text": "Top level text",
            "pages": [{"text": "Page text"}],
        }
    )

    assert text == "Top level text"


def test_liteparse_payload_text_aggregates_page_text_when_top_level_missing(monkeypatch) -> None:
    server = _load_server_with_fastapi_stub(monkeypatch)

    text = server._text_from_liteparse_payload(
        {
            "pages": [
                {"page": 1, "text": ""},
                {"page": 2, "text": "Inference engineering"},
                {"page": 3, "text": "evaluates model systems"},
                {"page": 4, "textItems": [{"text": "ignored"}]},
            ],
        }
    )

    assert text == "Inference engineering\n\nevaluates model systems"


def test_liteparse_payload_text_removes_layout_dot_leaders(monkeypatch) -> None:
    server = _load_server_with_fastapi_stub(monkeypatch)

    text = server._text_from_liteparse_payload(
        {
            "pages": [
                {
                    "page": 1,
                    "text": "Table of Contents\nPreface............................................................... 9",
                },
                {"page": 2, "text": "Chapter 0: Inference................................................ 15"},
            ],
        }
    )

    assert "................................" not in text
    assert text == "Table of Contents\nPreface  9\n\nChapter 0: Inference  15"
