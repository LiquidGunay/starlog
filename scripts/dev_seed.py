"""Seed Starlog with basic demo data for local development."""

from app.db.storage import get_connection, init_storage
from app.services import artifacts_service, auth_service

PASS = "correct horse battery staple"


def main() -> None:
    init_storage()
    with get_connection() as conn:
        auth_service.bootstrap_user(conn, PASS)
        artifacts_service.create_artifact(
            conn,
            source_type="seed",
            title="Welcome to Starlog",
            raw_content="Capture ideas, make cards, and schedule focused blocks.",
            normalized_content="Capture ideas, make cards, and schedule focused blocks.",
            extracted_content="",
            metadata={"seed": True},
        )
    print("Seed complete. Login with passphrase:", PASS)


if __name__ == "__main__":
    main()
