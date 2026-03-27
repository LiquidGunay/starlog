#!/usr/bin/env python3
from __future__ import annotations

import io
import os
from typing import Any

import numpy as np
import paddle
from fastapi import FastAPI, File, Form, UploadFile
from PIL import Image
from paddleocr import PaddleOCR

DEFAULT_PORT = int(os.getenv("STARLOG_PADDLEOCR_PORT", "8829"))
USE_GPU = os.getenv("STARLOG_PADDLEOCR_USE_GPU", "1").strip().lower() not in {"0", "false", "no"}
PADDLE_DEVICE = os.getenv("STARLOG_PADDLEOCR_DEVICE", "gpu:0" if USE_GPU else "cpu").strip() or ("gpu:0" if USE_GPU else "cpu")
LANGUAGE_ALIASES = {
    "en": "en",
    "zh": "ch",
    "zh-cn": "ch",
    "zh-tw": "chinese_cht",
    "zh-hant": "chinese_cht",
    "ja": "japan",
    "ko": "korean",
}

app = FastAPI(title="Starlog PaddleOCR GPU Server")
_ocr_cache: dict[str, PaddleOCR] = {}


def _lang_code(value: str) -> str:
    normalized = value.strip().lower()
    return LANGUAGE_ALIASES.get(normalized, normalized or "en")


def _get_ocr(language: str) -> PaddleOCR:
    lang = _lang_code(language)
    if lang not in _ocr_cache:
        _ocr_cache[lang] = PaddleOCR(
            use_doc_orientation_classify=False,
            use_doc_unwarping=False,
            use_textline_orientation=False,
            lang=lang,
            device=PADDLE_DEVICE,
        )
    return _ocr_cache[lang]


@app.get("/healthz")
def healthz() -> dict[str, Any]:
    return {"ok": True, "use_gpu": USE_GPU, "device": paddle.device.get_device(), "configured_device": PADDLE_DEVICE}


@app.post("/ocr")
async def ocr(file: UploadFile = File(...), language: str = Form("en")) -> dict[str, Any]:
    image = Image.open(io.BytesIO(await file.read())).convert("RGB")
    result = _get_ocr(language).predict(np.array(image))
    results = []
    for page in result:
        if isinstance(page, dict):
            texts = page.get("rec_texts", []) or []
        else:
            texts = getattr(page, "rec_texts", []) or []
        for item in texts:
            results.append({"text": str(item), "bbox": [0, 0, 0, 0], "confidence": 1.0})
    return {
        "results": results,
        "language": language,
        "use_gpu": USE_GPU,
        "device": paddle.device.get_device(),
        "configured_device": PADDLE_DEVICE,
    }


if __name__ == "__main__":
    import uvicorn

    uvicorn.run(app, host="127.0.0.1", port=DEFAULT_PORT)
