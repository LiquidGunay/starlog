from __future__ import annotations

import importlib.util
import sys
import types
from pathlib import Path


REPO_ROOT = Path(__file__).resolve().parents[3]


def _load_module(module_name: str, script_path: Path) -> types.ModuleType:
    spec = importlib.util.spec_from_file_location(module_name, script_path)
    if spec is None or spec.loader is None:
        raise AssertionError(f"Unable to load module from {script_path}")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def test_paddleocr_page_values_accepts_numpy_backed_arrays(monkeypatch) -> None:
    fake_paddle = types.ModuleType("paddle")
    fake_paddle.device = types.SimpleNamespace(get_device=lambda: "cpu")
    fake_paddleocr = types.ModuleType("paddleocr")
    fake_numpy = types.ModuleType("numpy")
    fake_numpy.array = lambda value: value
    fake_pil = types.ModuleType("PIL")
    fake_pil.Image = types.SimpleNamespace(open=lambda *_args, **_kwargs: None)

    class FakePaddleOCR:
        def __init__(self, **_: object) -> None:
            pass

    fake_paddleocr.PaddleOCR = FakePaddleOCR

    monkeypatch.setitem(sys.modules, "numpy", fake_numpy)
    monkeypatch.setitem(sys.modules, "paddle", fake_paddle)
    monkeypatch.setitem(sys.modules, "paddleocr", fake_paddleocr)
    monkeypatch.setitem(sys.modules, "PIL", fake_pil)

    module = _load_module("test_paddleocr_gpu_server", REPO_ROOT / "scripts/paddleocr_gpu_server.py")

    class FakeArray:
        def __init__(self, values: list[object]) -> None:
            self._values = values

        def __iter__(self):
            return iter(self._values)

        def __bool__(self) -> bool:
            raise ValueError("truth value of an array is ambiguous")

    class FakePoint:
        def __init__(self, x: float, y: float) -> None:
            self._coords = (x, y)

        def __iter__(self):
            return iter(self._coords)

    class FakePolygon:
        def __init__(self, points: list[FakePoint]) -> None:
            self._points = points

        def __iter__(self):
            return iter(self._points)

    page = {
        "dt_polys": FakeArray([FakePolygon([FakePoint(1, 2), FakePoint(5, 2), FakePoint(5, 7), FakePoint(1, 7)])]),
        "rec_scores": FakeArray([0.97]),
    }

    polygons = module._page_values(page, "dt_polys")
    scores = module._page_values(page, "rec_scores")

    assert len(polygons) == 1
    assert module._bbox_from_polygon(polygons[0]) == [1, 2, 5, 7]
    assert len(scores) == 1
    assert float(scores[0]) == 0.97


def test_liteparse_env_int_ignores_invalid_values(monkeypatch) -> None:
    monkeypatch.setenv("STARLOG_LITEPARSE_PORT", "")
    monkeypatch.setenv("STARLOG_LITEPARSE_MAX_PAGES", "oops")
    monkeypatch.setenv("STARLOG_LITEPARSE_DPI", "75")
    monkeypatch.setenv("STARLOG_LITEPARSE_TIMEOUT_SECONDS", "-2")

    module = _load_module("test_liteparse_parse_server", REPO_ROOT / "scripts/liteparse_parse_server.py")

    assert module.DEFAULT_PORT == 8830
    assert module.DEFAULT_MAX_PAGES == 16
    assert module.DEFAULT_DPI == 110
    assert module.DEFAULT_TIMEOUT_SECONDS == 10
