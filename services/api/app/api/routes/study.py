from sqlite3 import Connection
from typing import Callable, TypeVar

from fastapi import APIRouter, Depends, HTTPException, Query, status

from app.api.deps import get_db, require_user_id
from app.schemas.study import (
    CardTopicLinkCreateRequest,
    CardTopicLinkResponse,
    PracticeAttemptCreateRequest,
    PracticeAttemptResponse,
    PracticeItemCreateRequest,
    PracticeItemResponse,
    SourceChunkCreateRequest,
    SourceChunkResponse,
    StudyQuestionRequestCreateRequest,
    StudyQuestionRequestResponse,
    StudySourceCreateRequest,
    StudySourceResponse,
    StudyTopicCreateRequest,
    StudyTopicResponse,
)
from app.services import assistant_event_service, study_service


T = TypeVar("T")

router = APIRouter(prefix="/study")


def _run_or_http(operation: Callable[[], T]) -> T:
    try:
        return operation()
    except LookupError as error:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(error)) from error
    except ValueError as error:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail=str(error)) from error


def _create_surface_event(
    db: Connection,
    *,
    user_id: str,
    source_surface: str,
    kind: str,
    entity_ref: dict,
    payload: dict,
) -> None:
    try:
        assistant_event_service.create_surface_event(
            db,
            thread_id="primary",
            source_surface=source_surface,
            kind=kind,
            entity_ref=entity_ref,
            payload=payload,
            visibility="ambient",
            user_id=user_id,
        )
    except Exception:
        # Study persistence is primary. Assistant projection can be retried later.
        pass


@router.get("/sources", response_model=list[StudySourceResponse])
def list_study_sources(
    limit: int = Query(default=100, ge=1, le=500),
    _user_id: str = Depends(require_user_id),
    db: Connection = Depends(get_db),
) -> list[StudySourceResponse]:
    sources = study_service.list_sources(db, limit=limit)
    return [StudySourceResponse.model_validate(source) for source in sources]


@router.post("/sources", response_model=StudySourceResponse, status_code=status.HTTP_201_CREATED)
def create_study_source(
    payload: StudySourceCreateRequest,
    _user_id: str = Depends(require_user_id),
    db: Connection = Depends(get_db),
) -> StudySourceResponse:
    source = study_service.create_source(
        db,
        title=payload.title,
        source_type=payload.source_type,
        artifact_id=payload.artifact_id,
        url=payload.url,
        metadata=payload.metadata,
    )
    return StudySourceResponse.model_validate(source)


@router.get("/topics", response_model=list[StudyTopicResponse])
def list_study_topics(
    source_id: str | None = Query(default=None),
    limit: int = Query(default=200, ge=1, le=500),
    _user_id: str = Depends(require_user_id),
    db: Connection = Depends(get_db),
) -> list[StudyTopicResponse]:
    topics = study_service.list_topics(db, source_id=source_id, limit=limit)
    return [StudyTopicResponse.model_validate(topic) for topic in topics]


@router.post("/topics", response_model=StudyTopicResponse, status_code=status.HTTP_201_CREATED)
def create_study_topic(
    payload: StudyTopicCreateRequest,
    _user_id: str = Depends(require_user_id),
    db: Connection = Depends(get_db),
) -> StudyTopicResponse:
    topic = _run_or_http(
        lambda: study_service.create_topic(
            db,
            source_id=payload.source_id,
            parent_topic_id=payload.parent_topic_id,
            title=payload.title,
            summary=payload.summary,
            display_order=payload.display_order,
        )
    )
    return StudyTopicResponse.model_validate(topic)


@router.post("/topics/{topic_id}/unlock", response_model=StudyTopicResponse)
def unlock_study_topic(
    topic_id: str,
    _user_id: str = Depends(require_user_id),
    db: Connection = Depends(get_db),
) -> StudyTopicResponse:
    topic = _run_or_http(lambda: study_service.unlock_topic(db, topic_id))
    return StudyTopicResponse.model_validate(topic)


