from datetime import datetime, timedelta, timezone

from app.db.storage import get_connection, init_storage
from app.services import briefing_service


def run_once() -> None:
    init_storage()
    tomorrow = (datetime.now(timezone.utc) + timedelta(days=1)).date().isoformat()
    with get_connection() as conn:
        briefing = briefing_service.generate_briefing(conn, tomorrow, provider="worker-template")
    print(f"[worker] generated briefing {briefing['id']} for {tomorrow}")


if __name__ == "__main__":
    run_once()
