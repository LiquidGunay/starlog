#!/usr/bin/env python3
from __future__ import annotations

import json
import os

from fastapi import FastAPI, File, Form, UploadFile


app = FastAPI(title="Starlog Mock STT Server", version="0.1.0")


@app.get("/health")
def health() -> dict[str, str]:
    return {"status": "ok", "service": "mock_stt_server"}


@app.post("/inference")
async def inference(
    file: UploadFile = File(...),
    text_hint: str = Form(default=""),
) -> dict[str, str]:
    await file.read()
    transcript = text_hint.strip() or os.getenv("STARLOG_MOCK_STT_TRANSCRIPT", "Mock transcript from local STT server.")
    return {
        "text": transcript,
        "service": "mock_stt_server",
    }


if __name__ == "__main__":
    import uvicorn

    host = os.getenv("STARLOG_MOCK_STT_HOST", "127.0.0.1")
    port = int(os.getenv("STARLOG_MOCK_STT_PORT", "8171"))
    uvicorn.run(app, host=host, port=port)
