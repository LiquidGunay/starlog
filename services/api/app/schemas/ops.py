from datetime import datetime

from pydantic import BaseModel


class MetricsResponse(BaseModel):
    queue_depth_sync_events: int
    cards_due: int
    tasks_todo: int
    alarms_scheduled: int
    timestamp: datetime


class BackupResponse(BaseModel):
    backup_path: str
    exported_at: datetime
    bytes_written: int
