#!/usr/bin/env python3
from __future__ import annotations

import json
from pathlib import Path
from typing import Any

ROOT_DIR = Path(__file__).resolve().parents[1]
DEFAULT_SPEC_PATH = ROOT_DIR / "data" / "interview_prep_card_quality_spec.json"


def load_quality_spec(path: Path = DEFAULT_SPEC_PATH) -> dict[str, Any]:
    try:
        payload = json.loads(path.read_text(encoding="utf-8"))
    except json.JSONDecodeError as exc:
        raise ValueError(f"Invalid interview prep quality spec JSON in {path}: {exc}") from exc
    if not isinstance(payload, dict):
        raise ValueError("Interview prep quality spec must be a JSON object")
    validate_quality_spec(payload)
    return payload


def validate_quality_spec(payload: dict[str, Any]) -> None:
    required_fields = (
        "spec_id",
        "spec_version",
        "target_roles",
        "source_policy",
        "progression_gating",
        "question_styles",
    )
    for field in required_fields:
        if field not in payload:
            raise ValueError(f"Interview prep quality spec missing required field: {field}")
    valid_roles = isinstance(payload["target_roles"], list) and all(
        isinstance(role, str) and role.strip() for role in payload["target_roles"]
    )
    if not valid_roles:
        raise ValueError("Interview prep quality spec target_roles must be non-empty strings")
    source_policy = payload["source_policy"]
    if not isinstance(source_policy, dict):
        raise ValueError("Interview prep quality spec source_policy must be an object")
    if source_policy.get("allow_solution_text_import") is not False:
        raise ValueError("Interview prep quality spec must disallow solution text import")
    if source_policy.get("allow_unproven_pdf_ocr_cards") is not False:
        raise ValueError("Interview prep quality spec must disallow unproven PDF OCR cards")

    progression_gating = payload["progression_gating"]
    if not isinstance(progression_gating, dict):
        raise ValueError("Interview prep quality spec progression_gating must be an object")
    if progression_gating.get("requires_topic_read") is not True:
        raise ValueError("Interview prep quality spec must require topic-read gating")

    styles = payload["question_styles"]
    if not isinstance(styles, list) or not styles:
        raise ValueError("Interview prep quality spec question_styles must be a non-empty list")
    seen_ids: set[str] = set()
    for index, style in enumerate(styles, start=1):
        if not isinstance(style, dict):
            raise ValueError(f"Question style {index} must be an object")
        for field in (
            "id",
            "label",
            "card_type",
            "tag",
            "progression_stage",
            "review_focus",
            "prompt_template",
            "answer_guidance",
        ):
            if field not in style:
                raise ValueError(f"Question style {index} missing required field: {field}")
        style_id = _required_str(style, "id", index)
        if style_id in seen_ids:
            raise ValueError(f"Duplicate question style id: {style_id}")
        seen_ids.add(style_id)
        _required_str(style, "label", index)
        _required_str(style, "card_type", index)
        _required_str(style, "tag", index)
        _required_str(style, "prompt_template", index)
        _required_str(style, "answer_guidance", index)
        if not isinstance(style["progression_stage"], int) or style["progression_stage"] < 1:
            raise ValueError(
                f"Question style {style_id} progression_stage must be a positive integer"
            )
        if not isinstance(style["review_focus"], list) or not all(
            isinstance(value, str) and value.strip() for value in style["review_focus"]
        ):
            raise ValueError(f"Question style {style_id} review_focus must be non-empty strings")

    stage_order = progression_gating.get("stage_order")
    expected_stage_order = [
        str(style["id"]) for style in sorted(styles, key=lambda item: int(item["progression_stage"]))
    ]
    if stage_order != expected_stage_order:
        raise ValueError(
            "Interview prep quality spec stage_order must match question_styles progression order"
        )


def _required_str(style: dict[str, Any], field: str, index: int) -> str:
    value = style.get(field)
    if not isinstance(value, str) or not value.strip():
        raise ValueError(f"Question style {index} field {field} must be a non-empty string")
    return value.strip()


def question_styles(spec: dict[str, Any] | None = None) -> tuple[dict[str, Any], ...]:
    active_spec = spec or load_quality_spec()
    return tuple(
        sorted(active_spec["question_styles"], key=lambda style: int(style["progression_stage"]))
    )


def question_style_ids(spec: dict[str, Any] | None = None) -> list[str]:
    return [str(style["id"]) for style in question_styles(spec)]


def quality_spec_summary(spec: dict[str, Any] | None = None) -> dict[str, Any]:
    active_spec = spec or load_quality_spec()
    return {
        "spec_id": active_spec["spec_id"],
        "spec_version": active_spec["spec_version"],
        "target_roles": active_spec["target_roles"],
        "source_policy": active_spec["source_policy"],
        "progression_gating": active_spec["progression_gating"],
        "question_style_ids": question_style_ids(active_spec),
    }


def style_metadata(style: dict[str, Any]) -> dict[str, Any]:
    return {
        "question_style_id": style["id"],
        "question_style_label": style["label"],
        "progression_stage": style["progression_stage"],
        "review_focus": style["review_focus"],
    }
