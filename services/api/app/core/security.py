import base64
import hashlib
import json
import secrets
from dataclasses import dataclass
from typing import Any

from app.core.config import get_settings


SCRYPT_N = 2**14
SCRYPT_R = 8
SCRYPT_P = 1
SCRYPT_DKLEN = 32
SECRETS_PREFIX = "enc:v1:"
REDACTED_VALUE = "__redacted__"
_INSECURE_FALLBACK_KEY = "starlog-dev-secrets-fallback"


@dataclass(frozen=True)
class SessionToken:
    plain: str
    hashed: str


def _b64(raw: bytes) -> str:
    return base64.urlsafe_b64encode(raw).decode("utf-8")


def _unb64(value: str) -> bytes:
    return base64.urlsafe_b64decode(value.encode("utf-8"))


def hash_passphrase(passphrase: str) -> str:
    salt = secrets.token_bytes(16)
    dk = hashlib.scrypt(
        passphrase.encode("utf-8"),
        salt=salt,
        n=SCRYPT_N,
        r=SCRYPT_R,
        p=SCRYPT_P,
        dklen=SCRYPT_DKLEN,
    )
    return f"scrypt${SCRYPT_N}${SCRYPT_R}${SCRYPT_P}${_b64(salt)}${_b64(dk)}"


def verify_passphrase(passphrase: str, encoded: str) -> bool:
    try:
        _, n, r, p, salt_b64, dk_b64 = encoded.split("$", maxsplit=5)
    except ValueError:
        return False

    candidate = hashlib.scrypt(
        passphrase.encode("utf-8"),
        salt=_unb64(salt_b64),
        n=int(n),
        r=int(r),
        p=int(p),
        dklen=SCRYPT_DKLEN,
    )
    return secrets.compare_digest(candidate, _unb64(dk_b64))


def hash_token(token: str) -> str:
    return hashlib.sha256(token.encode("utf-8")).hexdigest()


def create_session_token() -> SessionToken:
    plain = secrets.token_urlsafe(32)
    return SessionToken(plain=plain, hashed=hash_token(plain))


def _secret_material() -> tuple[str, bool]:
    configured = get_settings().secrets_master_key.strip()
    if configured:
        return configured, True
    return _INSECURE_FALLBACK_KEY, False


def secrets_encryption_mode() -> str:
    _, configured = _secret_material()
    return "configured" if configured else "fallback_insecure"


def _fernet_key() -> bytes:
    material, _ = _secret_material()
    digest = hashlib.sha256(material.encode("utf-8")).digest()
    return base64.urlsafe_b64encode(digest)


def _encrypt_scalar(value: Any) -> Any:
    from cryptography.fernet import Fernet

    if isinstance(value, str) and value.startswith(SECRETS_PREFIX):
        return value
    payload = json.dumps({"value": value}, sort_keys=True).encode("utf-8")
    token = Fernet(_fernet_key()).encrypt(payload).decode("utf-8")
    return f"{SECRETS_PREFIX}{token}"


def _decrypt_scalar(value: Any) -> Any:
    from cryptography.fernet import Fernet, InvalidToken

    if not isinstance(value, str) or not value.startswith(SECRETS_PREFIX):
        return value
    token = value[len(SECRETS_PREFIX) :]
    try:
        raw = Fernet(_fernet_key()).decrypt(token.encode("utf-8"))
    except InvalidToken:
        return value
    try:
        parsed = json.loads(raw.decode("utf-8"))
    except json.JSONDecodeError:
        return value
    if isinstance(parsed, dict) and "value" in parsed:
        return parsed["value"]
    return value


def _is_sensitive_key(key: str | None) -> bool:
    if not key:
        return False
    lowered = key.lower()
    exact_matches = {
        "api_key",
        "token",
        "access_token",
        "refresh_token",
        "secret",
        "client_secret",
        "password",
    }
    if lowered in exact_matches:
        return True
    return lowered.endswith(("_api_key", "_token", "_secret", "_password"))


def _transform_sensitive(value: Any, mode: str) -> Any:
    if mode == "encrypt":
        if value is None or (isinstance(value, str) and value == ""):
            return value
        return _encrypt_scalar(value)
    if mode == "decrypt":
        return _decrypt_scalar(value)
    if mode == "redact":
        if value is None or (isinstance(value, str) and value == ""):
            return value
        return REDACTED_VALUE
    raise ValueError(f"Unsupported transform mode: {mode}")


def _walk_config(value: Any, mode: str, key: str | None = None) -> Any:
    if _is_sensitive_key(key):
        return _transform_sensitive(value, mode)

    if isinstance(value, dict):
        return {str(item_key): _walk_config(item_value, mode, str(item_key)) for item_key, item_value in value.items()}
    if isinstance(value, list):
        return [_walk_config(item, mode, None) for item in value]
    return value


def encrypt_sensitive_config(config: dict) -> dict:
    return _walk_config(config, mode="encrypt")


def decrypt_sensitive_config(config: dict) -> dict:
    return _walk_config(config, mode="decrypt")


def redact_sensitive_config(config: dict) -> dict:
    return _walk_config(config, mode="redact")
