from datetime import timedelta
from sqlite3 import Connection

from app.core.config import get_settings
from app.core.security import create_session_token, hash_passphrase, verify_passphrase
from app.core.time import utc_now
from app.services import events_service
from app.services.common import execute_fetchone, iso, new_id


def bootstrap_user(conn: Connection, passphrase: str) -> bool:
    existing = execute_fetchone(conn, "SELECT id FROM users LIMIT 1")
    if existing is not None:
        return False

    now = utc_now()
    user_id = new_id("usr")
    conn.execute(
        "INSERT INTO users (id, passphrase_hash, created_at) VALUES (?, ?, ?)",
        (user_id, hash_passphrase(passphrase), now.isoformat()),
    )
    events_service.emit(conn, "user.bootstrapped", {"user_id": user_id})
    conn.commit()
    return True


def login(conn: Connection, passphrase: str) -> tuple[str, str] | None:
    user = execute_fetchone(conn, "SELECT id, passphrase_hash FROM users LIMIT 1")
    if user is None:
        return None

    if not verify_passphrase(passphrase, str(user["passphrase_hash"])):
        return None

    now = utc_now()
    expires_at = now + timedelta(hours=get_settings().auth_session_hours)
    token = create_session_token()

    conn.execute(
        "INSERT INTO sessions (id, user_id, token_hash, expires_at, created_at) VALUES (?, ?, ?, ?, ?)",
        (new_id("ses"), user["id"], token.hashed, expires_at.isoformat(), now.isoformat()),
    )
    events_service.emit(conn, "auth.login", {"user_id": user["id"]})
    conn.commit()
    return token.plain, expires_at.isoformat()


def get_user_id_from_token_hash(conn: Connection, token_hash: str) -> str | None:
    now = iso(utc_now())
    row = execute_fetchone(
        conn,
        "SELECT user_id FROM sessions WHERE token_hash = ? AND expires_at > ? LIMIT 1",
        (token_hash, now),
    )
    if row is None:
        return None
    return str(row["user_id"])


def logout(conn: Connection, token_hash: str) -> None:
    events_service.emit(conn, "auth.logout", {"token_hash_prefix": token_hash[:10]})
    conn.execute("DELETE FROM sessions WHERE token_hash = ?", (token_hash,))
    conn.commit()
