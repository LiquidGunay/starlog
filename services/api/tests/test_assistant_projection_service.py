from app.services import assistant_projection_service


def test_normalize_runtime_parts_preserves_tool_result_dynamic_ui_fields() -> None:
    parts = assistant_projection_service.normalize_runtime_parts(
        [
            {
                "type": "tool_result",
                "id": "tool_result_1",
                "tool_result": {
                    "id": "tool_result_payload",
                    "tool_call_id": "tool_call_payload",
                    "status": "complete",
                    "output": {"value": 42},
                    "renderer_key": "interview.question_request",
                    "renderer_version": 1,
                    "placement": "thread",
                    "structured_content": {"topic_id": "topic-1"},
                    "ui_meta": {"tone": "compact"},
                },
            }
        ]
    )

    assert len(parts) == 1
    tool_result = parts[0]["tool_result"]
    assert tool_result["renderer_key"] == "interview.question_request"
    assert tool_result["renderer_version"] == 1
    assert tool_result["placement"] == "thread"
    assert tool_result["structured_content"] == {"topic_id": "topic-1"}
    assert tool_result["ui_meta"] == {"tone": "compact"}
    assert tool_result["tool_call_id"] == "tool_call_payload"


def test_tool_result_part_supports_explicit_dynamic_ui_fields() -> None:
    part = assistant_projection_service.tool_result_part(
        tool_call_id="tool_call_dynamic",
        status="complete",
        output={"value": "ok"},
        metadata={"projection": "dynamic_ui_projection"},
        renderer_key="interview.review_grade",
        renderer_version=2,
        placement="sidecar",
        structured_content={"grade": "easy"},
        ui_meta={"tone": "affirming"},
    )

    tool_result = part["tool_result"]
    assert tool_result["renderer_key"] == "interview.review_grade"
    assert tool_result["renderer_version"] == 2
    assert tool_result["placement"] == "sidecar"
    assert tool_result["structured_content"] == {"grade": "easy"}
    assert tool_result["ui_meta"] == {"tone": "affirming"}
    assert tool_result["metadata"]["projection"] == "dynamic_ui_projection"
