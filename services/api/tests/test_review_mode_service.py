from app.services import review_mode_service
from app.services.conversation_card_service import _review_queue_card


def test_review_mode_for_card_type_maps_stable_ladder_buckets() -> None:
    assert review_mode_service.review_mode_for_card_type("qa") == "recall"
    assert review_mode_service.review_mode_for_card_type("scenario") == "application"
    assert review_mode_service.review_mode_for_card_type("connect") == "synthesis"
    assert review_mode_service.review_mode_for_card_type("unknown_custom_type") == "recall"


def test_review_queue_card_projects_mode_counts_primary_mode_and_body() -> None:
    card = _review_queue_card(
        [
            {"id": "crd_recall", "prompt": "Recall the definition.", "answer": "Definition.", "card_type": "qa"},
            {"id": "crd_application", "prompt": "Apply the pattern.", "answer": "Use the pattern.", "card_type": "scenario"},
            {"id": "crd_synthesis", "prompt": "Connect the ideas.", "answer": "Shared principle.", "card_type": "connect"},
            {"id": "crd_unknown", "prompt": "Unknown card type.", "answer": "Defaults.", "card_type": "custom"},
        ],
        title="Review queue",
    )

    assert card["metadata"]["mode_counts"] == {
        "recall": 2,
        "application": 1,
        "synthesis": 1,
    }
    assert card["metadata"]["primary_mode"] == "recall"
    assert card["metadata"]["review_mode"] == "recall"
    assert card["metadata"]["card_type"] == "qa"
    assert card["body"].startswith("Recall due: 2 · Application drills: 1 · Synthesis prompts: 1")
    assert "Recall the definition." in card["body"]