@router.post("/topics/{topic_id}/read", response_model=StudyTopicResponse)
def mark_study_topic_read(
    topic_id: str,
    user_id: str = Depends(require_user_id),
    db: Connection = Depends(get_db),
) -> StudyTopicResponse:
    topic = _run_or_http(lambda: study_service.mark_topic_read(db, topic_id))
    _create_surface_event(
        db,
        user_id=user_id,
        source_surface="review",
        kind="study.topic.read",
        entity_ref={
            "entity_type": "study_topic",
            "entity_id": topic_id,
            "href": f"/review?topic={topic_id}",
            "title": topic["title"],
        },
        payload={
            "topic_id": topic_id,
            "source_id": topic["source_id"],
            "label": f"Topic read: {topic['title']}",
            "body": "Linked review cards are now eligible when due.",
        },
    )
    return StudyTopicResponse.model_validate(topic)


@router.post("/source-chunks", response_model=SourceChunkResponse, status_code=status.HTTP_201_CREATED)
def create_source_chunk(
    payload: SourceChunkCreateRequest,
    _user_id: str = Depends(require_user_id),
    db: Connection = Depends(get_db),
) -> SourceChunkResponse:
    chunk = _run_or_http(
        lambda: study_service.create_source_chunk(
            db,
            source_id=payload.source_id,
            topic_id=payload.topic_id,
            artifact_id=payload.artifact_id,
            chunk_index=payload.chunk_index,
            content=payload.content,
            metadata=payload.metadata,
        )
    )
    return SourceChunkResponse.model_validate(chunk)


@router.post("/card-topic-links", response_model=CardTopicLinkResponse, status_code=status.HTTP_201_CREATED)
def create_card_topic_link(
    payload: CardTopicLinkCreateRequest,
    _user_id: str = Depends(require_user_id),
    db: Connection = Depends(get_db),
) -> CardTopicLinkResponse:
    link = _run_or_http(
        lambda: study_service.link_card_to_topic(
            db,
            card_id=payload.card_id,
            topic_id=payload.topic_id,
            gate_required=payload.gate_required,
        )
    )
    return CardTopicLinkResponse.model_validate(link)


@router.post("/practice-items", response_model=PracticeItemResponse, status_code=status.HTTP_201_CREATED)
def create_practice_item(
    payload: PracticeItemCreateRequest,
    _user_id: str = Depends(require_user_id),
    db: Connection = Depends(get_db),
) -> PracticeItemResponse:
    item = _run_or_http(
        lambda: study_service.create_practice_item(
            db,
            source_id=payload.source_id,
            topic_id=payload.topic_id,
            item_type=payload.item_type,
            prompt=payload.prompt,
            answer=payload.answer,
            metadata=payload.metadata,
        )
    )
    return PracticeItemResponse.model_validate(item)


@router.post("/practice-attempts", response_model=PracticeAttemptResponse, status_code=status.HTTP_201_CREATED)
def create_practice_attempt(
    payload: PracticeAttemptCreateRequest,
    _user_id: str = Depends(require_user_id),
    db: Connection = Depends(get_db),
) -> PracticeAttemptResponse:
    attempt = _run_or_http(
        lambda: study_service.create_practice_attempt(
            db,
            practice_item_id=payload.practice_item_id,
            topic_id=payload.topic_id,
            rating=payload.rating,
            response_text=payload.response_text,
            correct=payload.correct,
            latency_ms=payload.latency_ms,
            metadata=payload.metadata,
        )
    )
    return PracticeAttemptResponse.model_validate(attempt)


@router.post("/question-requests", response_model=StudyQuestionRequestResponse, status_code=status.HTTP_201_CREATED)
def create_study_question_request(
    payload: StudyQuestionRequestCreateRequest,
    user_id: str = Depends(require_user_id),
    db: Connection = Depends(get_db),
) -> StudyQuestionRequestResponse:
    request = _run_or_http(
        lambda: study_service.create_question_request(
            db,
            source_id=payload.source_id,
            topic_id=payload.topic_id,
            question=payload.question,
            status=payload.status,
            response=payload.response,
        )
    )
    _create_surface_event(
        db,
        user_id=user_id,
        source_surface="assistant",
        kind="study.question.requested",
        entity_ref={
            "entity_type": "study_question_request",
            "entity_id": request["id"],
            "href": f"/review?question={request['id']}",
            "title": request["question"],
        },
        payload={
            "request_id": request["id"],
            "topic_id": request.get("topic_id"),
            "source_id": request.get("source_id"),
            "label": "Study question requested",
            "body": request["question"],
        },
    )
    return StudyQuestionRequestResponse.model_validate(request)
