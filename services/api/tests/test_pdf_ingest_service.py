import sys
import types
from pathlib import Path

from app.services import pdf_ingest_service


def test_extract_pdf_text_prefers_optional_ocr_server(monkeypatch, tmp_path: Path) -> None:
    pdf_path = tmp_path / "sample.pdf"
    pdf_path.write_bytes(b"%PDF-1.4 sample")
    ocr_text = (
        "Lecture one covers diffusion models, denoising trajectories, score matching, and stochastic sampling. "
        "The notes compare flow matching with diffusion objectives, explain guidance, and summarize training tradeoffs. "
    )

    monkeypatch.setenv("STARLOG_PDF_OCR_SERVER_URL", "http://127.0.0.1:8829/ocr")
    monkeypatch.setattr(pdf_ingest_service, "_extract_with_ocr_server", lambda _path: ocr_text)
    monkeypatch.setattr(pdf_ingest_service, "_extract_with_pypdf", lambda _path: "pypdf text that should not win")
    monkeypatch.setattr(pdf_ingest_service, "_extract_with_strings", lambda _path: "strings text that should not win")

    result = pdf_ingest_service.extract_pdf_text(pdf_path)
    assert result["provider"] == "ocr_server"
    assert result["mode"] == "ocr_server"
    assert result["usable"] is True


def test_extract_pdf_text_prefers_liteparse_server_when_configured(monkeypatch, tmp_path: Path) -> None:
    pdf_path = tmp_path / "sample.pdf"
    pdf_path.write_bytes(b"%PDF-1.4 sample")
    liteparse_text = (
        "LiteParse extracted lecture notes covering diffusion objectives, flow matching, guidance, "
        "and sampling tradeoffs across the full document. "
    )

    monkeypatch.setenv("STARLOG_PDF_PARSE_SERVER_URL", "http://127.0.0.1:8830/parse")
    monkeypatch.setattr(pdf_ingest_service, "_extract_with_parse_server", lambda _path: liteparse_text)
    monkeypatch.setattr(pdf_ingest_service, "_extract_with_ocr_server", lambda _path: "ocr text that should not win")
    monkeypatch.setattr(pdf_ingest_service, "_extract_with_pypdf", lambda _path: "pypdf text that should not win")
    monkeypatch.setattr(pdf_ingest_service, "_extract_with_strings", lambda _path: None)

    result = pdf_ingest_service.extract_pdf_text(pdf_path)
    assert result["provider"] == "liteparse_server"
    assert result["mode"] == "liteparse"
    assert result["usable"] is True


def test_extract_pdf_text_falls_back_when_ocr_server_yields_nothing(monkeypatch, tmp_path: Path) -> None:
    pdf_path = tmp_path / "sample.pdf"
    pdf_path.write_bytes(b"%PDF-1.4 sample")
    pdf_text = (
        "Fallback PDF text explains forward noising, reverse denoising, score estimation, and sampling procedures. "
        "It also covers latent-space models, schedulers, and practical evaluation concerns for generative systems. "
    )

    monkeypatch.setenv("STARLOG_PDF_OCR_SERVER_URL", "http://127.0.0.1:8829/ocr")
    monkeypatch.setattr(pdf_ingest_service, "_extract_with_ocr_server", lambda _path: None)
    monkeypatch.setattr(pdf_ingest_service, "_extract_with_pypdf", lambda _path: pdf_text)
    monkeypatch.setattr(pdf_ingest_service, "_extract_with_strings", lambda _path: None)

    result = pdf_ingest_service.extract_pdf_text(pdf_path)
    assert result["provider"] == "pypdf"
    assert result["mode"] == "text_layer"
    assert result["usable"] is True


