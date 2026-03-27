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
