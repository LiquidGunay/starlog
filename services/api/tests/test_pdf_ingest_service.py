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


def test_extract_pdf_text_prefers_later_readable_fallback_over_noisy_ocr(monkeypatch, tmp_path: Path) -> None:
    pdf_path = tmp_path / "sample.pdf"
    pdf_path.write_bytes(b"%PDF-1.4 sample")
    noisy_ocr = "SbbbQQQMMMaaaZZZLLLPP MTdcrLsZ|kzb{fJWnZw~ ?JP```@@p``\\\\llNvvuEEG{"
    readable_fallback = "Fallback PDF text explains diffusion scoring and sampling."

    monkeypatch.setenv("STARLOG_PDF_OCR_SERVER_URL", "http://127.0.0.1:8829/ocr")
    monkeypatch.setattr(pdf_ingest_service, "_extract_with_ocr_server", lambda _path: noisy_ocr)
    monkeypatch.setattr(pdf_ingest_service, "_extract_with_pypdf", lambda _path: readable_fallback)
    monkeypatch.setattr(pdf_ingest_service, "_extract_with_strings", lambda _path: None)

    result = pdf_ingest_service.extract_pdf_text(pdf_path)
    assert result["provider"] == "pypdf"
    assert result["mode"] == "text_layer"
    assert result["usable"] is False
    assert result["text"] == readable_fallback
    assert result["characters"] == len(readable_fallback)


def test_extract_pdf_text_prefers_text_layer_over_high_alpha_junk_ocr(monkeypatch, tmp_path: Path) -> None:
    pdf_path = tmp_path / "sample.pdf"
    pdf_path.write_bytes(b"%PDF-1.4 sample")
    junk_ocr = ("ALPHA ALPHA ALPHA ALPHA ALPHA ALPHA ALPHA ALPHA ALPHA ALPHA " * 4).strip()
    readable_fallback = "Fallback PDF text explains diffusion scoring and sampling."

    monkeypatch.setenv("STARLOG_PDF_OCR_SERVER_URL", "http://127.0.0.1:8829/ocr")
    monkeypatch.setattr(pdf_ingest_service, "_extract_with_ocr_server", lambda _path: junk_ocr)
    monkeypatch.setattr(pdf_ingest_service, "_extract_with_pypdf", lambda _path: readable_fallback)
    monkeypatch.setattr(pdf_ingest_service, "_extract_with_strings", lambda _path: None)

    result = pdf_ingest_service.extract_pdf_text(pdf_path)
    assert result["provider"] == "pypdf"
    assert result["mode"] == "text_layer"
    assert result["text"] == readable_fallback
    assert result["usable"] is False


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
