"""
Shared utilities used across multiple feature services.
"""
import asyncio
import re

from sqlalchemy.exc import OperationalError, PendingRollbackError
from sqlmodel.ext.asyncio.session import AsyncSession

# Matches non-word characters and underscores (same pattern used in library + downloads)
_NORMALIZE_RE = re.compile(r"[\W_]+", re.UNICODE)

_SQLITE_LOCK_RETRY_ATTEMPTS = 5
_SQLITE_LOCK_INITIAL_DELAY_SECONDS = 0.25


def normalize_text(value: str | None) -> str:
    """Lowercase, strip punctuation/underscores, and collapse whitespace."""
    if not value:
        return ""
    lowered = value.strip().lower()
    return _NORMALIZE_RE.sub(" ", lowered).strip()


def normalize_positive_int_ids(values: list[object]) -> list[int]:
    """Parse, deduplicate, and validate positive integer IDs from a mixed-type list."""
    parsed: list[int] = []
    seen: set[int] = set()
    for raw in values:
        try:
            value = int(raw)
        except (TypeError, ValueError):
            continue
        if value <= 0 or value in seen:
            continue
        seen.add(value)
        parsed.append(value)
    return parsed


def _is_sqlite_locked(exc: Exception) -> bool:
    msg = str(exc).lower()
    return "database is locked" in msg or "sqlite_busy" in msg


async def commit_with_sqlite_retry(session: AsyncSession) -> None:
    """Commit the session with exponential backoff on SQLite lock contention."""
    delay = _SQLITE_LOCK_INITIAL_DELAY_SECONDS
    for attempt in range(_SQLITE_LOCK_RETRY_ATTEMPTS + 1):
        try:
            await session.commit()
            return
        except OperationalError as exc:
            if not _is_sqlite_locked(exc):
                raise
            await session.rollback()
            if attempt >= _SQLITE_LOCK_RETRY_ATTEMPTS:
                raise
            await asyncio.sleep(delay)
            delay *= 2
        except PendingRollbackError as exc:
            if not _is_sqlite_locked(exc):
                raise
            await session.rollback()
            if attempt >= _SQLITE_LOCK_RETRY_ATTEMPTS:
                raise
            await asyncio.sleep(delay)
            delay *= 2
