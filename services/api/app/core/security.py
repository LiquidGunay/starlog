import base64
import hashlib
import secrets
from dataclasses import dataclass


SCRYPT_N = 2**14
SCRYPT_R = 8
SCRYPT_P = 1
SCRYPT_DKLEN = 32


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
