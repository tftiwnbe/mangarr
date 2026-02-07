import asyncio
import json
import time
from collections.abc import Callable
from contextlib import AbstractAsyncContextManager
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from typing import Any
from app.models import PersistentCacheEntry

from sqlmodel import delete
from sqlmodel.ext.asyncio.session import AsyncSession


def _expiry_from_ttl(ttl: float | int | None) -> float | None:
    if ttl is None:
        return None
    ttl_value = float(ttl)
    if ttl_value <= 0:
        return 0.0
    return time.monotonic() + ttl_value


def _utc_expiry_from_ttl(ttl: float | int | None) -> datetime | None:
    if ttl is None:
        return None
    ttl_value = float(ttl)
    if ttl_value <= 0:
        return datetime.fromtimestamp(0, tz=UTC)
    return datetime.now(tz=UTC) + timedelta(seconds=ttl_value)


def _ensure_utc(dt: datetime | None) -> datetime | None:
    if dt is None:
        return None
    if dt.tzinfo is None:
        return dt.replace(tzinfo=UTC)
    return dt.astimezone(UTC)


@dataclass(slots=True)
class _CachedValue:
    payload: Any
    expires_at: float | None

    def is_expired(self) -> bool:
        if self.expires_at is None:
            return False
        if self.expires_at == 0:
            return True
        return time.monotonic() >= self.expires_at


class InMemoryTTLCache:
    """Minimal async-safe in-memory cache supporting per-key TTL values."""

    def __init__(self) -> None:
        self._store: dict[str, _CachedValue] = {}
        self._lock = asyncio.Lock()

    async def get(self, key: str) -> Any | None:
        async with self._lock:
            entry = self._store.get(key)
            if entry is None:
                return None
            if entry.is_expired():
                self._store.pop(key, None)
                return None
            return entry.payload

    async def set(self, key: str, data: Any, ttl: float | int | None = None) -> None:
        expires_at = _expiry_from_ttl(ttl)
        async with self._lock:
            self._store[key] = _CachedValue(payload=data, expires_at=expires_at)

    async def delete(self, key: str) -> None:
        async with self._lock:
            self._store.pop(key, None)

    async def clear(self) -> None:
        async with self._lock:
            self._store.clear()


class PersistentCache:
    """SQLite-backed cache that stores JSON payloads with TTL support."""

    def __init__(
        self, session_factory: Callable[[], AbstractAsyncContextManager[AsyncSession]]
    ) -> None:
        self._sessions = session_factory

    async def get(self, key: str) -> Any | None:
        async with self._sessions() as session:
            entry = await session.get(PersistentCacheEntry, key)
            if entry is None:
                return None
            now = datetime.now(tz=UTC)
            expires_at = _ensure_utc(entry.expires_at)
            if expires_at and expires_at <= now:
                await session.delete(entry)
                await session.commit()
                return None
            return json.loads(entry.data)

    async def set(self, key: str, data: Any, ttl: float | int | None = None) -> None:
        encoded = json.dumps(data)
        expires_at = _utc_expiry_from_ttl(ttl)

        async with self._sessions() as session:
            entry = await session.get(PersistentCacheEntry, key)
            if entry is None:
                entry = PersistentCacheEntry(
                    key=key,
                    data=encoded,
                    expires_at=expires_at,
                )
                session.add(entry)
            else:
                entry.data = encoded
                entry.expires_at = expires_at
            await session.commit()

    async def delete(self, key: str) -> None:
        async with self._sessions() as session:
            entry = await session.get(PersistentCacheEntry, key)
            if entry is None:
                return
            await session.delete(entry)
            await session.commit()

    async def purge_expired(self) -> None:
        async with self._sessions() as session:
            now = datetime.now(tz=UTC)
            statement = delete(PersistentCacheEntry).where(
                PersistentCacheEntry.expires_at.isnot(None),  # type: ignore[arg-type]
                PersistentCacheEntry.expires_at <= now,  # type: ignore[arg-type]
            )
            await session.exec(statement)
            await session.commit()
