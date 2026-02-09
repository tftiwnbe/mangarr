import base64
import hashlib
import hmac
import re
import secrets

from fastapi import HTTPException, status

_USERNAME_PATTERN = re.compile(r"^[a-zA-Z0-9_.-]{3,50}$")
_PASSWORD_MIN_LENGTH = 10
_SCRYPT_N = 1 << 14
_SCRYPT_R = 8
_SCRYPT_P = 1
_SCRYPT_KEY_LEN = 64
_SCRYPT_SALT_LEN = 16


def validate_username(username: str) -> str:
    normalized = username.strip().lower()
    if not _USERNAME_PATTERN.fullmatch(normalized):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Username must be 3-50 chars: letters, numbers, ., _, -",
        )
    return normalized


def validate_password_strength(password: str) -> None:
    if len(password) < _PASSWORD_MIN_LENGTH:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Password must be at least {_PASSWORD_MIN_LENGTH} characters",
        )
    checks = [
        any(ch.islower() for ch in password),
        any(ch.isupper() for ch in password),
        any(ch.isdigit() for ch in password),
    ]
    if not all(checks):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Password must include upper, lower, and numeric characters",
        )


def generate_api_key() -> str:
    return secrets.token_urlsafe(32)


def hash_api_key(api_key: str) -> str:
    return hashlib.sha256(api_key.encode("utf-8")).hexdigest()


def verify_api_key(api_key: str, api_key_hash: str) -> bool:
    candidate = hash_api_key(api_key)
    return hmac.compare_digest(candidate, api_key_hash)


def hash_password(password: str) -> str:
    salt = secrets.token_bytes(_SCRYPT_SALT_LEN)
    digest = hashlib.scrypt(
        password.encode("utf-8"),
        salt=salt,
        n=_SCRYPT_N,
        r=_SCRYPT_R,
        p=_SCRYPT_P,
        dklen=_SCRYPT_KEY_LEN,
    )
    salt_b64 = base64.b64encode(salt).decode("ascii")
    digest_b64 = base64.b64encode(digest).decode("ascii")
    return f"scrypt${_SCRYPT_N}${_SCRYPT_R}${_SCRYPT_P}${salt_b64}${digest_b64}"


def verify_password(password: str, password_hash: str) -> bool:
    try:
        algorithm, n_raw, r_raw, p_raw, salt_b64, digest_b64 = password_hash.split("$")
        if algorithm != "scrypt":
            return False
        n = int(n_raw)
        r = int(r_raw)
        p = int(p_raw)
        salt = base64.b64decode(salt_b64.encode("ascii"))
        expected_digest = base64.b64decode(digest_b64.encode("ascii"))
    except (ValueError, TypeError):
        return False

    digest = hashlib.scrypt(
        password.encode("utf-8"),
        salt=salt,
        n=n,
        r=r,
        p=p,
        dklen=len(expected_digest),
    )
    return hmac.compare_digest(digest, expected_digest)