def test_extract_pdf_text_prefers_readable_pypdf_over_word_salad_ocr(monkeypatch, tmp_path: Path) -> None:
    pdf_path = tmp_path / "sample.pdf"
    pdf_path.write_bytes(b"%PDF-1.4 sample")
    word_salad_ocr = (
        "abjurex cylophane dkwartz femgrin hijolux knavory puzzlent quixor "
        "rhombex sylvatic tremblaq vortexium "
        "abjurex cylophane dkwartz femgrin hijolux knavory puzzlent quixor "
        "rhombex sylvatic tremblaq vortexium "
        "abjurex cylophane dkwartz femgrin hijolux knavory puzzlent quixor "
        "rhombex sylvatic tremblaq vortexium "
        "abjurex cylophane dkwartz femgrin hijolux knavory puzzlent quixor "
        "rhombex sylvatic tremblaq vortexium "
    )
    readable_pypdf = (
        "Fallback PDF text explains forward noising, reverse denoising, score estimation, and sampling procedures. "
        "It also covers latent-space models, schedulers, and practical evaluation concerns for generative systems."
    )

    monkeypatch.setenv("STARLOG_PDF_OCR_SERVER_URL", "http://127.0.0.1:8829/ocr")
    monkeypatch.setattr(pdf_ingest_service, "_extract_with_ocr_server", lambda _path: word_salad_ocr)
    monkeypatch.setattr(pdf_ingest_service, "_extract_with_pypdf", lambda _path: readable_pypdf)
    monkeypatch.setattr(pdf_ingest_service, "_extract_with_strings", lambda _path: None)

    assert pdf_ingest_service._quality_flags(word_salad_ocr)["usable"] is True
    result = pdf_ingest_service.extract_pdf_text(pdf_path)
    assert result["provider"] == "pypdf"
    assert result["mode"] == "text_layer"
    assert result["usable"] is True
    assert result["text"] == readable_pypdf
    assert result["characters"] == len(readable_pypdf)


def test_extract_pdf_text_prefers_better_strings_fallback_over_stubby_pypdf(monkeypatch, tmp_path: Path) -> None:
    pdf_path = tmp_path / "sample.pdf"
    pdf_path.write_bytes(b"%PDF-1.4 sample")
    stubby_pypdf = "Appendix A"
    better_strings = (
        "Fallback strings text explains forward noising, reverse denoising, score estimation, and sampling procedures. "
        "It also covers latent-space models, schedulers, and practical evaluation concerns for generative systems."
    )

    monkeypatch.setenv("STARLOG_PDF_OCR_SERVER_URL", "http://127.0.0.1:8829/ocr")
    monkeypatch.setattr(pdf_ingest_service, "_extract_with_ocr_server", lambda _path: None)
    monkeypatch.setattr(pdf_ingest_service, "_extract_with_pypdf", lambda _path: stubby_pypdf)
    monkeypatch.setattr(pdf_ingest_service, "_extract_with_strings", lambda _path: better_strings)

    result = pdf_ingest_service.extract_pdf_text(pdf_path)
    assert result["provider"] == "strings"
    assert result["mode"] == "heuristic_fallback"
    assert result["text"] == better_strings
    assert result["usable"] is True


def test_extract_pdf_text_prefers_short_readable_ocr_over_gibberish_pypdf(monkeypatch, tmp_path: Path) -> None:
    pdf_path = tmp_path / "sample.pdf"
    pdf_path.write_bytes(b"%PDF-1.4 sample")
    readable_ocr = "Diffusion models use score matching and denoising."
    gibberish_pypdf = (
        "abjurex cylophane dkwartz femgrin hijolux knavory puzzlent quixor "
        "rhombex sylvatic tremblaq vortexium "
        "abjurex cylophane dkwartz femgrin hijolux knavory puzzlent quixor "
        "rhombex sylvatic tremblaq vortexium "
    )

    monkeypatch.setenv("STARLOG_PDF_OCR_SERVER_URL", "http://127.0.0.1:8829/ocr")
    monkeypatch.setattr(pdf_ingest_service, "_extract_with_ocr_server", lambda _path: readable_ocr)
    monkeypatch.setattr(pdf_ingest_service, "_extract_with_pypdf", lambda _path: gibberish_pypdf)
    monkeypatch.setattr(pdf_ingest_service, "_extract_with_strings", lambda _path: None)

    result = pdf_ingest_service.extract_pdf_text(pdf_path)
    assert result["provider"] == "ocr_server"
    assert result["mode"] == "ocr_server"
    assert result["readable"] is True
    assert result["usable"] is False
    assert result["text"] == readable_ocr


def test_extract_pdf_text_accepts_long_readable_ocr_text_with_low_unique_ratio(monkeypatch, tmp_path: Path) -> None:
    pdf_path = tmp_path / "sample.pdf"
    pdf_path.write_bytes(b"%PDF-1.4 sample")

    readable_page = (
        "MIT Class 6.S184: Generative AI With Stochastic Differential Equations. "
        "Introduction to flow matching and diffusion models with sampling, score matching, and guidance. "
    )
    long_readable_text = readable_page * 180

    monkeypatch.setenv("STARLOG_PDF_OCR_SERVER_URL", "http://127.0.0.1:8829/ocr")
    monkeypatch.setattr(pdf_ingest_service, "_extract_with_ocr_server", lambda _path: long_readable_text)
    monkeypatch.setattr(pdf_ingest_service, "_extract_with_pypdf", lambda _path: None)
    monkeypatch.setattr(pdf_ingest_service, "_extract_with_strings", lambda _path: None)

    result = pdf_ingest_service.extract_pdf_text(pdf_path)
    assert result["provider"] == "ocr_server"
    assert result["usable"] is True
    assert result["unique_ratio"] < 0.08


