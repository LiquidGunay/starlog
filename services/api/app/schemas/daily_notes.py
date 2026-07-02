from datetime import date, datetime

from pydantic import BaseModel


class DailyNoteUpsertRequest(BaseModel):
    morning_plan_md: str = ""
    evening_reflection_md: str = ""


class DailyNoteResponse(BaseModel):
    id: str
    date: date
    note_id: str
    morning_plan_md: str
    evening_reflection_md: str
    version: int
    created_at: datetime
    updated_at: datetime
