from functools import lru_cache

from pydantic import Field
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_prefix="STARLOG_", extra="ignore")

    env: str = "dev"
    db_path: str = ".localdata/starlog.db"
    auth_session_hours: int = 24 * 14
    sync_pull_limit: int = Field(default=100, ge=1, le=500)
    cors_allow_origins: str = "*"
    google_client_id: str = ""
    google_client_secret: str = ""
    google_redirect_uri: str = "http://localhost:8000/v1/calendar/sync/google/oauth/callback"
    google_calendar_id: str = "primary"
    google_oauth_scopes: str = "https://www.googleapis.com/auth/calendar"
    secrets_master_key: str = ""


@lru_cache(maxsize=1)
def get_settings() -> Settings:
    return Settings()
