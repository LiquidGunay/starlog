#!/usr/bin/env python3
from __future__ import annotations

import argparse
import json
import os
import sys
from datetime import datetime, timezone
from pathlib import Path
from urllib.request import Request, urlopen


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Run a local PDF -> artifact -> summary/cards/note smoke flow.")
    parser.add_argument(
        "--pdf-url",
        default="https://diffusion.csail.mit.edu/2026/docs/lecture_notes.pdf",
        help="PDF URL to ingest",
    )
    parser.add_argument("--title", default="MIT Diffusion Lecture Notes", help="Artifact title override")
    parser.add_argument(
        "--output-dir",
        default="artifacts/pdf-ocr-smoke",
        help="Directory where smoke evidence should be written",
    )
    parser.add_argument("--notes", default="", help="Optional notes override for manual PDF ingest")
    parser.add_argument("--ocr-server-url", default="", help="Optional OCR server URL for PDF extraction")
    parser.add_argument("--ocr-language", default="en", help="Optional OCR language code")
    return parser.parse_args()


def download_pdf(url: str) -> bytes:
    request = Request(url, headers={"User-Agent": "Starlog/0.1 PDF smoke"})
    with urlopen(request, timeout=30) as response:
        return response.read()


def main() -> int:
    args = parse_args()
    repo_root = Path(__file__).resolve().parents[1]
    output_root = (repo_root / args.output_dir).resolve()
    started_at = datetime.now(timezone.utc)
    run_id = started_at.strftime("%Y%m%dT%H%M%SZ")
    run_dir = output_root / run_id
    run_dir.mkdir(parents=True, exist_ok=True)

    os.environ["STARLOG_DB_PATH"] = str(run_dir / "smoke.db")
    os.environ["STARLOG_MEDIA_DIR"] = str(run_dir / "media")
    if args.ocr_server_url.strip():
        os.environ["STARLOG_PDF_OCR_SERVER_URL"] = args.ocr_server_url.strip()
        os.environ["STARLOG_PDF_OCR_LANGUAGE"] = args.ocr_language.strip() or "en"

    sys.path.insert(0, str(repo_root / "services/api"))

    from app.core.config import get_settings

    get_settings.cache_clear()

    from app.main import app
    from fastapi.testclient import TestClient

    pdf_bytes = download_pdf(args.pdf_url)
    pdf_path = run_dir / "input.pdf"
    pdf_path.write_bytes(pdf_bytes)

    with TestClient(app) as client:
        bootstrap = client.post("/v1/auth/bootstrap", json={"passphrase": "correct horse battery staple"})
        if bootstrap.status_code not in {201, 409}:
            raise RuntimeError(f"bootstrap failed: {bootstrap.status_code} {bootstrap.text}")

        login = client.post("/v1/auth/login", json={"passphrase": "correct horse battery staple"})
        login.raise_for_status()
        token = login.json()["access_token"]
        headers = {"Authorization": f"Bearer {token}"}

        upload = client.post(
            "/v1/media/upload",
            headers=headers,
            files={"file": ("lecture_notes.pdf", pdf_bytes, "application/pdf")},
        )
        upload.raise_for_status()
        media = upload.json()

        ingest = client.post(
            "/v1/research/manual-pdf",
            headers=headers,
            json={
                "media_id": media["id"],
                "title": args.title,
                **({"notes": args.notes} if args.notes.strip() else {}),
            },
        )
        ingest.raise_for_status()
        research_item = ingest.json()
        artifact_id = research_item["content_artifact_id"]
        if not artifact_id:
            raise RuntimeError("manual PDF ingest did not create an artifact")

        action_results: dict[str, dict] = {}
        for action in ("summarize", "cards", "append_note"):
            response = client.post(f"/v1/artifacts/{artifact_id}/actions", headers=headers, json={"action": action})
            response.raise_for_status()
            action_results[action] = response.json()

        graph = client.get(f"/v1/artifacts/{artifact_id}/graph", headers=headers)
        graph.raise_for_status()
        graph_payload = graph.json()

        versions = client.get(f"/v1/artifacts/{artifact_id}/versions", headers=headers)
        versions.raise_for_status()
        versions_payload = versions.json()

    summary_text = graph_payload["summaries"][0]["content"] if graph_payload["summaries"] else ""
    cards = graph_payload["cards"][:3]
    notes = graph_payload["notes"][:1]
    report = {
        "run_id": run_id,
        "pdf_url": args.pdf_url,
        "pdf_path": str(pdf_path),
        "research_item_id": research_item["id"],
        "artifact_id": artifact_id,
        "manual_pdf_metadata": research_item["metadata"],
        "notes_seed": args.notes,
        "artifact": {
            "title": graph_payload["artifact"]["title"],
            "normalized_excerpt": (graph_payload["artifact"].get("normalized_content") or "")[:600],
            "extracted_excerpt": (graph_payload["artifact"].get("extracted_content") or "")[:600],
        },
        "actions": action_results,
        "summary": summary_text,
        "cards": cards,
        "quiz_preview": [{"question": card["prompt"], "answer": card["answer"]} for card in cards],
        "note_preview": notes,
        "version_counts": {
            "summaries": len(versions_payload["summaries"]),
            "card_sets": len(versions_payload["card_sets"]),
            "actions": len(versions_payload["actions"]),
        },
    }

    report_path = run_dir / "report.json"
    report_path.write_text(json.dumps(report, indent=2) + "\n", encoding="utf-8")

    markdown_path = run_dir / "report.md"
    markdown_path.write_text(
        "\n".join(
            [
                f"# PDF OCR Smoke {run_id}",
                "",
                f"- PDF URL: {args.pdf_url}",
                f"- Artifact ID: `{artifact_id}`",
                f"- Extraction provider: `{research_item['metadata'].get('pdf_extraction', {}).get('provider', 'unknown')}`",
                f"- Extraction mode: `{research_item['metadata'].get('pdf_extraction', {}).get('mode', 'unknown')}`",
                f"- Extraction usable: `{research_item['metadata'].get('pdf_extraction', {}).get('usable', False)}`",
                f"- Extraction rejected_as_noise: `{research_item['metadata'].get('pdf_extraction', {}).get('rejected_as_noise', False)}`",
                f"- Notes seed: `{args.notes or '(none)'}`",
                f"- OCR server: `{args.ocr_server_url or '(disabled)'}`",
                f"- Summary count: `{len(versions_payload['summaries'])}`",
                f"- Card count: `{len(graph_payload['cards'])}`",
                f"- Note count: `{len(graph_payload['notes'])}`",
                "",
                "## Summary",
                "",
                summary_text or "_No summary generated_",
                "",
                "## Quiz Preview",
                "",
                *[
                    f"{index}. Q: {card['prompt']}\n   A: {card['answer']}"
                    for index, card in enumerate(cards, start=1)
                ],
            ]
        )
        + "\n",
        encoding="utf-8",
    )

    print(json.dumps({"run_dir": str(run_dir), "report_path": str(report_path), "markdown_path": str(markdown_path)}))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
