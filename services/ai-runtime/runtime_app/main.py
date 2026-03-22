from fastapi import FastAPI

from runtime_app.schemas import WorkflowPreviewRequest, WorkflowPreviewResponse
from runtime_app.workflows import briefing_preview, chat_preview, research_digest_preview

app = FastAPI(title="Starlog AI Runtime", version="0.1.0")


@app.get("/health")
def health() -> dict[str, str]:
    return {"status": "ok"}


@app.post("/v1/chat/preview", response_model=WorkflowPreviewResponse)
def preview_chat(payload: WorkflowPreviewRequest) -> WorkflowPreviewResponse:
    return chat_preview(payload.title, payload.text, payload.context)


@app.post("/v1/briefings/preview", response_model=WorkflowPreviewResponse)
def preview_briefing(payload: WorkflowPreviewRequest) -> WorkflowPreviewResponse:
    return briefing_preview(payload.title, payload.text, payload.context)


@app.post("/v1/research/digests/preview", response_model=WorkflowPreviewResponse)
def preview_research_digest(payload: WorkflowPreviewRequest) -> WorkflowPreviewResponse:
    return research_digest_preview(payload.title, payload.text, payload.context)
