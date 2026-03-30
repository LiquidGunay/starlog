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


def _bbox_from_polygon(value: Any) -> list[int]:
    if not isinstance(value, (list, tuple)) or not value:
        return [0, 0, 0, 0]
    xs: list[float] = []
    ys: list[float] = []
    for point in value:
        if not isinstance(point, (list, tuple)) or len(point) < 2:
            continue
        try:
            xs.append(float(point[0]))
            ys.append(float(point[1]))
        except (TypeError, ValueError):
            continue
    if not xs or not ys:
        return [0, 0, 0, 0]
    return [int(min(xs)), int(min(ys)), int(max(xs)), int(max(ys))]


def _page_values(page: Any, key: str) -> list[Any]:
    if isinstance(page, dict):
        value = page.get(key)
    else:
        value = getattr(page, key, None)
    return list(value or [])


@app.get("/healthz")
def healthz() -> dict[str, Any]:
    return {"ok": True, "use_gpu": USE_GPU, "device": paddle.device.get_device(), "configured_device": PADDLE_DEVICE}


@app.post("/ocr")
async def ocr(file: UploadFile = File(...), language: str = Form("en")) -> dict[str, Any]:
    image = Image.open(io.BytesIO(await file.read())).convert("RGB")
    result = _get_ocr(language).predict(np.array(image))
    results = []
    for page in result:
        texts = _page_values(page, "rec_texts")
        scores = _page_values(page, "rec_scores")
        polygons = _page_values(page, "dt_polys")
        for index, item in enumerate(texts):
            bbox = _bbox_from_polygon(polygons[index]) if index < len(polygons) else [0, 0, 0, 0]
            confidence_raw = scores[index] if index < len(scores) else 1.0
            try:
                confidence = float(confidence_raw)
            except (TypeError, ValueError):
                confidence = 1.0
            results.append({"text": str(item), "bbox": bbox, "confidence": max(0.0, min(confidence, 1.0))})
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
