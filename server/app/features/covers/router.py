import asyncio
import hashlib
import ipaddress
import json
import socket
from collections import OrderedDict
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from pathlib import Path
from urllib.parse import urlparse

import httpx
from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.responses import FileResponse
from sqlmodel.ext.asyncio.session import AsyncSession

from app.config import settings
from app.core.database import get_database_session
from app.core.deps import require_authenticated_user
from app.features.covers.local_store import resolve_library_cover_path
from app.models import LibraryTitle

router = APIRouter(prefix="/api/v2/covers", tags=["covers"])

_CACHE_TTL_SECONDS = 24 * 60 * 60
_CLIENT_TIMEOUT = httpx.Timeout(20.0)
_MAX_IMAGE_BYTES = 12 * 1024 * 1024
_CACHE_CONTROL = f"public, max-age={_CACHE_TTL_SECONDS}, stale-while-revalidate=86400"
_ALLOWED_SCHEMES = {"http", "https"}
_MAX_REDIRECTS = 5


def _now_utc() -> datetime:
    return datetime.now(timezone.utc)


def _parse_utc(value: str | None) -> datetime | None:
    if not value:
        return None
    candidate = value.strip()
    if not candidate:
        return None
    if candidate.endswith("Z"):
        candidate = f"{candidate[:-1]}+00:00"
    try:
        parsed = datetime.fromisoformat(candidate)
    except ValueError:
        return None
    if parsed.tzinfo is None:
        return parsed.replace(tzinfo=timezone.utc)
    return parsed.astimezone(timezone.utc)


@dataclass(slots=True)
class CoverCacheMeta:
    url: str
    content_type: str
    etag: str | None
    last_modified: str | None
    expires_at: datetime

    @classmethod
    def from_dict(cls, payload: dict) -> "CoverCacheMeta | None":
        expires_at = _parse_utc(str(payload.get("expires_at") or ""))
        url = str(payload.get("url") or "").strip()
        content_type = str(payload.get("content_type") or "").strip()
        if expires_at is None or not url or not content_type:
            return None
        return cls(
            url=url,
            content_type=content_type,
            etag=(str(payload.get("etag")) if payload.get("etag") else None),
            last_modified=(
                str(payload.get("last_modified"))
                if payload.get("last_modified")
                else None
            ),
            expires_at=expires_at,
        )

    def to_dict(self) -> dict:
        return {
            "url": self.url,
            "content_type": self.content_type,
            "etag": self.etag,
            "last_modified": self.last_modified,
            "expires_at": self.expires_at.isoformat(),
        }

    def is_fresh(self) -> bool:
        return self.expires_at > _now_utc()


_LOCK_POOL_MAX = 512  # evict oldest when pool grows beyond this