def test_extract_pdf_text_skips_provider_exception_and_uses_fallback(monkeypatch, tmp_path: Path) -> None:
    pdf_path = tmp_path / "sample.pdf"
    pdf_path.write_bytes(b"%PDF-1.4 sample")
    fallback_text = (
        "Fallback PDF text explains forward noising, reverse denoising, score estimation, and sampling procedures. "
        "It also covers latent-space models, schedulers, and practical evaluation concerns for generative systems. "
    )

    def raise_ocr_unavailable(_path: Path) -> str | None:
        raise RuntimeError("ocr unavailable")

    monkeypatch.setenv("STARLOG_PDF_OCR_SERVER_URL", "http://127.0.0.1:8829/ocr")
    monkeypatch.setattr(pdf_ingest_service, "_extract_with_ocr_server", raise_ocr_unavailable)
    monkeypatch.setattr(pdf_ingest_service, "_extract_with_pypdf", lambda _path: fallback_text)
    monkeypatch.setattr(pdf_ingest_service, "_extract_with_strings", lambda _path: None)

    result = pdf_ingest_service.extract_pdf_text(pdf_path)
    assert result["provider"] == "pypdf"
    assert result["mode"] == "text_layer"
    assert result["usable"] is True


def test_extract_with_ocr_server_ignores_invalid_env_and_returns_none(monkeypatch, tmp_path: Path) -> None:
    pdf_path = tmp_path / "sample.pdf"
    pdf_path.write_bytes(b"%PDF-1.4 sample")

    fake_fitz = types.ModuleType("fitz")

    def _unexpected_open(_path: str) -> None:
        raise AssertionError("fitz.open should not be called when OCR env parsing fails")

    fake_fitz.open = _unexpected_open  # type: ignore[attr-defined]

    monkeypatch.setenv("STARLOG_PDF_OCR_SERVER_URL", "http://127.0.0.1:8829/ocr")
    monkeypatch.setenv("STARLOG_PDF_OCR_DPI", "not-an-integer")
    monkeypatch.setattr(pdf_ingest_service.importlib.util, "find_spec", lambda name: object() if name == "fitz" else None)
    monkeypatch.setitem(sys.modules, "fitz", fake_fitz)

    assert pdf_ingest_service._extract_with_ocr_server(pdf_path) is None


def test_extract_with_parse_server_posts_pdf_and_returns_text(monkeypatch, tmp_path: Path) -> None:
    pdf_path = tmp_path / "sample.pdf"
    pdf_path.write_bytes(b"%PDF-1.4 parse sample")
    captured: dict[str, object] = {}

    class DummyResponse:
        def __enter__(self) -> "DummyResponse":
            return self

        def __exit__(self, exc_type, exc, tb) -> bool:
            return False

        def read(self) -> bytes:
            return b'{"text":"LiteParse parse server text"}'

    def fake_urlopen(request, timeout: int):  # type: ignore[no-untyped-def]
        captured["url"] = request.full_url
        captured["timeout"] = timeout
        captured["content_type"] = request.headers["Content-type"]
        captured["body"] = request.data
        return DummyResponse()

    monkeypatch.setenv("STARLOG_PDF_PARSE_SERVER_URL", "http://127.0.0.1:8830/parse")
    monkeypatch.setenv("STARLOG_PDF_OCR_LANGUAGE", "en")
    monkeypatch.setenv("STARLOG_PDF_PARSE_MAX_PAGES", "6")
    monkeypatch.setenv("STARLOG_PDF_PARSE_DPI", "180")
    monkeypatch.setenv("STARLOG_PDF_PARSE_OCR_SERVER_URL", "http://127.0.0.1:8829/ocr")
    monkeypatch.setattr(pdf_ingest_service, "urlopen", fake_urlopen)

    text = pdf_ingest_service._extract_with_parse_server(pdf_path)
    body = captured["body"]
    assert isinstance(body, (bytes, bytearray))
    assert text == "LiteParse parse server text"
    assert captured["url"] == "http://127.0.0.1:8830/parse"
    assert captured["timeout"] == 90
    assert b'name="max_pages"\r\n\r\n6' in body
    assert b'name="dpi"\r\n\r\n180' in body
    assert b'name="ocr_server_url"\r\n\r\nhttp://127.0.0.1:8829/ocr' in body