class CoverCacheService:
    _locks_guard = asyncio.Lock()
    _locks: OrderedDict[str, asyncio.Lock] = OrderedDict()

    def __init__(self) -> None:
        self.root = settings.app.config_dir / "cache" / "covers"
        self._client: httpx.AsyncClient | None = None
        self._client_lock = asyncio.Lock()

    async def close(self) -> None:
        async with self._client_lock:
            if self._client is None:
                return
            await self._client.aclose()
            self._client = None

    async def _get_client(self) -> httpx.AsyncClient:
        async with self._client_lock:
            if self._client is None:
                self._client = httpx.AsyncClient(
                    timeout=_CLIENT_TIMEOUT,
                    follow_redirects=True,
                )
            return self._client

    @classmethod
    async def _lock_for(cls, key: str) -> asyncio.Lock:
        async with cls._locks_guard:
            lock = cls._locks.get(key)
            if lock is None:
                lock = asyncio.Lock()
                # Evict oldest unlocked entry when pool is full
                if len(cls._locks) >= _LOCK_POOL_MAX:
                    for oldest_key, oldest_lock in cls._locks.items():
                        if not oldest_lock.locked():
                            del cls._locks[oldest_key]
                            break
                cls._locks[key] = lock
            else:
                # Move to end (most recently used)
                cls._locks.move_to_end(key)
            return lock

    @staticmethod
    async def _validate_remote_url(raw: str) -> str:
        candidate = raw.strip()
        if not candidate:
            raise HTTPException(status_code=400, detail="Cover URL is empty")

        parsed = urlparse(candidate)
        if parsed.scheme.lower() not in _ALLOWED_SCHEMES:
            raise HTTPException(status_code=400, detail="Unsupported cover URL scheme")
        if parsed.username or parsed.password:
            raise HTTPException(status_code=400, detail="Invalid cover URL credentials")
        if not parsed.hostname:
            raise HTTPException(status_code=400, detail="Invalid cover URL host")

        host = parsed.hostname.strip().lower()
        if host in {"localhost", "127.0.0.1", "::1"} or host.endswith(".local"):
            raise HTTPException(status_code=400, detail="Invalid cover URL host")

        port = parsed.port or (443 if parsed.scheme.lower() == "https" else 80)
        try:
            infos = await asyncio.to_thread(
                socket.getaddrinfo,
                host,
                port,
                socket.AF_UNSPEC,
                socket.SOCK_STREAM,
            )
        except OSError as exc:
            raise HTTPException(status_code=400, detail="Unable to resolve cover URL host") from exc

        for info in infos:
            try:
                ip = ipaddress.ip_address(info[4][0])
            except ValueError:
                continue
            if (
                ip.is_private
                or ip.is_loopback
                or ip.is_link_local
                or ip.is_reserved
                or ip.is_multicast
            ):
                raise HTTPException(status_code=400, detail="Cover URL host is not allowed")

        return parsed.geturl()

    async def _read_meta(self, meta_path: Path) -> CoverCacheMeta | None:
        if not meta_path.is_file():
            return None

        def _read_json(path: Path) -> dict | None:
            try:
                return json.loads(path.read_text(encoding="utf-8"))
            except (OSError, json.JSONDecodeError):
                return None

        payload = await asyncio.to_thread(_read_json, meta_path)
        if payload is None:
            return None
        return CoverCacheMeta.from_dict(payload)

    async def _write_meta(self, meta_path: Path, meta: CoverCacheMeta) -> None:
        data = json.dumps(meta.to_dict(), ensure_ascii=True)

        def _write(path: Path, text: str) -> None:
            tmp_path = path.with_suffix(".tmp")
            tmp_path.write_text(text, encoding="utf-8")
            tmp_path.replace(path)

        await asyncio.to_thread(_write, meta_path, data)

    async def _write_bytes(self, file_path: Path, content: bytes) -> None:
        def _write(path: Path, data: bytes) -> None:
            tmp_path = path.with_suffix(".tmp")
            tmp_path.write_bytes(data)
            tmp_path.replace(path)

        await asyncio.to_thread(_write, file_path, content)

    async def _refresh_cache(
        self,
        url: str,
        file_path: Path,
        meta_path: Path,
        current_meta: CoverCacheMeta | None,
    ) -> CoverCacheMeta:
        headers: dict[str, str] = {}
        if current_meta and current_meta.etag:
            headers["If-None-Match"] = current_meta.etag
        if current_meta and current_meta.last_modified:
            headers["If-Modified-Since"] = current_meta.last_modified

        response = await self._safe_get(url, headers=headers)

        if response.status_code == 304 and current_meta and file_path.is_file():
            refreshed = CoverCacheMeta(
                url=current_meta.url,
                content_type=current_meta.content_type,
                etag=current_meta.etag,
                last_modified=current_meta.last_modified,
                expires_at=_now_utc() + timedelta(seconds=_CACHE_TTL_SECONDS),
            )
            await self._write_meta(meta_path, refreshed)
            return refreshed

        if response.status_code >= 400:
            raise HTTPException(status_code=502, detail="Unable to fetch cover image")

        final_url = await self._validate_remote_url(str(response.url))
        content_type = response.headers.get("content-type", "").split(";", 1)[0].strip().lower()
        if not content_type.startswith("image/"):
            raise HTTPException(status_code=502, detail="Cover response is not an image")

        content = response.content
        if not content:
            raise HTTPException(status_code=502, detail="Cover image is empty")
        if len(content) > _MAX_IMAGE_BYTES:
            raise HTTPException(status_code=413, detail="Cover image is too large")

        await self._write_bytes(file_path, content)

        meta = CoverCacheMeta(
            url=final_url,
            content_type=content_type,
            etag=response.headers.get("etag"),
            last_modified=response.headers.get("last-modified"),
            expires_at=_now_utc() + timedelta(seconds=_CACHE_TTL_SECONDS),
        )
        await self._write_meta(meta_path, meta)
        return meta

    async def _safe_get(
        self,
        url: str,
        headers: dict[str, str] | None = None,
    ) -> httpx.Response:
        client = await self._get_client()
        current_url = await self._validate_remote_url(url)
        request_headers = dict(headers or {})

        for _ in range(_MAX_REDIRECTS + 1):
            response = await client.get(
                current_url,
                headers=request_headers,
                follow_redirects=False,
            )
            if response.status_code not in {301, 302, 303, 307, 308}:
                return response

            location = response.headers.get("location")
            if not location:
                raise HTTPException(status_code=502, detail="Cover redirect is invalid")

            redirect_url = str(response.url.join(location))
            current_url = await self._validate_remote_url(redirect_url)
            if response.status_code == 303:
                request_headers.pop("If-None-Match", None)
                request_headers.pop("If-Modified-Since", None)

        raise HTTPException(status_code=502, detail="Cover redirect limit exceeded")

    async def get_cover(self, raw_url: str) -> tuple[Path, CoverCacheMeta]:
        url = await self._validate_remote_url(raw_url)
        key = hashlib.sha256(url.encode("utf-8")).hexdigest()
        lock = await self._lock_for(key)

        async with lock:
            await asyncio.to_thread(self.root.mkdir, parents=True, exist_ok=True)
            file_path = self.root / f"{key}.bin"
            meta_path = self.root / f"{key}.meta.json"

            meta = await self._read_meta(meta_path)
            if meta and file_path.is_file() and meta.is_fresh():
                return file_path, meta

            try:
                refreshed = await self._refresh_cache(
                    url=url,
                    file_path=file_path,
                    meta_path=meta_path,
                    current_meta=meta if file_path.is_file() else None,
                )
                return file_path, refreshed
            except HTTPException:
                if meta and file_path.is_file():
                    return file_path, meta
                raise
            except Exception as exc:  # pragma: no cover - defensive guard
                if meta and file_path.is_file():
                    return file_path, meta
                raise HTTPException(status_code=502, detail="Unable to fetch cover image") from exc


cover_cache = CoverCacheService()


@router.get("/proxy", dependencies=[Depends(require_authenticated_user)])
async def proxy_cover(url: str = Query(..., min_length=1)):
    file_path, meta = await cover_cache.get_cover(url)
    headers = {"Cache-Control": _CACHE_CONTROL}
    if meta.etag:
        headers["ETag"] = meta.etag
    return FileResponse(file_path, media_type=meta.content_type, headers=headers)


@router.get("/library/{title_id}", response_class=FileResponse)
async def library_cover(
    title_id: int,
    _: object = Depends(require_authenticated_user),
    session: AsyncSession = Depends(get_database_session),
):
    title = await session.get(LibraryTitle, title_id)
    if title is None:
        raise HTTPException(status_code=404, detail="Library title not found")

    file_path = resolve_library_cover_path(title.local_cover_path)
    if file_path is None or not file_path.is_file():
        raise HTTPException(status_code=404, detail="Local cover not found")

    return FileResponse(
        file_path,
        headers={"Cache-Control": _CACHE_CONTROL},
    )
