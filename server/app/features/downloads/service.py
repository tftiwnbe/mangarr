import asyncio
import json
import re
import shutil
import time as _time
from datetime import datetime, timedelta, timezone
from pathlib import Path
from urllib.parse import urljoin, urlparse

import httpx
from loguru import logger
from sqlalchemy import case, exists, insert
from sqlmodel import delete, desc, func, select
from sqlmodel.ext.asyncio.session import AsyncSession

from app.bridge import tachibridge
from app.config import settings
from app.core.database import sessionmanager
from app.core.errors import BridgeAPIError
from app.core.utils import commit_with_sqlite_retry, normalize_positive_int_ids, normalize_text
from app.domain.download_profiles import (
    parse_selected_variant_ids,
    serialize_selected_variant_ids,
)
from app.domain.title_identity import resolve_libgroup_chapter_url
from app.features.downloads.storage import (
    chapter_archive_path,
    chapter_has_payload,
    chapter_payload_size_bytes,
    compress_chapter_pages,
    extract_chapter_pages,
    list_chapter_image_files,
    read_chapter_metadata,
    read_title_metadata,
    write_chapter_metadata,
    write_title_metadata,
)
from app.features.extensions import ExtensionService
from app.models import (
    DownloadOverviewResource,
    DownloadExternalImportRequest,
    DownloadExternalImportResponse,
    DownloadExternalTitleResource,
    DownloadProfile,
    DownloadProfileVariant,
    DownloadProfileResource,
    DownloadProfileUpdate,
    DownloadDashboardResource,
    DownloadMonitoredTitleResource,
    DownloadReconcileResource,
    DownloadStrategy,
    DownloadTask,
    DownloadTaskResource,
    DownloadTaskStatus,
    DownloadTrigger,
    EnqueueChapterResponse,
    EnqueueTitleResponse,
    LibraryChapter,
    LibraryChapterPage,
    LibraryImportRequest,
    LibraryTitle,
    LibraryUserStatus,
    LibraryTitleVariant,
    MonitorRunResponse,
    Source,
    SourceChapter,
    SourcePreference,
    WorkerRunResponse,
)

_service_logger = logger.bind(module="downloads.service")

# Lazy import to avoid circular dependency at module load time.
def _ws_broadcast(event: dict) -> None:
    from app.core.ws import ws_manager  # noqa: PLC0415
    loop = asyncio.get_event_loop()
    if not loop.is_closed():
        loop.create_task(ws_manager.broadcast(event))
_SAFE_SEGMENT_RE = re.compile(r"[^a-zA-Z0-9._ -]+")
_HASH_SUFFIX_RE = re.compile(r"\s+--\s+[0-9a-f]{6,}$", re.IGNORECASE)
_LANG_SUFFIX_RE = re.compile(r"\s+\[([a-z]{2,5}(?:-[a-z0-9]{2,5})?)\]$", re.IGNORECASE)
_LEADING_INDEX_RE = re.compile(r"^\d+\s*[-_.]\s*")
_CHAPTER_DIR_HINT_RE = re.compile(r"^\d+(?:\.\d+)?$")
_CHAPTER_NUMBER_RE = re.compile(
    r"(?:^|[\s\[(])ch(?:apter)?[.\s:_-]*(\d+(?:\.\d+)?)",
    re.IGNORECASE,
)
_NUMBER_FALLBACK_RE = re.compile(r"(\d+(?:\.\d+)?)")
_IMAGE_SUFFIXES = {".jpg", ".jpeg", ".png", ".webp", ".gif", ".avif"}


def _now_utc() -> datetime:
    return datetime.now(timezone.utc)


def _safe_segment(value: str, fallback: str) -> str:
    cleaned = _SAFE_SEGMENT_RE.sub("_", value).strip(" ._")
    return cleaned[:80] or fallback


_normalize_text = normalize_text


def _strip_hash_suffix(value: str) -> str:
    return _HASH_SUFFIX_RE.sub("", value).strip()


def _strip_leading_index(value: str) -> str:
    return _LEADING_INDEX_RE.sub("", value).strip()


def _split_name_lang(value: str) -> tuple[str, str | None]:
    base = _strip_hash_suffix(value)
    match = _LANG_SUFFIX_RE.search(base)
    if not match:
        return base.strip(), None
    lang = match.group(1).lower().strip()
    name = base[: match.start()].strip()
    return name, lang or None


def _chapter_number_from_text(value: str | None) -> float | None:
    if not value:
        return None
    text = value.strip()
    if not text:
        return None

    match = _CHAPTER_NUMBER_RE.search(text)
    if match:
        try:
            number = float(match.group(1))
            return number if number > 0 else None
        except ValueError:
            return None

    fallback = _NUMBER_FALLBACK_RE.search(text)
    if not fallback:
        return None
    try:
        number = float(fallback.group(1))
        return number if number > 0 else None
    except ValueError:
        return None


def _coerce_positive_float(value: object) -> float | None:
    try:
        numeric = float(value)
    except (TypeError, ValueError):
        return None
    return numeric if numeric > 0 else None


def _chapter_number_key(value: float | None) -> str | None:
    if value is None:
        return None
    if value <= 0:
        return None
    return _format_chapter_number_segment(value)


def _format_chapter_number_segment(value: object) -> str | None:
    try:
        numeric = float(value)  # tolerate DB values stored as strings
    except (TypeError, ValueError):
        return None
    if numeric <= 0:
        return None
    if numeric.is_integer():
        return str(int(numeric))
    return str(numeric)


def _short_error(exc: Exception) -> str:
    text = str(exc).strip()
    return text[:500] if text else exc.__class__.__name__


def _as_utc(value: datetime | None) -> datetime | None:
    if value is None:
        return None
    if value.tzinfo is None or value.tzinfo.utcoffset(value) is None:
        return value.replace(tzinfo=timezone.utc)
    return value.astimezone(timezone.utc)


def _payload_str(payload: dict | None, *keys: str) -> str | None:
    if not isinstance(payload, dict):
        return None
    current: object = payload
    for key in keys:
        if not isinstance(current, dict):
            return None
        current = current.get(key)
    if isinstance(current, str) and current.strip():
        return current.strip()
    return None


def _coerce_task_status(value: object) -> DownloadTaskStatus | None:
    if isinstance(value, DownloadTaskStatus):
        return value

    if isinstance(value, str):
        by_name = DownloadTaskStatus.__members__.get(value)
        if by_name is not None:
            return by_name
        try:
            return DownloadTaskStatus(value)
        except ValueError:
            return None

    return None


def _extension_from_content_type(content_type: str | None) -> str | None:
    if not content_type:
        return None

    normalized = content_type.split(";", 1)[0].strip().lower()
    mapping = {
        "image/jpeg": ".jpg",
        "image/jpg": ".jpg",
        "image/png": ".png",
        "image/webp": ".webp",
        "image/gif": ".gif",
        "image/avif": ".avif",
    }
    return mapping.get(normalized)


def _extension_from_url(url: str) -> str | None:
    path = urlparse(url).path
    suffix = Path(path).suffix.lower()
    if suffix in {".jpg", ".jpeg", ".png", ".webp", ".gif", ".avif"}:
        if suffix == ".jpeg":
            return ".jpg"
        return suffix
    return None


class DownloadService:
    _monitor_lock = asyncio.Lock()
    _worker_lock = asyncio.Lock()
    _enqueue_lock = asyncio.Lock()
    _compression_backlog_lock = asyncio.Lock()
    _metadata_cleanup_lock = asyncio.Lock()

    def __init__(self, session: AsyncSession):
        self.session = session
        self._download_root_cache: Path | None = None
        self._source_image_base_cache: dict[str, str | None] = {}
        self._source_request_headers_cache: dict[str, dict[str, str] | None] = {}

    async def get_overview(self) -> DownloadOverviewResource:
        monitored_titles = int(
            (
                await self.session.exec(
                    select(func.count(DownloadProfile.id)).where(DownloadProfile.enabled)
                )
            ).one()
            or 0
        )

        rows = (
            await self.session.exec(
                select(DownloadTask.status, func.count(DownloadTask.id)).group_by(
                    DownloadTask.status
                )
            )
        ).all()
        by_status: dict[DownloadTaskStatus, int] = {}
        for raw_status, count in rows:
            status = _coerce_task_status(raw_status)
            if status is None:
                continue
            by_status[status] = int(count)

        latest_task_ids = (
            select(
                DownloadTask.library_title_id.label("library_title_id"),
                DownloadTask.chapter_id.label("chapter_id"),
                func.max(DownloadTask.id).label("latest_task_id"),
            )
            .group_by(DownloadTask.library_title_id, DownloadTask.chapter_id)
            .subquery()
        )
        failed_latest_value = (
            await self.session.exec(
                select(func.count(DownloadTask.id))
                .join(
                    latest_task_ids,
                    DownloadTask.id == latest_task_ids.c.latest_task_id,
                )
                .where(DownloadTask.status == DownloadTaskStatus.FAILED)
            )
        ).one()
        failed_chapters = int(failed_latest_value or 0)

        downloaded_chapters = int(
            (
                await self.session.exec(
                    select(func.count(LibraryChapter.id)).where(
                        LibraryChapter.is_downloaded == True  # noqa: E712
                    )
                )
            ).one()
            or 0
        )
        total_downloaded_bytes_value, chapters_with_size_value, _ = (
            await self._calculate_downloaded_size_stats()
        )
        avg_chapter_size_bytes = (
            int(total_downloaded_bytes_value / chapters_with_size_value)
            if chapters_with_size_value > 0
            else 0
        )
        try:
            free_disk_bytes = int(shutil.disk_usage(self._downloads_root()).free)
        except Exception:
            free_disk_bytes = 0
        estimated_chapters_fit = (
            int(free_disk_bytes // avg_chapter_size_bytes)
            if avg_chapter_size_bytes > 0
            else 0
        )

        return DownloadOverviewResource(
            monitored_titles=monitored_titles,
            queued=by_status.get(DownloadTaskStatus.QUEUED, 0),
            downloading=by_status.get(DownloadTaskStatus.DOWNLOADING, 0),
            completed=by_status.get(DownloadTaskStatus.COMPLETED, 0),
            failed=failed_chapters,
            cancelled=by_status.get(DownloadTaskStatus.CANCELLED, 0),
            downloaded_chapters=downloaded_chapters,
            total_downloaded_bytes=total_downloaded_bytes_value,
            avg_chapter_size_bytes=avg_chapter_size_bytes,
            free_disk_bytes=free_disk_bytes,
            estimated_chapters_fit=estimated_chapters_fit,
        )

    async def get_dashboard(
        self,
        monitored_limit: int = 30,
        active_limit: int = 20,
        recent_limit: int = 20,
    ) -> DownloadDashboardResource:
        overview = await self.get_overview()

        preload_limit = max(monitored_limit * 5, monitored_limit)
        profile_rows = (
            await self.session.exec(
                select(DownloadProfile)
                .order_by(desc(DownloadProfile.updated_at))
                .limit(preload_limit)
            )
        ).all()
        profiles_by_title_id = {
            int(profile.library_title_id): profile for profile in profile_rows
        }

        downloaded_recent_rows = (
            await self.session.exec(
                select(
                    LibraryChapter.library_title_id,
                    func.max(
                        func.coalesce(
                            LibraryChapter.downloaded_at,
                            LibraryChapter.updated_at,
                        )
                    ),
                )
                .where(LibraryChapter.is_downloaded == True)  # noqa: E712
                .group_by(LibraryChapter.library_title_id)
                .order_by(
                    desc(
                        func.max(
                            func.coalesce(
                                LibraryChapter.downloaded_at,
                                LibraryChapter.updated_at,
                            )
                        )
                    )
                )
                .limit(preload_limit)
            )
        ).all()
        downloaded_recent_by_title_id = {
            int(title_id): _as_utc(last_downloaded_at)
            for title_id, last_downloaded_at in downloaded_recent_rows
            if title_id is not None
        }

        candidate_title_ids = sorted(
            {
                *profiles_by_title_id.keys(),
                *downloaded_recent_by_title_id.keys(),
            }
        )
        title_rows = (
            await self.session.exec(
                select(LibraryTitle).where(LibraryTitle.id.in_(candidate_title_ids))
            )
        ).all() if candidate_title_ids else []
        titles_by_id = {
            int(title.id): title for title in title_rows if title.id is not None
        }

        def monitored_recency_ts(title_id: int) -> float:
            profile = profiles_by_title_id.get(title_id)
            if profile is not None:
                updated_at = _as_utc(profile.updated_at)
                if updated_at is not None:
                    return updated_at.timestamp()
            downloaded_at = downloaded_recent_by_title_id.get(title_id)
            if downloaded_at is not None:
                return downloaded_at.timestamp()
            title_model = titles_by_id.get(title_id)
            if title_model is None:
                return 0.0
            title_updated = _as_utc(title_model.updated_at)
            return title_updated.timestamp() if title_updated is not None else 0.0

        ordered_title_ids = sorted(
            [title_id for title_id in candidate_title_ids if title_id in titles_by_id],
            key=lambda title_id: (
                0 if profiles_by_title_id.get(title_id, None) and profiles_by_title_id[title_id].enabled else 1,
                -monitored_recency_ts(title_id),
                -title_id,
            ),
        )[:monitored_limit]

        title_ids = ordered_title_ids
        selected_variant_ids_by_title: dict[int, list[int]] = {}
        for title_id in title_ids:
            selected_variant_ids_by_title[title_id] = await self._profile_variant_ids(
                profiles_by_title_id.get(title_id)
            )
        selected_variant_ids = sorted(
            {
                variant_id
                for ids in selected_variant_ids_by_title.values()
                for variant_id in ids
            }
        )
        preferred_title_variant_ids = [
            int(titles_by_id[title_id].preferred_variant_id)
            for title_id in title_ids
            if titles_by_id[title_id].preferred_variant_id is not None
        ]
        preferred_variant_ids = sorted(
            {
                int(profile.preferred_variant_id)
                for profile in profiles_by_title_id.values()
                if profile.preferred_variant_id is not None
            }
        )
        variant_ids_to_load = sorted(
            {
                *selected_variant_ids,
                *preferred_variant_ids,
                *preferred_title_variant_ids,
            }
        )
        variants_by_id: dict[int, LibraryTitleVariant] = {}
        if variant_ids_to_load:
            variant_rows = (
                await self.session.exec(
                    select(LibraryTitleVariant).where(
                        LibraryTitleVariant.id.in_(variant_ids_to_load)
                    )
                )
            ).all()
            variants_by_id = {
                int(variant.id): variant for variant in variant_rows if variant.id is not None
            }

        chapter_variant_ids_by_title: dict[int, list[int]] = {}
        for title_id in title_ids:
            selected_ids = [
                variant_id
                for variant_id in selected_variant_ids_by_title.get(title_id, [])
                if variant_id in variants_by_id
            ]
            if not selected_ids:
                profile = profiles_by_title_id.get(title_id)
                title = titles_by_id.get(title_id)
                fallback_variant_id = (
                    int(profile.preferred_variant_id)
                    if profile is not None and profile.preferred_variant_id is not None
                    else (
                        int(title.preferred_variant_id)
                        if title is not None and title.preferred_variant_id is not None
                        else None
                    )
                )
                if (
                    fallback_variant_id is not None
                    and fallback_variant_id in variants_by_id
                ):
                    selected_ids = [fallback_variant_id]
            chapter_variant_ids_by_title[title_id] = selected_ids

        chapter_stats: dict[int, tuple[int, int]] = {}
        chapter_variant_ids = sorted(
            {
                variant_id
                for per_title_ids in chapter_variant_ids_by_title.values()
                for variant_id in per_title_ids
            }
        )
        if title_ids and chapter_variant_ids:
            chapter_rows = (
                await self.session.exec(
                    select(
                        LibraryChapter.library_title_id,
                        func.count(LibraryChapter.id),
                        func.sum(
                            case((LibraryChapter.is_downloaded == True, 1), else_=0)  # noqa: E712
                        ),
                    )
                    .where(
                        LibraryChapter.library_title_id.in_(title_ids),
                        LibraryChapter.variant_id.in_(chapter_variant_ids),
                    )
                    .group_by(LibraryChapter.library_title_id)
                )
            ).all()
            chapter_stats = {
                int(title_id): (int(total), int(downloaded or 0))
                for title_id, total, downloaded in chapter_rows
            }

        title_size_stats: dict[int, tuple[int, int]] = {}
        if title_ids:
            _, _, title_size_stats = await self._calculate_downloaded_size_stats(
                title_ids=title_ids
            )

        task_stats: dict[int, dict[DownloadTaskStatus, int]] = {}
        if title_ids:
            active_task_rows = (
                await self.session.exec(
                    select(
                        DownloadTask.library_title_id,
                        DownloadTask.status,
                        func.count(DownloadTask.id),
                    )
                    .where(
                        DownloadTask.library_title_id.in_(title_ids),
                        DownloadTask.status.in_(
                            [
                                DownloadTaskStatus.QUEUED,
                                DownloadTaskStatus.DOWNLOADING,
                            ]
                        ),
                    )
                    .group_by(DownloadTask.library_title_id, DownloadTask.status)
                )
            ).all()
            for title_id, raw_status, count in active_task_rows:
                status = _coerce_task_status(raw_status)
                if status is None:
                    continue
                per_title = task_stats.setdefault(int(title_id), {})
                per_title[status] = int(count)

            # Count failed chapters by latest attempt only. This avoids inflating
            # failed counters when historical attempts failed but later retries succeeded.
            latest_task_ids = (
                select(
                    DownloadTask.chapter_id.label("chapter_id"),
                    func.max(DownloadTask.id).label("latest_task_id"),
                )
                .where(DownloadTask.library_title_id.in_(title_ids))
                .group_by(DownloadTask.chapter_id)
                .subquery()
            )
            failed_latest_rows = (
                await self.session.exec(
                    select(DownloadTask.library_title_id, func.count(DownloadTask.id))
                    .join(
                        latest_task_ids,
                        DownloadTask.id == latest_task_ids.c.latest_task_id,
                    )
                    .where(DownloadTask.status == DownloadTaskStatus.FAILED)
                    .group_by(DownloadTask.library_title_id)
                )
            ).all()
            for title_id, count in failed_latest_rows:
                per_title = task_stats.setdefault(int(title_id), {})
                per_title[DownloadTaskStatus.FAILED] = int(count)

        monitored_titles: list[DownloadMonitoredTitleResource] = []
        for title_id in title_ids:
            title = titles_by_id.get(title_id)
            if title is None:
                continue
            profile = profiles_by_title_id.get(title_id)
            selected_variant_ids = [
                item
                for item in selected_variant_ids_by_title.get(title_id, [])
                if item in variants_by_id
            ]
            selected_variants = [variants_by_id[item] for item in selected_variant_ids]
            preferred_variant_id = (
                int(profile.preferred_variant_id)
                if profile is not None and profile.preferred_variant_id is not None
                else (
                    int(title.preferred_variant_id)
                    if title.preferred_variant_id is not None
                    else None
                )
            )
            primary_variant = (
                selected_variants[0]
                if selected_variants
                else (
                    variants_by_id.get(preferred_variant_id)
                    if preferred_variant_id is not None
                    else None
                )
            )
            display_title = (
                primary_variant.title
                if primary_variant is not None and primary_variant.title
                else title.title
            )
            display_thumbnail = (
                primary_variant.thumbnail_url
                if primary_variant is not None and primary_variant.thumbnail_url
                else title.thumbnail_url
            )
            variant_sources = [
                (
                    f"{variant.source_name or variant.source_id}"
                    + (
                        f" [{variant.source_lang}]"
                        if (variant.source_lang or "").strip()
                        else ""
                    )
                )
                for variant in selected_variants
            ]
            if not variant_sources and primary_variant is not None:
                variant_sources = [
                    f"{primary_variant.source_name or primary_variant.source_id}"
                    + (
                        f" [{primary_variant.source_lang}]"
                        if (primary_variant.source_lang or "").strip()
                        else ""
                    )
                ]
            total, downloaded = chapter_stats.get(title_id, (0, 0))
            downloaded_bytes, downloaded_chapters_with_size = title_size_stats.get(
                title_id,
                (0, 0),
            )
            avg_chapter_size_bytes = (
                int(downloaded_bytes / downloaded_chapters_with_size)
                if downloaded_chapters_with_size > 0
                else 0
            )
            stats = task_stats.get(title_id, {})
            queued = stats.get(DownloadTaskStatus.QUEUED, 0) + stats.get(
                DownloadTaskStatus.DOWNLOADING, 0
            )
            failed = stats.get(DownloadTaskStatus.FAILED, 0)
            monitored_titles.append(
                DownloadMonitoredTitleResource(
                    library_title_id=title_id,
                    title=display_title,
                    thumbnail_url=display_thumbnail,
                    enabled=profile.enabled if profile is not None else False,
                    paused=profile.paused if profile is not None else False,
                    auto_download=profile.auto_download if profile is not None else False,
                    strategy=(
                        profile.strategy
                        if profile is not None
                        else DownloadStrategy.NEW_ONLY
                    ),
                    preferred_variant_id=preferred_variant_id,
                    variant_ids=selected_variant_ids,
                    variant_sources=variant_sources,
                    start_from=_as_utc(profile.start_from) if profile is not None else None,
                    last_checked_at=(
                        _as_utc(profile.last_checked_at) if profile is not None else None
                    ),
                    last_success_at=(
                        _as_utc(profile.last_success_at) if profile is not None else None
                    ),
                    last_error=profile.last_error if profile is not None else None,
                    total_chapters=total,
                    downloaded_chapters=downloaded,
                    queued_tasks=queued,
                    failed_tasks=failed,
                    downloaded_bytes=downloaded_bytes,
                    avg_chapter_size_bytes=avg_chapter_size_bytes,
                )
            )

        min_priority = func.min(DownloadTask.priority).label("min_priority")
        first_created_at = func.min(DownloadTask.created_at).label("first_created_at")
        active_title_rows = (
            await self.session.exec(
                select(
                    DownloadTask.library_title_id,
                    min_priority,
                    first_created_at,
                )
                .where(
                    DownloadTask.status.in_(
                        [
                            DownloadTaskStatus.QUEUED,
                            DownloadTaskStatus.DOWNLOADING,
                        ]
                    )
                )
                .group_by(DownloadTask.library_title_id)
                .order_by(min_priority, first_created_at)
                .limit(active_limit)
            )
        ).all()
        active_title_ids = [int(row[0]) for row in active_title_rows]

        active_rows: list[DownloadTask] = []
        if active_title_ids:
            active_rows = (
                await self.session.exec(
                    select(DownloadTask)
                    .where(
                        DownloadTask.status.in_(
                            [
                                DownloadTaskStatus.QUEUED,
                                DownloadTaskStatus.DOWNLOADING,
                            ]
                        ),
                        DownloadTask.library_title_id.in_(active_title_ids),
                    )
                    .order_by(DownloadTask.priority, DownloadTask.created_at)
                )
            ).all()

        recent_rows = (
            await self.session.exec(
                select(DownloadTask)
                .where(
                    DownloadTask.status.in_(
                        [
                            DownloadTaskStatus.COMPLETED,
                            DownloadTaskStatus.FAILED,
                            DownloadTaskStatus.CANCELLED,
                        ]
                    )
                )
                .order_by(desc(DownloadTask.finished_at), desc(DownloadTask.updated_at))
                .limit(recent_limit)
            )
        ).all()

        task_title_ids = {
            int(task.library_title_id)
            for task in [*active_rows, *recent_rows]
            if task.library_title_id is not None
        }
        paused_by_title_id: dict[int, bool] = {}
        if task_title_ids:
            paused_rows = (
                await self.session.exec(
                    select(DownloadProfile.library_title_id, DownloadProfile.paused).where(
                        DownloadProfile.library_title_id.in_(sorted(task_title_ids))
                    )
                )
            ).all()
            paused_by_title_id = {
                int(title_id): bool(paused) for title_id, paused in paused_rows
            }

        active_tasks = [
            self._to_task_resource(
                task,
                is_paused=paused_by_title_id.get(int(task.library_title_id), False),
            )
            for task in active_rows
        ]
        recent_tasks = [
            self._to_task_resource(
                task,
                is_paused=paused_by_title_id.get(int(task.library_title_id), False),
            )
            for task in recent_rows
        ]

        return DownloadDashboardResource(
            generated_at=_now_utc(),
            overview=overview,
            monitored_titles=monitored_titles,
            active_tasks=active_tasks,
            recent_tasks=recent_tasks,
        )

    async def list_profiles(
        self,
        enabled: bool | None = None,
        title_id: int | None = None,
        offset: int = 0,
        limit: int = 50,
    ) -> list[DownloadProfileResource]:
        stmt = select(DownloadProfile).order_by(desc(DownloadProfile.updated_at))
        if enabled is not None:
            stmt = stmt.where(DownloadProfile.enabled == enabled)
        if title_id is not None:
            stmt = stmt.where(DownloadProfile.library_title_id == title_id)

        rows = (await self.session.exec(stmt.offset(offset).limit(limit))).all()
        resources: list[DownloadProfileResource] = []
        for profile in rows:
            resources.append(await self._to_profile_resource(profile))
        return resources

    async def get_profile(self, title_id: int) -> DownloadProfileResource:
        title = await self.session.get(LibraryTitle, title_id)
        if title is None:
            raise BridgeAPIError(404, f"Library title not found: {title_id}")

        profile = await self._get_or_create_profile(title_id)
        await commit_with_sqlite_retry(self.session)
        await self.session.refresh(profile)
        return await self._to_profile_resource(profile)

    async def update_profile(
        self,
        title_id: int,
        payload: DownloadProfileUpdate,
    ) -> DownloadProfileResource:
        title = await self.session.get(LibraryTitle, title_id)
        if title is None:
            raise BridgeAPIError(404, f"Library title not found: {title_id}")

        profile = await self._get_or_create_profile(title_id)

        if payload.preferred_variant_id is not None:
            variant = await self.session.get(LibraryTitleVariant, payload.preferred_variant_id)
            if variant is None or variant.library_title_id != title_id:
                raise BridgeAPIError(
                    404,
                    f"Variant not found for library title: {payload.preferred_variant_id}",
                )
        normalized_payload_variant_ids: list[int] | None = None
        if payload.variant_ids is not None:
            normalized_payload_variant_ids = await self._normalize_profile_variant_ids(
                title_id=title_id,
                variant_ids=payload.variant_ids,
            )
            if len(normalized_payload_variant_ids) != len(
                self._normalize_positive_int_ids(payload.variant_ids)
            ):
                raise BridgeAPIError(404, "One or more variants are not linked to this title")

        updates = payload.model_dump(exclude_unset=True)
        now = _now_utc()

        if "enabled" in updates:
            profile.enabled = bool(updates["enabled"])
        if "paused" in updates:
            profile.paused = bool(updates["paused"])
        if "auto_download" in updates:
            profile.auto_download = bool(updates["auto_download"])
        if "strategy" in updates and updates["strategy"] is not None:
            profile.strategy = updates["strategy"]
        if normalized_payload_variant_ids is not None:
            await self._set_profile_variant_ids(profile, normalized_payload_variant_ids)
        if "preferred_variant_id" in updates:
            preferred_variant_id = updates["preferred_variant_id"]
            if preferred_variant_id is None:
                if "variant_ids" not in updates:
                    profile.preferred_variant_id = None
            else:
                selected_ids = (
                    await self._profile_variant_ids(profile)
                    if "variant_ids" not in updates
                    else normalized_payload_variant_ids or []
                )
                if preferred_variant_id in selected_ids:
                    reordered = [preferred_variant_id] + [
                        item for item in selected_ids if item != preferred_variant_id
                    ]
                else:
                    reordered = [preferred_variant_id, *selected_ids]
                await self._set_profile_variant_ids(profile, reordered)
        if "start_from" in updates:
            profile.start_from = updates["start_from"]

        if profile.enabled and not await self._profile_variant_ids(profile):
            variant = await self._resolve_variant(title_id=title_id, preferred_variant_id=None)
            if variant.id is not None:
                await self._set_profile_variant_ids(profile, [int(variant.id)])

        profile.updated_at = now
        self.session.add(profile)
        await commit_with_sqlite_retry(self.session)
        await self.session.refresh(profile)

        return await self._to_profile_resource(profile)

    async def list_tasks(
        self,
        status: DownloadTaskStatus | None = None,
        title_id: int | None = None,
        offset: int = 0,
        limit: int = 50,
    ) -> list[DownloadTaskResource]:
        stmt = select(DownloadTask).order_by(desc(DownloadTask.created_at))

        if status is not None:
            stmt = stmt.where(DownloadTask.status == status)
        if title_id is not None:
            stmt = stmt.where(DownloadTask.library_title_id == title_id)

        rows = (await self.session.exec(stmt.offset(offset).limit(limit))).all()
        title_ids = {int(task.library_title_id) for task in rows if task.library_title_id is not None}
        paused_by_title_id: dict[int, bool] = {}
        if title_ids:
            paused_rows = (
                await self.session.exec(
                    select(DownloadProfile.library_title_id, DownloadProfile.paused).where(
                        DownloadProfile.library_title_id.in_(sorted(title_ids))
                    )
                )
            ).all()
            paused_by_title_id = {
                int(task_title_id): bool(paused) for task_title_id, paused in paused_rows
            }
        return [
            self._to_task_resource(
                task,
                is_paused=paused_by_title_id.get(int(task.library_title_id), False),
            )
            for task in rows
        ]

    async def enqueue_chapter(
        self,
        chapter_id: int,
        trigger: DownloadTrigger = DownloadTrigger.MANUAL,
        priority: int = 100,
    ) -> EnqueueChapterResponse:
        task, _ = await self._enqueue_chapter_if_needed(
            chapter_id=chapter_id,
            trigger=trigger,
            priority=priority,
            attempt_group_id=None,
        )
        await commit_with_sqlite_retry(self.session)
        if task.id is None:
            raise BridgeAPIError(500, "Failed to enqueue chapter")
        return EnqueueChapterResponse(task_id=int(task.id), status=task.status)

    async def enqueue_missing_for_title(
        self,
        title_id: int,
        variant_id: int | None = None,
        unread_only: bool = True,
    ) -> EnqueueTitleResponse:
        title = await self.session.get(LibraryTitle, title_id)
        if title is None:
            raise BridgeAPIError(404, f"Library title not found: {title_id}")

        target_variant = await self._resolve_variant(title_id, preferred_variant_id=variant_id)

        stmt = select(LibraryChapter).where(
            LibraryChapter.variant_id == int(target_variant.id),
            LibraryChapter.is_downloaded == False,  # noqa: E712
        )
        if unread_only:
            stmt = stmt.where(LibraryChapter.is_read == False)  # noqa: E712

        chapters = (
            await self.session.exec(
                stmt.order_by(*self._chapter_order_oldest_first())
            )
        ).all()

        queued = 0
        attempt_group_id: int | None = None
        for chapter in chapters:
            task, created = await self._enqueue_chapter_if_needed(
                chapter_id=int(chapter.id),
                trigger=DownloadTrigger.MANUAL,
                priority=80,
                attempt_group_id=attempt_group_id,
            )
            if created:
                if attempt_group_id is None and task.attempt_group_id is not None:
                    attempt_group_id = int(task.attempt_group_id)
                queued += 1

        await commit_with_sqlite_retry(self.session)
        return EnqueueTitleResponse(queued=queued)

    async def retry_task(self, task_id: int) -> DownloadTaskResource:
        task = await self.session.get(DownloadTask, task_id)
        if task is None:
            raise BridgeAPIError(404, f"Download task not found: {task_id}")

        if task.status in (DownloadTaskStatus.QUEUED, DownloadTaskStatus.DOWNLOADING):
            raise BridgeAPIError(409, "Task is already active")
        if task.status == DownloadTaskStatus.COMPLETED:
            raise BridgeAPIError(409, "Completed task cannot be retried")

        existing_active = (
            await self.session.exec(
                select(DownloadTask)
                .where(
                    DownloadTask.chapter_id == task.chapter_id,
                    DownloadTask.status.in_(
                        [DownloadTaskStatus.QUEUED, DownloadTaskStatus.DOWNLOADING]
                    ),
                )
                .limit(1)
            )
        ).first()
        if existing_active is not None:
            raise BridgeAPIError(409, "Chapter already has an active task")

        queued_retry = self._spawn_retry_task(
            task=task,
            available_at=_now_utc(),
            trigger=DownloadTrigger.MANUAL,
            attempts_seed=0,
            error=None,
        )
        await self._finalize_new_task(queued_retry)
        await commit_with_sqlite_retry(self.session)
        await self.session.refresh(queued_retry)

        return self._to_task_resource(queued_retry)

    async def cancel_task(self, task_id: int) -> DownloadTaskResource:
        task = await self.session.get(DownloadTask, task_id)
        if task is None:
            raise BridgeAPIError(404, f"Download task not found: {task_id}")

        if task.status == DownloadTaskStatus.COMPLETED:
            raise BridgeAPIError(409, "Completed task cannot be cancelled")

        task.status = DownloadTaskStatus.CANCELLED
        task.finished_at = _now_utc()
        task.updated_at = _now_utc()
        self.session.add(task)
        await commit_with_sqlite_retry(self.session)
        await self.session.refresh(task)

        return self._to_task_resource(task)

    async def run_monitor_once(
        self,
        limit: int = 25,
        seed_existing: bool = False,
    ) -> MonitorRunResponse:
        _t0 = _time.monotonic()
        async with self._monitor_lock:
            rows = (
                await self.session.exec(
                    select(DownloadProfile)
                    .where(DownloadProfile.enabled, DownloadProfile.paused == False)  # noqa: E712
                    .order_by(desc(DownloadProfile.updated_at))
                    .limit(limit)
                )
            ).all()
            profiles = list(rows)

            checked = 0
            enqueued_total = 0

            for profile in profiles:
                checked += 1
                now = _now_utc()
                try:
                    first_check = profile.last_checked_at is None
                    title = await self.session.get(LibraryTitle, profile.library_title_id)
                    if title is None:
                        profile.enabled = False
                        profile.last_error = (
                            f"Library title not found: {profile.library_title_id}"
                        )
                        profile.last_checked_at = now
                        profile.updated_at = now
                        self.session.add(profile)
                        await commit_with_sqlite_retry(self.session)
                        continue

                    variants = await self._resolve_profile_variants(
                        title_id=int(title.id),
                        profile=profile,
                    )
                    new_chapter_ids_by_variant: dict[int, list[int]] = {}
                    sync_errors: list[str] = []
                    sync_success = 0
                    for variant in variants:
                        if variant.id is None:
                            continue
                        try:
                            new_chapter_ids_by_variant[int(variant.id)] = (
                                await self._sync_variant_and_collect_new(
                                    title=title,
                                    variant=variant,
                                )
                            )
                            sync_success += 1
                        except Exception as sync_exc:  # pragma: no cover - defensive branch
                            sync_errors.append(
                                f"{variant.source_id}: {_short_error(sync_exc)}"
                            )
                            _service_logger.warning(
                                "Monitor sync failed for title_id={}, variant_id={}, using cached chapters: {}",
                                profile.library_title_id,
                                variant.id,
                                _short_error(sync_exc),
                            )

                    profile.last_checked_at = now
                    if sync_success > 0:
                        profile.last_success_at = now
                    if sync_errors:
                        profile.last_error = "; ".join(sync_errors)[:500]
                    elif sync_success > 0:
                        profile.last_error = None
                    profile.updated_at = now
                    self.session.add(profile)

                    if profile.auto_download:
                        attempt_group_id: int | None = None
                        for variant in variants:
                            if variant.id is None:
                                continue
                            candidate_ids = await self._chapters_for_profile(
                                variant_id=int(variant.id),
                                new_chapter_ids=new_chapter_ids_by_variant.get(
                                    int(variant.id), []
                                ),
                                profile=profile,
                                first_check=first_check,
                                seed_existing=seed_existing or int(variant.id) not in new_chapter_ids_by_variant,
                            )
                            for chapter_id in candidate_ids:
                                task, created = await self._enqueue_chapter_if_needed(
                                    chapter_id=chapter_id,
                                    trigger=DownloadTrigger.MONITOR,
                                    priority=60,
                                    attempt_group_id=attempt_group_id,
                                )
                                if created:
                                    if (
                                        attempt_group_id is None
                                        and task.attempt_group_id is not None
                                    ):
                                        attempt_group_id = int(task.attempt_group_id)
                                    enqueued_total += 1

                    await commit_with_sqlite_retry(self.session)
                except Exception as exc:
                    profile.last_checked_at = now
                    profile.last_error = _short_error(exc)
                    profile.updated_at = now
                    self.session.add(profile)
                    await commit_with_sqlite_retry(self.session)
                    _service_logger.exception(
                        "Monitor refresh failed for title_id={}",
                        profile.library_title_id,
                    )

            result = MonitorRunResponse(
                checked_titles=checked,
                enqueued_tasks=enqueued_total,
            )
            if checked > 0 or enqueued_total > 0:
                _service_logger.bind(
                    titles_checked=checked,
                    enqueued=enqueued_total,
                    duration_ms=round((_time.monotonic() - _t0) * 1000),
                ).info("monitor.run")
                _ws_broadcast({"event": "monitor.run", "enqueued": enqueued_total})
            return result

    async def run_worker_once(self, batch_size: int | None = None) -> WorkerRunResponse:
        _t0 = _time.monotonic()
        async with self._worker_lock:
            await self._requeue_stale_downloading_tasks()
            limit = batch_size or max(
                settings.downloads.worker_batch_size,
                settings.downloads.parallel_downloads,
            )
            claimed_task_ids: list[int] = []
            for _ in range(limit):
                task = await self._claim_next_task()
                if task is None:
                    break
                if task.id is not None:
                    claimed_task_ids.append(int(task.id))

            if not claimed_task_ids:
                return WorkerRunResponse(processed_tasks=0)

            parallel = max(1, min(settings.downloads.parallel_downloads, len(claimed_task_ids)))
            if parallel == 1:
                for task_id in claimed_task_ids:
                    await self._process_task_isolated(task_id)
            else:
                semaphore = asyncio.Semaphore(parallel)

                async def run_one(task_id: int) -> None:
                    async with semaphore:
                        try:
                            await self._process_task_isolated(task_id)
                        except Exception:
                            _service_logger.exception(
                                "Unhandled worker failure for task_id={}",
                                task_id,
                            )

                await asyncio.gather(*(run_one(task_id) for task_id in claimed_task_ids))

            processed = len(claimed_task_ids)
            if processed > 0:
                _service_logger.bind(
                    tasks=processed,
                    duration_ms=round((_time.monotonic() - _t0) * 1000),
                ).info("worker.run")
                # Note: individual task.done events are broadcast inside _log_task;
                # this worker.run event signals the batch finished.
                _ws_broadcast({"event": "worker.run", "tasks": processed})
            return WorkerRunResponse(processed_tasks=processed)

    @classmethod
    async def run_compress_backlog_once_isolated(
        cls,
        batch_size: int | None = None,
    ) -> int:
        async with sessionmanager.session() as session:
            service = cls(session)
            return await service.run_compress_backlog_once(batch_size=batch_size)

    async def run_compress_backlog_once(self, batch_size: int | None = None) -> int:
        if not settings.downloads.compress_downloaded_chapters:
            return 0

        async with self._compression_backlog_lock:
            keep_ids = await self._chapters_to_keep_uncompressed_for_reader()
            stmt = (
                select(LibraryChapter)
                .where(
                    LibraryChapter.is_downloaded == True,  # noqa: E712
                    LibraryChapter.download_path.is_not(None),
                )
                .order_by(
                    LibraryChapter.variant_id,
                    *self._chapter_order_oldest_first(),
                )
            )
            if batch_size is not None and batch_size > 0:
                stmt = stmt.limit(batch_size)

            rows = (await self.session.exec(stmt)).all()
            chapters = list(rows)
            if not chapters:
                return 0

            compressed = 0
            for chapter in chapters:
                if chapter.id is None or int(chapter.id) in keep_ids:
                    continue
                chapter_dir = self._resolve_download_dir(chapter.download_path)
                if chapter_dir is None:
                    continue
                try:
                    changed = await asyncio.to_thread(
                        self._compress_chapter_download,
                        chapter_dir,
                    )
                except Exception:
                    _service_logger.warning(
                        "Backlog compression failed for chapter_id={} path='{}'",
                        chapter.id,
                        chapter_dir,
                    )
                    continue
                if changed:
                    compressed += 1

            return compressed

    @classmethod
    async def run_uncompress_backlog_once_isolated(
        cls,
        batch_size: int | None = None,
    ) -> int:
        async with sessionmanager.session() as session:
            service = cls(session)
            return await service.run_uncompress_backlog_once(batch_size=batch_size)

    async def run_uncompress_backlog_once(self, batch_size: int | None = None) -> int:
        async with self._compression_backlog_lock:
            stmt = (
                select(LibraryChapter)
                .where(
                    LibraryChapter.is_downloaded == True,  # noqa: E712
                    LibraryChapter.download_path.is_not(None),
                )
                .order_by(
                    LibraryChapter.variant_id,
                    *self._chapter_order_oldest_first(),
                )
            )
            if batch_size is not None and batch_size > 0:
                stmt = stmt.limit(batch_size)

            rows = (await self.session.exec(stmt)).all()
            chapters = list(rows)
            if not chapters:
                return 0

            unpacked = 0
            for chapter in chapters:
                chapter_dir = self._resolve_download_dir(chapter.download_path)
                if chapter_dir is None:
                    continue
                try:
                    changed = await asyncio.to_thread(
                        extract_chapter_pages,
                        chapter_dir,
                    )
                except Exception:
                    _service_logger.warning(
                        "Backlog uncompress failed for chapter_id={} path='{}'",
                        chapter.id,
                        chapter_dir,
                    )
                    continue
                if changed:
                    unpacked += 1

            return unpacked

    @classmethod
    async def run_metadata_cleanup_once_isolated(cls) -> int:
        async with sessionmanager.session() as session:
            service = cls(session)
            return await service.run_metadata_cleanup_once()

    async def run_metadata_cleanup_once(self) -> int:
        async with self._metadata_cleanup_lock:
            root = self._downloads_root()
            removed = 0
            targets = {
                ".mangarr-source.json",
                ".mangarr-title.json",
                ".mangarr-chapter.json",
            }
            for file_path in root.rglob("*"):
                if not file_path.is_file():
                    continue
                if file_path.name not in targets:
                    continue
                try:
                    await asyncio.to_thread(file_path.unlink, missing_ok=True)
                    removed += 1
                except Exception:
                    _service_logger.warning(
                        "Failed to remove legacy metadata file '{}'",
                        file_path,
                    )
            return removed

    async def _chapters_to_keep_uncompressed_for_reader(self) -> set[int]:
        rows = (
            await self.session.exec(
                select(
                    LibraryChapter.id,
                    LibraryChapter.variant_id,
                    LibraryChapter.reader_updated_at,
                    LibraryChapter.reader_page_index,
                )
                .where(
                    LibraryChapter.is_downloaded == True,  # noqa: E712
                    LibraryChapter.download_path.is_not(None),
                )
                .order_by(
                    LibraryChapter.variant_id,
                    *self._chapter_order_oldest_first(),
                )
            )
        ).all()
        if not rows:
            return set()

        by_variant: dict[int, list[tuple[int, datetime | None, int | None]]] = {}
        for chapter_id, variant_id, reader_updated_at, reader_page_index in rows:
            if chapter_id is None or variant_id is None:
                continue
            by_variant.setdefault(int(variant_id), []).append(
                (
                    int(chapter_id),
                    _as_utc(reader_updated_at),
                    (
                        int(reader_page_index)
                        if reader_page_index is not None
                        else None
                    ),
                )
            )

        keep_ids: set[int] = set()
        for items in by_variant.values():
            current_index: int | None = None
            latest_updated_at: datetime | None = None
            for index, (_, updated_at, _) in enumerate(items):
                if updated_at is None:
                    continue
                if latest_updated_at is None or updated_at > latest_updated_at:
                    latest_updated_at = updated_at
                    current_index = index

            if current_index is None:
                for index, (_, _, page_index) in enumerate(items):
                    if page_index is not None and page_index >= 0:
                        current_index = index

            if current_index is None:
                continue

            keep_ids.add(items[current_index][0])
            next_index = current_index + 1
            if next_index < len(items):
                keep_ids.add(items[next_index][0])

        return keep_ids

    async def reconcile_downloads(
        self,
        query: str | None = None,
        limit: int = 100,
    ) -> DownloadReconcileResource:
        reconciled_missing = await self._reconcile_missing_downloaded_chapters()
        external_titles = await self._scan_external_download_titles(query=query, limit=limit)
        await self._auto_link_known_external_titles(external_titles)
        return DownloadReconcileResource(
            scanned_at=_now_utc(),
            reconciled_missing_chapters=reconciled_missing,
            external_titles=external_titles,
        )

    async def import_external_download_title(
        self,
        payload: DownloadExternalImportRequest,
    ) -> DownloadExternalImportResponse:
        source_id = (payload.source_id or "").strip()
        title = payload.title.strip()
        if not source_id:
            raise BridgeAPIError(400, "source_id is required")
        if not title:
            raise BridgeAPIError(400, "title is required")

        title_url = (payload.title_url or "").strip() or None
        existing_variant = await self._find_existing_variant_for_import(
            source_id=source_id,
            title_url=title_url,
            title=title,
        )
        if existing_variant is not None:
            resolved_title_url = (title_url or existing_variant.title_url or "").strip()
            if not resolved_title_url:
                raise BridgeAPIError(409, "Existing variant has no title URL")

            library_title_id = int(existing_variant.library_title_id)
            await self._assign_default_status_if_missing(library_title_id)

            linked_downloaded_chapters = 0
            if payload.path and payload.path.strip():
                linked_downloaded_chapters = await self._link_downloaded_chapters_for_import(
                    library_title_id=library_title_id,
                    source_id=source_id,
                    title_url=resolved_title_url,
                    relative_title_path=payload.path.strip(),
                )

            return DownloadExternalImportResponse(
                library_title_id=library_title_id,
                created=False,
                source_id=source_id,
                title_url=resolved_title_url,
                linked_downloaded_chapters=linked_downloaded_chapters,
            )

        if title_url is None:
            titles, _ = await tachibridge.search_titles(
                source_id=source_id,
                query=title,
                page=1,
            )
            if not titles:
                raise BridgeAPIError(404, "Unable to match title in selected source")
            normalized_query = _normalize_text(title)
            exact_match = next(
                (item for item in titles if _normalize_text(item.title) == normalized_query),
                None,
            )
            selected = exact_match or titles[0]
            title_url = selected.url

        from app.features.library.service import LibraryService

        library_service = LibraryService(self.session)
        await library_service.list_user_statuses()
        imported = await library_service.import_title(
            LibraryImportRequest(source_id=source_id, title_url=title_url)
        )
        await self._assign_default_status_if_missing(imported.library_title_id)

        linked_downloaded_chapters = 0
        if payload.path and payload.path.strip():
            linked_downloaded_chapters = await self._link_downloaded_chapters_for_import(
                library_title_id=imported.library_title_id,
                source_id=source_id,
                title_url=title_url,
                relative_title_path=payload.path.strip(),
            )

        return DownloadExternalImportResponse(
            library_title_id=imported.library_title_id,
            created=imported.created,
            source_id=source_id,
            title_url=title_url,
            linked_downloaded_chapters=linked_downloaded_chapters,
        )

    async def _find_existing_variant_for_import(
        self,
        source_id: str,
        title_url: str | None,
        title: str,
    ) -> LibraryTitleVariant | None:
        if title_url:
            existing_by_url = (
                await self.session.exec(
                    select(LibraryTitleVariant).where(
                        LibraryTitleVariant.source_id == source_id,
                        LibraryTitleVariant.title_url == title_url,
                    )
                )
            ).first()
            if existing_by_url is not None:
                return existing_by_url

        normalized_title = _normalize_text(title)
        if not normalized_title:
            return None

        source_variants = (
            await self.session.exec(
                select(LibraryTitleVariant).where(
                    LibraryTitleVariant.source_id == source_id,
                )
            )
        ).all()
        for variant in source_variants:
            if _normalize_text(variant.title) == normalized_title:
                return variant
        return None

    async def _assign_default_status_if_missing(self, title_id: int) -> None:
        title = await self.session.get(LibraryTitle, title_id)
        if title is None:
            return
        if title.user_status_id is not None:
            return

        statuses = (
            await self.session.exec(
                select(LibraryUserStatus).order_by(
                    case((LibraryUserStatus.key == "reading", 0), else_=1),
                    LibraryUserStatus.position,
                    LibraryUserStatus.id,
                )
            )
        ).all()
        first_status = next((status for status in statuses if status.id is not None), None)
        if first_status is None:
            return

        title.user_status_id = int(first_status.id)
        title.updated_at = _now_utc()
        self.session.add(title)
        await commit_with_sqlite_retry(self.session)

    @classmethod
    async def _process_task_isolated(cls, task_id: int) -> None:
        async with sessionmanager.session() as session:
            worker = cls(session)
            task = await session.get(DownloadTask, task_id)
            if task is None:
                return
            if task.status != DownloadTaskStatus.DOWNLOADING:
                return
            await worker._process_task(task)

    async def _reconcile_missing_downloaded_chapters(self) -> int:
        rows = (
            await self.session.exec(
                select(LibraryChapter).where(
                    LibraryChapter.is_downloaded == True,  # noqa: E712
                )
            )
        ).all()
        chapters = list(rows)
        if not chapters:
            return 0

        # First pass: identify chapters whose files are missing on disk (sync I/O, no DB).
        bad_chapters = [
            chapter for chapter in chapters
            if not (
                (chapter_dir := self._resolve_download_dir(chapter.download_path))
                and chapter_has_payload(chapter_dir)
            )
        ]
        if not bad_chapters:
            return 0

        # Bulk-load all pages for bad chapters in a single query.
        bad_ids = [int(c.id) for c in bad_chapters if c.id is not None]
        page_rows = (
            await self.session.exec(
                select(LibraryChapterPage).where(
                    LibraryChapterPage.chapter_id.in_(bad_ids)
                )
            )
        ).all()
        pages_by_chapter: dict[int, list[LibraryChapterPage]] = {}
        for page in page_rows:
            pages_by_chapter.setdefault(int(page.chapter_id), []).append(page)

        now = _now_utc()
        for chapter in bad_chapters:
            chapter.is_downloaded = False
            chapter.downloaded_at = None
            chapter.download_path = None
            chapter.download_error = "Downloaded files missing on disk"
            chapter.updated_at = now
            self.session.add(chapter)
            for page in pages_by_chapter.get(int(chapter.id), []):
                page.local_path = None
                page.local_size = None
                page.fetched_at = now
                self.session.add(page)

        await commit_with_sqlite_retry(self.session)
        return len(bad_chapters)

    async def _scan_external_download_titles(
        self,
        query: str | None,
        limit: int,
    ) -> list[DownloadExternalTitleResource]:
        normalized_query = _normalize_text(query)

        installed_sources = (await self.session.exec(select(Source))).all()
        by_source_id = {source.id: source for source in installed_sources}
        source_ids_by_name_lang: dict[tuple[str, str], list[str]] = {}
        for source in installed_sources:
            key = (_normalize_text(source.name), (source.lang or "").strip().lower())
            source_ids_by_name_lang.setdefault(key, []).append(source.id)

        variant_rows = (await self.session.exec(select(LibraryTitleVariant))).all()
        by_source_url = {
            (variant.source_id, variant.title_url): int(variant.library_title_id)
            for variant in variant_rows
            if variant.library_title_id is not None
        }
        by_source_title: dict[str, set[str]] = {}
        for variant in variant_rows:
            by_source_title.setdefault(variant.source_id, set()).add(
                _normalize_text(variant.title)
            )

        root = self._downloads_root()
        titles: list[DownloadExternalTitleResource] = []
        for source_dir in self._iter_source_dirs(root):
            if source_dir == root:
                for title_dir in self._iter_title_dirs(root):
                    if not self._looks_like_title_root(title_dir):
                        continue
                    item = self._build_external_title_resource(
                        root=root,
                        title_dir=title_dir,
                        source_id=None,
                        source_name="Unknown source",
                        source_lang=None,
                        by_source_id=by_source_id,
                        by_source_url=by_source_url,
                        by_source_title=by_source_title,
                    )
                    if item is None:
                        continue
                    haystack = _normalize_text(f"{item.source_name} {item.title}")
                    if normalized_query and normalized_query not in haystack:
                        continue
                    titles.append(item)
                break

            source_id, source_name, source_lang = self._resolve_source_context(
                source_dir=source_dir,
                by_source_id=by_source_id,
                source_ids_by_name_lang=source_ids_by_name_lang,
            )

            for title_dir in self._iter_title_dirs(source_dir):
                item = self._build_external_title_resource(
                    root=root,
                    title_dir=title_dir,
                    source_id=source_id,
                    source_name=source_name,
                    source_lang=source_lang,
                    by_source_id=by_source_id,
                    by_source_url=by_source_url,
                    by_source_title=by_source_title,
                )
                if item is None:
                    continue
                haystack = _normalize_text(f"{item.source_name} {item.title}")
                if normalized_query and normalized_query not in haystack:
                    continue
                titles.append(item)

        await self._resolve_missing_title_urls(
            items=titles,
            by_source_url=by_source_url,
        )

        titles.sort(
            key=lambda item: (
                item.in_library,
                _normalize_text(item.source_name),
                _normalize_text(item.title),
            )
        )
        return titles[:limit]

    def _resolve_source_context(
        self,
        source_dir: Path,
        by_source_id: dict[str, Source],
        source_ids_by_name_lang: dict[tuple[str, str], list[str]],
    ) -> tuple[str | None, str, str | None]:
        inferred_source_name, inferred_source_lang = _split_name_lang(source_dir.name)

        source_id: str | None = None
        source_name = inferred_source_name
        source_lang = inferred_source_lang or ""
        source_lang = source_lang.strip().lower() or None

        if not source_id:
            key = (_normalize_text(source_name), source_lang or "")
            matches = source_ids_by_name_lang.get(key, [])
            if len(matches) == 1:
                source_id = matches[0]

        source_model = by_source_id.get(source_id or "")
        if source_model is not None:
            source_name = source_model.name
            source_lang = source_model.lang

        return source_id, source_name or "Unknown source", source_lang

    def _build_external_title_resource(
        self,
        root: Path,
        title_dir: Path,
        source_id: str | None,
        source_name: str,
        source_lang: str | None,
        by_source_id: dict[str, Source],
        by_source_url: dict[tuple[str, str], int],
        by_source_title: dict[str, set[str]],
    ) -> DownloadExternalTitleResource | None:
        inferred_title = _strip_leading_index(_split_name_lang(title_dir.name)[0])
        manifest_source_id, manifest_title_url, manifest_title_name = self._read_title_metadata_file(
            title_dir
        )
        inferred = (
            (manifest_source_id, manifest_title_url, manifest_title_name)
            if any([manifest_source_id, manifest_title_url, manifest_title_name])
            else self._infer_metadata_from_chapters(title_dir)
        )
        source_id = source_id or inferred[0]
        title_url = inferred[1]
        title_name = inferred[2] or inferred_title
        title_name = _strip_hash_suffix(title_name).strip()

        source_model = by_source_id.get(source_id or "")
        if source_model is not None:
            source_name = source_model.name
            source_lang = source_model.lang

        if source_id and title_url:
            in_library = (source_id, title_url) in by_source_url
        elif source_id:
            in_library = _normalize_text(title_name) in by_source_title.get(source_id, set())
        else:
            in_library = False

        chapters_count = self._count_chapter_entries(title_dir)
        if chapters_count <= 0:
            return None
        rel_path = str(title_dir.relative_to(root).as_posix())
        importable = bool(source_id and (title_url or title_name))
        reason: str | None = None
        if not source_id:
            reason = "Source not matched to installed sources; pick source manually"
        elif not title_url:
            reason = "Title URL not found, will resolve by search"

        if not any([manifest_source_id, manifest_title_url, manifest_title_name]) and (
            source_id or title_url or title_name
        ):
            self._write_external_title_metadata_file(
                title_dir=title_dir,
                source_id=source_id,
                source_name=source_name,
                source_lang=source_lang,
                title_name=title_name,
                title_url=title_url,
            )

        return DownloadExternalTitleResource(
            key=rel_path,
            source_id=source_id,
            source_name=source_name or "Unknown source",
            source_lang=source_lang,
            title=title_name or title_dir.name,
            title_url=title_url,
            path=rel_path,
            chapters_count=chapters_count,
            in_library=in_library,
            importable=importable,
            reason=reason,
        )

    def _infer_metadata_from_chapters(
        self,
        title_dir: Path,
    ) -> tuple[str | None, str | None, str | None]:
        source_ids: set[str] = set()
        title_urls: set[str] = set()
        title_names: set[str] = set()
        for chapter_entry in self._iter_chapter_entries(title_dir):
            chapter_root = (
                chapter_entry.with_suffix("")
                if chapter_entry.is_file() and chapter_entry.suffix.lower() == ".cbz"
                else chapter_entry
            )
            payload = read_chapter_metadata(chapter_root)
            if not payload:
                continue
            source_id = _payload_str(payload, "source", "id")
            if source_id:
                source_ids.add(source_id)
            title_url = _payload_str(payload, "title", "url")
            if title_url:
                title_urls.add(title_url)
            title_name = _payload_str(payload, "title", "name")
            if title_name:
                title_names.add(title_name)
        return (
            next(iter(source_ids)) if len(source_ids) == 1 else None,
            next(iter(title_urls)) if len(title_urls) == 1 else None,
            next(iter(title_names)) if len(title_names) == 1 else None,
        )

    @staticmethod
    def _read_title_metadata_file(
        title_dir: Path,
    ) -> tuple[str | None, str | None, str | None]:
        payload = read_title_metadata(title_dir)
        if not payload:
            return None, None, None
        return (
            _payload_str(payload, "source", "id"),
            _payload_str(payload, "title", "url"),
            _payload_str(payload, "title", "name"),
        )

    async def _resolve_missing_title_urls(
        self,
        items: list[DownloadExternalTitleResource],
        by_source_url: dict[tuple[str, str], int],
    ) -> None:
        search_cache: dict[tuple[str, str], str | None] = {}

        for item in items:
            source_id = (item.source_id or "").strip()
            if not source_id or item.title_url:
                continue

            resolved_title_url: str | None = None
            for query in self._title_search_queries(item.title):
                cache_key = (source_id, _normalize_text(query))
                if cache_key in search_cache:
                    candidate = search_cache[cache_key]
                else:
                    candidate = None
                    try:
                        found, _ = await tachibridge.search_titles(
                            source_id=source_id,
                            query=query,
                            page=1,
                        )
                        selected = self._pick_search_title_match(query=query, results=found)
                        candidate = selected.url if selected is not None else None
                    except Exception:
                        candidate = None
                    search_cache[cache_key] = candidate

                if candidate:
                    resolved_title_url = candidate
                    break

            if not resolved_title_url:
                continue

            item.title_url = resolved_title_url
            item.importable = True
            item.in_library = (source_id, resolved_title_url) in by_source_url
            item.reason = None

    async def _auto_link_known_external_titles(
        self,
        items: list[DownloadExternalTitleResource],
    ) -> int:
        linked_total = 0
        for item in items:
            if not item.in_library:
                continue

            source_id = (item.source_id or "").strip()
            title_url = (item.title_url or "").strip()
            relative_path = (item.path or "").strip()
            if not source_id or not title_url or not relative_path:
                continue

            variant = (
                await self.session.exec(
                    select(LibraryTitleVariant).where(
                        LibraryTitleVariant.source_id == source_id,
                        LibraryTitleVariant.title_url == title_url,
                    )
                )
            ).first()
            if variant is None:
                continue

            linked = await self._link_downloaded_chapters_for_import(
                library_title_id=int(variant.library_title_id),
                source_id=source_id,
                title_url=title_url,
                relative_title_path=relative_path,
            )
            linked_total += linked

        return linked_total

    @staticmethod
    def _title_search_queries(title: str) -> list[str]:
        base = _strip_leading_index(_strip_hash_suffix(title)).strip()
        variants: list[str] = []
        for candidate in [base, title.strip()]:
            if not candidate:
                continue
            if candidate not in variants:
                variants.append(candidate)
        if " - " in base:
            before_dash = base.split(" - ", 1)[0].strip()
            if before_dash and before_dash not in variants:
                variants.append(before_dash)
        return variants[:3]

    @staticmethod
    def _pick_search_title_match(
        query: str,
        results: list,
    ):
        normalized_query = _normalize_text(query)
        if not normalized_query:
            return None

        valid = []
        for result in results:
            title = (getattr(result, "title", "") or "").strip()
            url = (getattr(result, "url", "") or "").strip()
            if not title or not url:
                continue
            valid.append(result)
        if not valid:
            return None

        exact = next(
            (
                result
                for result in valid
                if _normalize_text(getattr(result, "title", "")) == normalized_query
            ),
            None,
        )
        if exact is not None:
            return exact

        scored: list[tuple[float, object]] = []
        for result in valid:
            normalized_title = _normalize_text(getattr(result, "title", ""))
            if not normalized_title:
                continue
            score = SequenceMatcher(None, normalized_query, normalized_title).ratio()
            if normalized_query in normalized_title or normalized_title in normalized_query:
                score += 0.08
            scored.append((score, result))

        if not scored:
            return None
        scored.sort(key=lambda entry: entry[0], reverse=True)
        best_score, best_result = scored[0]

        if best_score >= 0.92:
            return best_result
        if len(valid) == 1 and best_score >= 0.75:
            return best_result
        return None

    async def _link_downloaded_chapters_for_import(
        self,
        library_title_id: int,
        source_id: str,
        title_url: str,
        relative_title_path: str,
    ) -> int:
        variant = (
            await self.session.exec(
                select(LibraryTitleVariant).where(
                    LibraryTitleVariant.library_title_id == library_title_id,
                    LibraryTitleVariant.source_id == source_id,
                    LibraryTitleVariant.title_url == title_url,
                )
            )
        ).first()
        if variant is None or variant.id is None:
            return 0

        title_dir = self._resolve_download_dir(relative_title_path)
        if title_dir is None or not title_dir.is_dir():
            return 0

        chapter_rows = (
            await self.session.exec(
                select(LibraryChapter).where(
                    LibraryChapter.variant_id == int(variant.id),
                )
            )
        ).all()
        by_chapter_url = {chapter.chapter_url: chapter for chapter in chapter_rows}
        by_chapter_number: dict[str, list[LibraryChapter]] = {}
        for chapter in chapter_rows:
            number = _coerce_positive_float(chapter.chapter_number) or _chapter_number_from_text(
                chapter.name
            )
            key = _chapter_number_key(number)
            if key is not None:
                by_chapter_number.setdefault(key, []).append(chapter)

        root = self._downloads_root()
        now = _now_utc()
        linked = 0
        linked_ids: set[int] = set()
        for chapter_entry in self._iter_chapter_entries(title_dir):
            chapter_dir = (
                chapter_entry.with_suffix("")
                if chapter_entry.is_file() and chapter_entry.suffix.lower() == ".cbz"
                else chapter_entry
            )
            chapter: LibraryChapter | None = None
            chapter_meta = read_chapter_metadata(chapter_dir)
            chapter_url = _payload_str(chapter_meta, "chapter", "url")
            if chapter_url:
                chapter = by_chapter_url.get(chapter_url)

            chapter_number = _payload_str(chapter_meta, "chapter", "number")
            if chapter is None:
                numeric = _coerce_positive_float(chapter_number)
                if numeric is None:
                    numeric = _coerce_positive_float(chapter_dir.name) or _chapter_number_from_text(
                        chapter_dir.name
                    )
            else:
                numeric = None
            if numeric is not None:
                key = _chapter_number_key(numeric)
                if key is not None:
                    matches = by_chapter_number.get(key, [])
                    chapter = matches[0] if len(matches) == 1 else None
            if chapter is None and len(by_chapter_url) == 1:
                chapter = next(iter(by_chapter_url.values()))
            if chapter is None or chapter.id is None or int(chapter.id) in linked_ids:
                continue

            relative_download_path = self._relative_download_path(chapter_dir, preferred_root=root)
            if relative_download_path is None:
                continue

            chapter.is_downloaded = True
            chapter.downloaded_at = now
            chapter.download_error = None
            chapter.download_path = relative_download_path
            chapter.updated_at = now
            self.session.add(chapter)
            linked += 1
            linked_ids.add(int(chapter.id))

        if linked:
            await commit_with_sqlite_retry(self.session)
        return linked

    def _resolve_download_dir(self, relative_path: str | None) -> Path | None:
        raw = (relative_path or "").strip()
        if not raw:
            return None

        normalized = raw.replace("\\", "/").strip()
        absolute_candidate = Path(normalized)
        if absolute_candidate.is_absolute():
            if absolute_candidate.is_dir():
                return absolute_candidate
            if absolute_candidate.is_file():
                if absolute_candidate.suffix.lower() == ".cbz":
                    return absolute_candidate.with_suffix("")
                return absolute_candidate.parent
            if chapter_archive_path(absolute_candidate).is_file():
                return absolute_candidate

        relative_candidates: list[str] = []

        def add_candidate(value: str) -> None:
            candidate = value.strip().strip("/")
            if not candidate:
                return
            if candidate not in relative_candidates:
                relative_candidates.append(candidate)

        add_candidate(normalized)

        parts = [part for part in Path(normalized).parts if part not in {"", "."}]
        for index, part in enumerate(parts):
            if part.lower() == "downloads" and index + 1 < len(parts):
                add_candidate(Path(*parts[index + 1 :]).as_posix())

        if not relative_candidates:
            return None

        roots = [
            self._downloads_root(),
            settings.app.data_dir / "downloads",
            settings.app.config_dir / "downloads",
        ]
        for root in roots:
            resolved_root = root.resolve()
            for relative in relative_candidates:
                candidate = (resolved_root / relative).resolve()
                try:
                    candidate.relative_to(resolved_root)
                except ValueError:
                    continue
                if candidate.is_dir():
                    return candidate
                if candidate.is_file():
                    if candidate.suffix.lower() == ".cbz":
                        return candidate.with_suffix("")
                    return candidate.parent
                if chapter_archive_path(candidate).is_file():
                    return candidate
        return None

    def _relative_download_path(
        self,
        path: Path,
        preferred_root: Path | None = None,
    ) -> str | None:
        candidates: list[Path] = []
        if preferred_root is not None:
            candidates.append(preferred_root)
        for root in [
            self._downloads_root(),
            settings.app.data_dir / "downloads",
            settings.app.config_dir / "downloads",
        ]:
            if root not in candidates:
                candidates.append(root)

        resolved_path = path.resolve()
        for root in candidates:
            resolved_root = root.resolve()
            try:
                return str(resolved_path.relative_to(resolved_root).as_posix())
            except ValueError:
                continue
        return None

    def _chapter_size_from_disk(self, download_path: str | None) -> int:
        chapter_dir = self._resolve_download_dir(download_path)
        if chapter_dir is None:
            return 0
        return chapter_payload_size_bytes(chapter_dir)

    async def _calculate_downloaded_size_stats(
        self,
        title_ids: list[int] | None = None,
    ) -> tuple[int, int, dict[int, tuple[int, int]]]:
        chapter_stmt = select(
            LibraryChapter.id,
            LibraryChapter.library_title_id,
            LibraryChapter.download_path,
        ).where(LibraryChapter.is_downloaded == True)  # noqa: E712
        if title_ids:
            chapter_stmt = chapter_stmt.where(LibraryChapter.library_title_id.in_(title_ids))
        chapter_rows = (await self.session.exec(chapter_stmt)).all()
        if not chapter_rows:
            return 0, 0, {}

        chapter_ids = [int(chapter_id) for chapter_id, _, _ in chapter_rows if chapter_id is not None]
        size_by_chapter_id: dict[int, int] = {}
        if chapter_ids:
            size_rows = (
                await self.session.exec(
                    select(
                        LibraryChapterPage.chapter_id,
                        func.coalesce(func.sum(LibraryChapterPage.local_size), 0),
                    )
                    .where(
                        LibraryChapterPage.chapter_id.in_(chapter_ids),
                        LibraryChapterPage.local_size.is_not(None),
                    )
                    .group_by(LibraryChapterPage.chapter_id)
                )
            ).all()
            size_by_chapter_id = {
                int(chapter_id): int(total_size or 0)
                for chapter_id, total_size in size_rows
                if chapter_id is not None
            }

        total_bytes = 0
        chapters_with_size = 0
        per_title: dict[int, list[int]] = {}
        fallback_size_cache: dict[str, int] = {}
        force_disk_size = bool(settings.downloads.compress_downloaded_chapters)
        for chapter_id, title_id, download_path in chapter_rows:
            if chapter_id is None or title_id is None:
                continue
            chapter_size = 0 if force_disk_size else size_by_chapter_id.get(int(chapter_id), 0)
            if chapter_size <= 0:
                path_key = (download_path or "").strip()
                if path_key:
                    cached_size = fallback_size_cache.get(path_key)
                    if cached_size is None:
                        cached_size = await asyncio.to_thread(
                            self._chapter_size_from_disk, download_path
                        )
                        fallback_size_cache[path_key] = cached_size
                    chapter_size = cached_size
                else:
                    chapter_size = await asyncio.to_thread(
                        self._chapter_size_from_disk, download_path
                    )
            if chapter_size <= 0:
                continue

            total_bytes += chapter_size
            chapters_with_size += 1
            bucket = per_title.setdefault(int(title_id), [0, 0])
            bucket[0] += chapter_size
            bucket[1] += 1

        per_title_stats = {
            title_id: (values[0], values[1]) for title_id, values in per_title.items()
        }
        return total_bytes, chapters_with_size, per_title_stats

    @staticmethod
    def _list_image_files(path: Path) -> list[Path]:
        return list_chapter_image_files(path)

    @staticmethod
    def _compress_chapter_download(chapter_dir: Path) -> bool:
        level = max(0, min(int(settings.downloads.compression_level), 9))
        return compress_chapter_pages(chapter_dir, compression_level=level)

    def _iter_source_dirs(self, root: Path):
        has_standalone_titles = False
        for child in root.iterdir():
            if not child.is_dir() or child.name.startswith("."):
                continue
            if child.name == "sources":
                for legacy_source in child.iterdir():
                    if legacy_source.is_dir() and not legacy_source.name.startswith("."):
                        yield legacy_source
                continue
            if self._looks_like_title_root(child):
                has_standalone_titles = True
                continue
            yield child
        if has_standalone_titles:
            yield root

    @staticmethod
    def _iter_title_dirs(source_dir: Path):
        for child in source_dir.iterdir():
            if not child.is_dir() or child.name.startswith("."):
                continue
            yield child

    @staticmethod
    def _looks_like_title_root(path: Path) -> bool:
        if not path.is_dir():
            return False
        chapters_root = path / "chapters"
        if chapters_root.is_dir():
            return True
        chapter_hint_count = 0
        for child in path.iterdir():
            if child.name.startswith("."):
                continue
            if child.is_file() and child.suffix.lower() == ".cbz":
                return True
            if not child.is_dir():
                continue
            has_subdirs = any(
                grand.is_dir() and not grand.name.startswith(".")
                for grand in child.iterdir()
            )
            has_images = any(
                file_path.is_file() and file_path.suffix.lower() in _IMAGE_SUFFIXES
                for file_path in child.iterdir()
            )
            if has_images:
                return True
            if (not has_subdirs) and _CHAPTER_DIR_HINT_RE.match(child.name):
                chapter_hint_count += 1
        return chapter_hint_count >= 2

    @staticmethod
    def _iter_chapter_entries(title_dir: Path):
        chapters_root = title_dir / "chapters"
        if chapters_root.is_dir():
            base = chapters_root
        else:
            base = title_dir
        for child in base.iterdir():
            if child.name.startswith("."):
                continue
            if child.is_dir():
                yield child
                continue
            if child.is_file() and child.suffix.lower() == ".cbz":
                yield child

    def _count_chapter_entries(self, title_dir: Path) -> int:
        return sum(1 for _ in self._iter_chapter_entries(title_dir))

    async def _requeue_stale_downloading_tasks(self) -> int:
        stale_after_seconds = max(settings.downloads.worker_interval_seconds * 3, 30)
        cutoff = _now_utc() - timedelta(seconds=stale_after_seconds)
        stale_rows = (
            await self.session.exec(
                select(DownloadTask).where(
                    DownloadTask.status == DownloadTaskStatus.DOWNLOADING,
                    DownloadTask.updated_at < cutoff,
                )
            )
        ).all()
        stale = list(stale_rows)
        if not stale:
            return 0

        now = _now_utc()
        for task in stale:
            task.status = DownloadTaskStatus.QUEUED
            task.available_at = now
            task.error = "Recovered stale downloading task"
            task.started_at = None
            task.updated_at = now
            self.session.add(task)
        await commit_with_sqlite_retry(self.session)
        return len(stale)

    async def _claim_next_task(self) -> DownloadTask | None:
        now = _now_utc()
        paused_profile_exists = exists(
            select(DownloadProfile.id).where(
                DownloadProfile.library_title_id == DownloadTask.library_title_id,
                DownloadProfile.paused == True,  # noqa: E712
            )
        )
        task = (
            await self.session.exec(
                select(DownloadTask)
                .where(
                    DownloadTask.status == DownloadTaskStatus.QUEUED,
                    DownloadTask.available_at <= now,
                    ~paused_profile_exists,
                )
                .order_by(DownloadTask.priority, DownloadTask.created_at)
                .limit(1)
            )
        ).first()
        if task is None:
            return None

        task.status = DownloadTaskStatus.DOWNLOADING
        task.started_at = now
        task.updated_at = now
        task.attempts += 1
        task.error = None
        self.session.add(task)
        await commit_with_sqlite_retry(self.session)
        await self.session.refresh(task)
        return task

    async def _process_task(self, task: DownloadTask) -> None:
        _t0 = _time.monotonic()
        now = _now_utc()

        def _log_task(status: str, /, pages: int | None = None, error: str | None = None) -> None:
            _service_logger.bind(
                task_id=task.id,
                attempt_group=task.attempt_group_id,
                attempt=task.attempts,
                chapter_id=task.chapter_id,
                title_id=task.library_title_id,
                source_id=task.source_id,
                trigger=str(task.trigger.value) if task.trigger else None,
                title=task.title_name,
                chapter=task.chapter_name,
                pages=pages,
                error=error,
                duration_ms=round((_time.monotonic() - _t0) * 1000),
                status=status,
            ).log("WARNING" if status in ("failed", "cancelled") else "INFO", "task.done")
            _ws_broadcast({
                "event": "task.done",
                "task_id": int(task.id) if task.id is not None else None,
                "chapter_id": task.chapter_id,
                "title_id": task.library_title_id,
                "status": status,
            })

        chapter = await self.session.get(LibraryChapter, task.chapter_id)
        if chapter is None:
            await self._mark_task_cancelled(task.id, "Chapter no longer exists")
            _log_task("cancelled", error="Chapter no longer exists")
            return

        variant = await self.session.get(LibraryTitleVariant, chapter.variant_id)
        title = await self.session.get(LibraryTitle, chapter.library_title_id)
        if variant is None or title is None:
            await self._mark_task_failed(task.id, "Broken chapter references", final=True)
            _log_task("failed", error="Broken chapter references")
            return

        if await self._is_title_paused(int(title.id)):
            await self._mark_task_requeued(task.id, reason="Paused")
            _log_task("requeued", error="Paused")
            return

        if chapter.is_downloaded:
            await self._mark_task_completed(task.id, output_dir=chapter.download_path)
            _log_task("skipped_already_downloaded")
            return

        output_dir = self._chapter_dir(title=title, variant=variant, chapter=chapter)
        source_url_base = await self._resolve_source_image_base_url(variant.source_id)
        source_request_headers = await self._resolve_source_request_headers(variant.source_id)

        try:
            bridge_chapter_url = resolve_libgroup_chapter_url(chapter.chapter_url)
            preflight_error = await self._preflight_mangalib_chapter_pages_unavailable(
                source_id=variant.source_id,
                chapter_url=bridge_chapter_url,
            )
            if preflight_error:
                raise RuntimeError(preflight_error)
            try:
                pages = await tachibridge.fetch_chapter_pages(
                    source_id=variant.source_id,
                    chapter_url=bridge_chapter_url,
                )
            except BridgeAPIError as exc:
                normalized = await self._normalize_mangalib_pages_error(
                    source_id=variant.source_id,
                    chapter_url=bridge_chapter_url,
                    error_text=str(exc),
                )
                if normalized:
                    raise RuntimeError(normalized) from exc
                raise
            if not pages:
                raise RuntimeError("Chapter has no pages")

            await self._sync_pages(chapter_id=int(chapter.id), pages=pages)

            root = self._downloads_root()
            await asyncio.to_thread(output_dir.mkdir, parents=True, exist_ok=True)

            existing_pages = (
                await self.session.exec(
                    select(LibraryChapterPage)
                    .where(LibraryChapterPage.chapter_id == int(chapter.id))
                    .order_by(LibraryChapterPage.page_index)
                )
            ).all()
            page_by_index = {page.page_index: page for page in existing_pages}

            timeout = httpx.Timeout(settings.downloads.request_timeout_seconds)
            async with httpx.AsyncClient(timeout=timeout, follow_redirects=True) as client:
                total_pages = len(pages)
                downloaded_pages = 0

                for page in pages:
                    remote_url = self._resolve_remote_page_url(
                        image_url=page.image_url,
                        page_url=page.url,
                        chapter_url=chapter.chapter_url,
                    )
                    remote_url = self._prefer_source_page_image_path(
                        remote_url=remote_url,
                        page_url=page.url,
                        source_url_base=source_url_base,
                    )
                    remote_url = self._resolve_source_relative_url(
                        remote_url=remote_url,
                        source_url_base=source_url_base,
                    )
                    if not remote_url:
                        raise RuntimeError(
                            f"Empty page URL for chapter {chapter.id}, page {page.index}"
                        )
                    ext = _extension_from_url(remote_url) or ".jpg"
                    file_path = output_dir / f"{page.index:04d}{ext}"
                    content_type, file_size = await self._download_with_retries(
                        client=client,
                        url=remote_url,
                        output_path=file_path,
                        request_headers=source_request_headers,
                    )

                    if content_type:
                        inferred_ext = _extension_from_content_type(content_type)
                        if inferred_ext and inferred_ext != file_path.suffix.lower():
                            renamed = file_path.with_suffix(inferred_ext)
                            await asyncio.to_thread(file_path.rename, renamed)
                            file_path = renamed

                    model = page_by_index.get(page.index)
                    if model is not None:
                        model.local_path = str(file_path.relative_to(root).as_posix())
                        model.local_size = file_size
                        model.fetched_at = now
                        self.session.add(model)

                    downloaded_pages += 1
                    task.total_pages = total_pages
                    task.downloaded_pages = downloaded_pages
                    task.output_dir = str(output_dir.relative_to(root).as_posix())
                    task.updated_at = _now_utc()
                    self.session.add(task)
                    await commit_with_sqlite_retry(self.session)

            chapter.is_downloaded = True
            chapter.downloaded_at = _now_utc()
            chapter.download_path = str(output_dir.relative_to(self._downloads_root()).as_posix())
            chapter.download_error = None
            chapter.updated_at = _now_utc()
            self.session.add(chapter)

            try:
                await asyncio.to_thread(
                    self._write_chapter_metadata_file,
                    chapter_dir=output_dir,
                    title=title,
                    variant=variant,
                    chapter=chapter,
                    page_count=downloaded_pages,
                )
            except Exception:
                _service_logger.warning(
                    "Unable to write chapter metadata for chapter_id={}",
                    chapter.id,
                )

            if settings.downloads.compress_downloaded_chapters:
                try:
                    await asyncio.to_thread(
                        self._compress_chapter_download,
                        output_dir,
                    )
                except Exception:
                    _service_logger.warning(
                        "Unable to compress downloaded chapter_id={} at '{}'",
                        chapter.id,
                        output_dir,
                    )

            await self._mark_task_completed(task.id, output_dir=chapter.download_path)
            _log_task("completed", pages=downloaded_pages)
        except Exception as exc:
            chapter.is_downloaded = False
            chapter.download_error = _short_error(exc)
            chapter.updated_at = _now_utc()
            self.session.add(chapter)

            final = task.attempts >= task.max_attempts
            if "unavailable in MangaLib API" in (chapter.download_error or ""):
                final = True
            await self._mark_task_failed(task.id, chapter.download_error, final=final)
            _log_task("failed", error=chapter.download_error)

    async def _download_with_retries(
        self,
        client: httpx.AsyncClient,
        url: str,
        output_path: Path,
        request_headers: dict[str, str] | None = None,
    ) -> tuple[str | None, int]:
        retries = max(settings.downloads.page_retry_count, 0)
        last_exc: Exception | None = None

        for attempt in range(retries + 1):
            tmp_path = output_path.with_suffix(f"{output_path.suffix}.part")
            request_timeout = settings.downloads.request_timeout_seconds + (attempt * 10)
            try:
                async with client.stream(
                    "GET",
                    url,
                    timeout=request_timeout,
                    headers=request_headers,
                ) as response:
                    response.raise_for_status()
                    content_type = response.headers.get("content-type")
                    bytes_written = 0
                    with tmp_path.open("wb") as handle:
                        async for chunk in response.aiter_bytes(chunk_size=128 * 1024):
                            if not chunk:
                                continue
                            handle.write(chunk)
                            bytes_written += len(chunk)

                await asyncio.to_thread(tmp_path.replace, output_path)
                return content_type, bytes_written
            except Exception as exc:
                last_exc = exc
                if tmp_path.exists():
                    await asyncio.to_thread(tmp_path.unlink)
                if attempt < retries:
                    wait_seconds = min(90.0, 3.0 * (2**attempt))
                    await asyncio.sleep(wait_seconds)

        assert last_exc is not None
        raise last_exc

    async def _mark_task_completed(self, task_id: int | None, output_dir: str | None) -> None:
        if task_id is None:
            return

        task = await self.session.get(DownloadTask, task_id)
        if task is None:
            return

        now = _now_utc()
        task.status = DownloadTaskStatus.COMPLETED
        task.finished_at = now
        task.updated_at = now
        task.error = None
        task.output_dir = output_dir
        self.session.add(task)
        await commit_with_sqlite_retry(self.session)

    async def _mark_task_failed(self, task_id: int | None, error: str, final: bool) -> None:
        if task_id is None:
            return

        task = await self.session.get(DownloadTask, task_id)
        if task is None:
            return

        now = _now_utc()
        task.status = DownloadTaskStatus.FAILED
        task.error = error
        task.finished_at = now
        task.updated_at = now

        self.session.add(task)
        if not final:
            backoff = max(
                0,
                int(settings.downloads.failed_chapter_retry_delay_seconds),
            )
            queued_retry = self._spawn_retry_task(
                task=task,
                available_at=now + timedelta(seconds=backoff),
                trigger=task.trigger,
                attempts_seed=max(task.attempts, 0),
                error=None,
            )
            await self._finalize_new_task(queued_retry)
        await commit_with_sqlite_retry(self.session)

    def _spawn_retry_task(
        self,
        task: DownloadTask,
        available_at: datetime,
        trigger: DownloadTrigger,
        attempts_seed: int,
        error: str | None,
    ) -> DownloadTask:
        group_id = (
            int(task.attempt_group_id)
            if task.attempt_group_id is not None
            else (int(task.id) if task.id is not None else None)
        )
        retry_of = int(task.id) if task.id is not None else None
        return self._build_queued_task(
            library_title_id=task.library_title_id,
            variant_id=task.variant_id,
            chapter_id=task.chapter_id,
            source_id=task.source_id,
            chapter_url=task.chapter_url,
            title_name=task.title_name,
            chapter_name=task.chapter_name,
            trigger=trigger,
            priority=task.priority,
            max_attempts=task.max_attempts,
            available_at=available_at,
            attempts=max(0, attempts_seed),
            attempt_group_id=group_id,
            retry_of_task_id=retry_of,
            error=error,
        )

    def _build_queued_task(
        self,
        *,
        library_title_id: int,
        variant_id: int | None,
        chapter_id: int,
        source_id: str,
        chapter_url: str,
        title_name: str,
        chapter_name: str,
        trigger: DownloadTrigger,
        priority: int,
        max_attempts: int,
        available_at: datetime,
        attempts: int = 0,
        attempt_group_id: int | None = None,
        retry_of_task_id: int | None = None,
        error: str | None = None,
    ) -> DownloadTask:
        now = _now_utc()
        return DownloadTask(
            library_title_id=library_title_id,
            variant_id=variant_id,
            chapter_id=chapter_id,
            source_id=source_id,
            chapter_url=chapter_url,
            title_name=title_name,
            chapter_name=chapter_name,
            attempt_group_id=attempt_group_id,
            retry_of_task_id=retry_of_task_id,
            status=DownloadTaskStatus.QUEUED,
            trigger=trigger,
            priority=priority,
            attempts=max(0, attempts),
            max_attempts=max_attempts,
            available_at=available_at,
            downloaded_pages=0,
            total_pages=0,
            output_dir=None,
            error=error,
            started_at=None,
            finished_at=None,
            created_at=now,
            updated_at=now,
        )

    async def _finalize_new_task(self, task: DownloadTask) -> None:
        self.session.add(task)
        await self.session.flush()
        if task.id is None:
            return
        if task.attempt_group_id is None:
            task.attempt_group_id = int(task.id)
            self.session.add(task)
            await self.session.flush()

    async def _mark_task_cancelled(self, task_id: int | None, reason: str) -> None:
        if task_id is None:
            return

        task = await self.session.get(DownloadTask, task_id)
        if task is None:
            return

        now = _now_utc()
        task.status = DownloadTaskStatus.CANCELLED
        task.error = reason
        task.finished_at = now
        task.updated_at = now
        self.session.add(task)
        await commit_with_sqlite_retry(self.session)

    async def _mark_task_requeued(self, task_id: int | None, reason: str | None = None) -> None:
        if task_id is None:
            return

        task = await self.session.get(DownloadTask, task_id)
        if task is None:
            return

        now = _now_utc()
        task.status = DownloadTaskStatus.QUEUED
        task.available_at = now
        task.started_at = None
        task.finished_at = None
        task.updated_at = now
        if reason:
            task.error = reason
        self.session.add(task)
        await commit_with_sqlite_retry(self.session)

    async def _is_title_paused(self, title_id: int) -> bool:
        profile = (
            await self.session.exec(
                select(DownloadProfile.paused).where(
                    DownloadProfile.library_title_id == title_id
                )
            )
        ).first()
        return bool(profile)

    async def _sync_variant_and_collect_new(
        self,
        title: LibraryTitle,
        variant: LibraryTitleVariant,
    ) -> list[int]:
        details = await tachibridge.fetch_title_details(
            source_id=variant.source_id,
            title_url=variant.title_url,
        )
        chapters = await tachibridge.fetch_title_chapters(
            source_id=variant.source_id,
            title_url=variant.title_url,
        )

        now = _now_utc()
        title.title = details.title or title.title
        title.thumbnail_url = details.thumbnail_url or title.thumbnail_url
        title.description = details.description or title.description
        title.artist = details.artist or title.artist
        title.author = details.author or title.author
        title.genre = details.genre or title.genre
        title.status = int(getattr(details.status, "value", details.status))
        title.updated_at = now
        title.last_refreshed_at = now

        variant.title = details.title
        variant.thumbnail_url = details.thumbnail_url or ""
        variant.description = details.description
        variant.artist = details.artist
        variant.author = details.author
        variant.genre = details.genre
        variant.status = int(getattr(details.status, "value", details.status))
        variant.updated_at = now
        variant.last_synced_at = now

        self.session.add(title)
        self.session.add(variant)

        new_chapter_ids = await self._sync_variant_chapters(
            library_title_id=int(title.id),
            variant_id=int(variant.id),
            chapters=chapters,
            now=now,
        )
        await commit_with_sqlite_retry(self.session)
        return new_chapter_ids

    async def _sync_variant_chapters(
        self,
        library_title_id: int,
        variant_id: int,
        chapters: list[SourceChapter],
        now: datetime,
    ) -> list[int]:
        existing_rows = (
            await self.session.exec(
                select(LibraryChapter).where(LibraryChapter.variant_id == variant_id)
            )
        ).all()
        existing = list(existing_rows)
        by_url = {chapter.chapter_url: chapter for chapter in existing}
        seen_urls: set[str] = set()
        new_models: list[LibraryChapter] = []

        for position, chapter in enumerate(chapters, start=1):
            model = by_url.get(chapter.url)
            if model is None:
                model = LibraryChapter(
                    library_title_id=library_title_id,
                    variant_id=variant_id,
                    chapter_url=chapter.url,
                    name=chapter.name,
                    chapter_number=chapter.chapter_number,
                    scanlator=chapter.scanlator,
                    date_upload=chapter.date_upload,
                    position=position,
                    is_read=False,
                    is_downloaded=False,
                    created_at=now,
                    updated_at=now,
                    last_synced_at=now,
                )
                new_models.append(model)
            else:
                model.name = chapter.name
                model.chapter_number = chapter.chapter_number
                model.scanlator = chapter.scanlator
                model.date_upload = chapter.date_upload
                model.position = position
                model.updated_at = now
                model.last_synced_at = now

            self.session.add(model)
            seen_urls.add(chapter.url)

        stale_ids = [
            int(chapter.id)
            for chapter in existing
            if chapter.chapter_url not in seen_urls and chapter.id is not None
        ]
        if stale_ids:
            stale_paths = [
                chapter.download_path
                for chapter in existing
                if chapter.id is not None
                and int(chapter.id) in stale_ids
                and chapter.download_path
            ]
            await self.session.exec(
                delete(LibraryChapterPage).where(LibraryChapterPage.chapter_id.in_(stale_ids))
            )
            await self.session.exec(
                delete(DownloadTask).where(DownloadTask.chapter_id.in_(stale_ids))
            )
            await self.session.exec(
                delete(LibraryChapter).where(LibraryChapter.id.in_(stale_ids))
            )
            for stale_path in stale_paths:
                folder = self._downloads_root() / stale_path
                if folder.exists():
                    await asyncio.to_thread(shutil.rmtree, folder, ignore_errors=True)

        await self.session.flush()
        return [int(chapter.id) for chapter in new_models if chapter.id is not None]

    async def _sync_pages(self, chapter_id: int, pages) -> None:
        existing_rows = (
            await self.session.exec(
                select(LibraryChapterPage).where(LibraryChapterPage.chapter_id == chapter_id)
            )
        ).all()
        existing_by_index = {page.page_index: page for page in existing_rows}
        seen_indexes: set[int] = set()

        now = _now_utc()
        for page in pages:
            model = existing_by_index.get(page.index)
            if model is None:
                model = LibraryChapterPage(chapter_id=chapter_id, page_index=page.index)

            model.url = page.url
            model.image_url = page.image_url
            model.fetched_at = now
            self.session.add(model)
            seen_indexes.add(page.index)

        stale_indexes = [
            page.page_index for page in existing_rows if page.page_index not in seen_indexes
        ]
        if stale_indexes:
            await self.session.exec(
                delete(LibraryChapterPage).where(
                    LibraryChapterPage.chapter_id == chapter_id,
                    LibraryChapterPage.page_index.in_(stale_indexes),
                )
            )

        await self.session.flush()

    async def _chapters_for_profile(
        self,
        variant_id: int,
        new_chapter_ids: list[int],
        profile: DownloadProfile,
        first_check: bool = False,
        seed_existing: bool = False,
    ) -> list[int]:
        if profile.strategy == DownloadStrategy.NEW_ONLY:
            if (first_check or seed_existing) and not new_chapter_ids:
                stmt = select(LibraryChapter).where(
                    LibraryChapter.variant_id == variant_id,
                    LibraryChapter.is_read == False,  # noqa: E712
                    LibraryChapter.is_downloaded == False,  # noqa: E712
                )
            else:
                if not new_chapter_ids:
                    return []

                stmt = select(LibraryChapter).where(LibraryChapter.id.in_(new_chapter_ids))
        else:
            stmt = select(LibraryChapter).where(
                LibraryChapter.variant_id == variant_id,
                LibraryChapter.is_read == False,  # noqa: E712
                LibraryChapter.is_downloaded == False,  # noqa: E712
            )

        chapters = (
            await self.session.exec(
                stmt.order_by(*self._chapter_order_oldest_first())
            )
        ).all()

        selected: list[int] = []
        cutoff = profile.start_from
        if cutoff is not None and cutoff.tzinfo is None:
            cutoff = cutoff.replace(tzinfo=timezone.utc)
        for chapter in chapters:
            if cutoff is not None and chapter.date_upload is not None:
                upload = chapter.date_upload
                if upload.tzinfo is None:
                    upload = upload.replace(tzinfo=timezone.utc)
                if upload < cutoff:
                    continue
            if chapter.id is not None:
                selected.append(int(chapter.id))
        return selected

    @staticmethod
    def _resolve_remote_page_url(
        image_url: str | None,
        page_url: str | None,
        chapter_url: str | None = None,
    ) -> str:
        image_candidate = (image_url or "").strip()
        page_candidate = (page_url or "").strip()
        chapter_candidate = (chapter_url or "").strip()

        if not image_candidate:
            parsed_page = DownloadService._sanitize_comma_encoded_url(page_candidate)
            if parsed_page:
                return parsed_page
            return page_candidate or chapter_candidate

        parsed_image = DownloadService._sanitize_comma_encoded_url(image_candidate)
        if parsed_image:
            return parsed_image

        parsed = urlparse(image_candidate)
        if parsed.scheme or image_candidate.startswith("//"):
            return image_candidate

        page_base = DownloadService._extract_base_url(page_candidate)
        if page_base:
            return urljoin(page_base, image_candidate)

        chapter_base = DownloadService._extract_base_url(chapter_candidate)
        if chapter_base:
            return urljoin(chapter_base, image_candidate)

        return image_candidate

    async def _resolve_source_image_base_url(self, source_id: str | None) -> str | None:
        if not source_id:
            return None
        if source_id in self._source_image_base_cache:
            return self._source_image_base_cache[source_id]

        resolved: str | None = None
        try:
            prefs = await ExtensionService(self.session).list_source_preferences(source_id)
            pref_by_key = {pref.key: pref.current_value for pref in prefs.preferences}
            site_id = self._infer_mangalib_site_id(
                source_name=prefs.name,
                preferences=prefs.preferences,
            )
            preferred_bases = self._extract_url_preference_bases(prefs.preferences)
            if preferred_bases:
                resolved = preferred_bases[0]
            if "MangaLibImageServer" in pref_by_key:
                image_server = str(pref_by_key.get("MangaLibImageServer") or "compress").strip()
                if not image_server:
                    image_server = "compress"
                api_domain = str(pref_by_key.get("MangaLibApiDomain") or "https://api.cdnlibs.org").strip()
                if not api_domain:
                    api_domain = "https://api.cdnlibs.org"
                mangalib_base = await self._fetch_mangalib_image_server_url(
                    api_domain=api_domain,
                    image_server=image_server,
                    site_id=site_id,
                )
                if mangalib_base:
                    resolved = mangalib_base
        except Exception:
            resolved = None

        if resolved:
            resolved = resolved.strip().rstrip("/") or None
        self._source_image_base_cache[source_id] = resolved
        return resolved

    async def _resolve_source_request_headers(
        self,
        source_id: str | None,
    ) -> dict[str, str] | None:
        if not source_id:
            return None
        if source_id in self._source_request_headers_cache:
            return self._source_request_headers_cache[source_id]

        resolved: dict[str, str] | None = None
        try:
            prefs = await ExtensionService(self.session).list_source_preferences(source_id)
            pref_by_key = {pref.key: pref.current_value for pref in prefs.preferences}

            referer_candidate = ""
            for pref in prefs.preferences:
                key = (pref.key or "").strip().lower()
                if key in {"домен", "domain"}:
                    referer_candidate = str(pref.current_value or pref.default_value or "").strip()
                    if referer_candidate:
                        break

            if not referer_candidate:
                referer_candidate = str(pref_by_key.get("MangaLibApiDomain") or "").strip()

            if not referer_candidate:
                bases = self._extract_url_preference_bases(prefs.preferences)
                if bases:
                    referer_candidate = bases[0]

            parsed = urlparse(referer_candidate)
            if parsed.scheme and parsed.netloc:
                origin = f"{parsed.scheme}://{parsed.netloc}"
                resolved = {
                    "Referer": f"{origin}/",
                    "Origin": origin,
                    "Accept": "image/avif,image/webp,image/*,*/*;q=0.8",
                }
        except Exception:
            resolved = None

        self._source_request_headers_cache[source_id] = resolved
        return resolved

    async def _preflight_mangalib_chapter_pages_unavailable(
        self,
        source_id: str | None,
        chapter_url: str | None,
    ) -> str | None:
        if not source_id or not chapter_url:
            return None

        try:
            prefs = await ExtensionService(self.session).list_source_preferences(source_id)
        except Exception:
            return None

        pref_by_key = {pref.key: pref.current_value for pref in prefs.preferences}
        if "MangaLibApiDomain" not in pref_by_key and "MangaLibImageServer" not in pref_by_key:
            return None

        api_domain = str(pref_by_key.get("MangaLibApiDomain") or "https://api.cdnlibs.org").strip()
        if not api_domain:
            api_domain = "https://api.cdnlibs.org"
        endpoint = f"{api_domain.rstrip('/')}/api/manga{chapter_url}"

        try:
            timeout = httpx.Timeout(15.0)
            async with httpx.AsyncClient(timeout=timeout, follow_redirects=True) as client:
                response = await client.get(endpoint)
                response.raise_for_status()
        except Exception:
            return None

        payload = response.json()
        data = payload.get("data")
        if not isinstance(data, dict):
            return None

        pages = data.get("pages")
        if isinstance(pages, list) and pages:
            return None

        expired_at = str(data.get("expired_at") or "").strip()
        expired_type = data.get("expired_type")
        if expired_at:
            return f"Chapter pages are unavailable in MangaLib API (locked until {expired_at})"
        if expired_type == 1:
            return "Chapter pages are unavailable in MangaLib API (chapter is time-locked)"
        return "Chapter pages are unavailable in MangaLib API"

    async def _normalize_mangalib_pages_error(
        self,
        source_id: str | None,
        chapter_url: str | None,
        error_text: str | None,
    ) -> str | None:
        source_key = (source_id or "").lower()
        if "mangalib" not in source_key:
            return None

        text = (error_text or "").lower()
        looks_like_unavailable = (
            "missingfieldexception" in text
            or "libgroup.pages" in text
            or "path: $.data" in text
            or "fetch_chapter_pages failed (unknown)" in text
        )
        if not looks_like_unavailable:
            return None

        preflight_error = await self._preflight_mangalib_chapter_pages_unavailable(
            source_id=source_id,
            chapter_url=chapter_url,
        )
        return preflight_error or "Chapter pages are unavailable in MangaLib API"

    @staticmethod
    def _extract_url_preference_bases(preferences: list[SourcePreference]) -> list[str]:
        bases: list[str] = []
        seen: set[str] = set()

        def push(value: object | None) -> None:
            if value is None:
                return
            if isinstance(value, list | tuple | set):
                for item in value:
                    push(item)
                return

            candidate = str(value).strip()
            parsed = urlparse(candidate)
            if not (parsed.scheme and parsed.netloc):
                return
            base = f"{parsed.scheme}://{parsed.netloc}"
            if base in seen:
                return
            seen.add(base)
            bases.append(base)

        for pref in preferences:
            push(pref.current_value)
            push(pref.default_value)

            selected_indexes: list[int] = []
            if pref.entry_values:
                if isinstance(pref.current_value, list):
                    selected_values = {str(value) for value in pref.current_value}
                    for idx, entry_value in enumerate(pref.entry_values):
                        if str(entry_value) in selected_values:
                            selected_indexes.append(idx)
                else:
                    selected_value = str(pref.current_value or "")
                    for idx, entry_value in enumerate(pref.entry_values):
                        if str(entry_value) == selected_value:
                            selected_indexes.append(idx)
            elif isinstance(pref.current_value, int | float):
                selected_indexes.append(int(pref.current_value))

            for idx in selected_indexes:
                if pref.entry_values and 0 <= idx < len(pref.entry_values):
                    push(pref.entry_values[idx])
                if pref.entries and 0 <= idx < len(pref.entries):
                    push(pref.entries[idx])

        return bases

    @staticmethod
    async def _fetch_mangalib_image_server_url(
        *,
        api_domain: str,
        image_server: str,
        site_id: int | None = None,
    ) -> str | None:
        api_base = api_domain.rstrip("/")
        constants_url = f"{api_base}/api/constants"
        try:
            timeout = httpx.Timeout(10.0)
            async with httpx.AsyncClient(timeout=timeout, follow_redirects=True) as client:
                response = await client.get(
                    constants_url,
                    params=[("fields[]", "imageServers")],
                )
                response.raise_for_status()
        except Exception:
            return None

        payload = response.json()
        servers = payload.get("data", {}).get("imageServers", [])
        if not isinstance(servers, list):
            return None

        normalized_server = image_server.strip().lower()
        fallback_match: str | None = None
        for entry in servers:
            if not isinstance(entry, dict):
                continue
            raw_url = str(entry.get("url") or "").strip()
            if not raw_url:
                continue
            parsed = urlparse(raw_url)
            if not (parsed.scheme and parsed.netloc):
                continue
            entry_id = str(entry.get("id") or "").strip().lower()
            if entry_id != normalized_server:
                continue

            resolved_base = f"{parsed.scheme}://{parsed.netloc}"
            site_ids = entry.get("site_ids")
            if (
                site_id is not None
                and isinstance(site_ids, list)
                and any(
                    str(item).strip().isdigit() and int(str(item).strip()) == site_id
                    for item in site_ids
                    if isinstance(item, int | str)
                )
            ):
                return resolved_base
            if fallback_match is None:
                fallback_match = resolved_base
        return fallback_match

    @staticmethod
    def _infer_mangalib_site_id(
        source_name: str | None,
        preferences: list[SourcePreference],
    ) -> int | None:
        name = (source_name or "").strip().lower()
        if "hentai" in name:
            return 4
        if "yaoi" in name:
            return 3
        if "manga" in name:
            return 1

        domain_value = ""
        for pref in preferences:
            key = (pref.key or "").strip().lower()
            if key == "домен":
                domain_value = str(pref.current_value or pref.default_value or "").strip().lower()
                break

        if "hentai" in domain_value:
            return 4
        if "slashlib" in domain_value or "yaoi" in domain_value:
            return 3
        if "mangalib" in domain_value:
            return 1
        return None

    @staticmethod
    def _resolve_source_relative_url(
        remote_url: str,
        source_url_base: str | None,
    ) -> str:
        if not remote_url or not source_url_base:
            return remote_url
        if remote_url.startswith("//"):
            parsed = urlparse(f"https:{remote_url}")
            host = parsed.netloc.strip().lower()
            if host and ("." in host or ":" in host):
                return remote_url
            return urljoin(
                source_url_base.rstrip("/") + "/",
                "/" + remote_url.lstrip("/"),
            )
        if remote_url.startswith("/"):
            return urljoin(source_url_base.rstrip("/") + "/", remote_url)
        return remote_url

    @staticmethod
    def _prefer_source_page_image_path(
        remote_url: str,
        page_url: str | None,
        source_url_base: str | None,
    ) -> str:
        if not source_url_base:
            return remote_url

        candidate = DownloadService._sanitize_comma_encoded_url((page_url or "").strip()) or (page_url or "").strip()
        if not candidate:
            return remote_url

        parsed_remote = urlparse(remote_url)
        remote_is_absolute = bool(parsed_remote.scheme and parsed_remote.netloc)
        if remote_is_absolute and (candidate.startswith("/") or candidate.startswith("//")):
            return remote_url

        parsed = urlparse(f"https:{candidate}" if candidate.startswith("//") else candidate)
        path = (parsed.path or "").lower()
        if path and any(path.endswith(suffix) for suffix in _IMAGE_SUFFIXES):
            return candidate
        return remote_url

    @staticmethod
    def _sanitize_comma_encoded_url(value: str) -> str | None:
        candidate = value.strip()
        if not candidate or "," not in candidate:
            return None

        parts = [part.strip() for part in candidate.split(",") if part.strip()]
        if not parts:
            return None

        absolute_parts: list[str] = []
        path_parts: list[str] = []
        for part in parts:
            parsed_part = urlparse(part)
            if parsed_part.scheme and parsed_part.netloc:
                absolute_parts.append(part)
                continue
            if parsed_part.scheme and parsed_part.path:
                path_parts.append(f"/{parsed_part.path.lstrip('/')}")
                continue
            if not parsed_part.scheme:
                normalized_part = part
                if normalized_part.startswith("https/") or normalized_part.startswith("http/"):
                    normalized_part = normalized_part.split("/", 1)[1] if "/" in normalized_part else ""
                path_parts.append(
                    normalized_part
                    if normalized_part.startswith("/")
                    else f"/{normalized_part.lstrip('/')}"
                )

        if len(absolute_parts) >= 2:
            return absolute_parts[-1]

        base = DownloadService._extract_base_url(candidate)
        if not base:
            return absolute_parts[0] if absolute_parts else None

        if path_parts:
            parsed_base = urlparse(base)
            base_origin = (
                f"{parsed_base.scheme}://{parsed_base.netloc}"
                if parsed_base.scheme and parsed_base.netloc
                else base
            )
            return urljoin(base_origin, path_parts[-1])

        return base

    @staticmethod
    def _extract_base_url(value: str) -> str | None:
        candidate = value.strip()
        if not candidate:
            return None

        for piece in [part.strip() for part in candidate.split(",") if part.strip()]:
            parsed_piece = urlparse(piece)
            if parsed_piece.scheme and parsed_piece.netloc:
                return urljoin(
                    f"{parsed_piece.scheme}://{parsed_piece.netloc}",
                    parsed_piece.path or "/",
                )

        parsed = urlparse(candidate)
        if parsed.scheme and parsed.netloc:
            host = parsed.netloc.split(",", 1)[0].strip()
            if host:
                return urljoin(f"{parsed.scheme}://{host}", parsed.path or "/")

        return None

    async def _enqueue_chapter_if_needed(
        self,
        chapter_id: int,
        trigger: DownloadTrigger,
        priority: int,
        attempt_group_id: int | None = None,
    ) -> tuple[DownloadTask, bool]:
        async with self._enqueue_lock:
            chapter = await self.session.get(LibraryChapter, chapter_id)
            if chapter is None:
                raise BridgeAPIError(404, f"Library chapter not found: {chapter_id}")
            if chapter.is_downloaded:
                raise BridgeAPIError(409, f"Chapter already downloaded: {chapter_id}")

            existing = (
                await self.session.exec(
                    select(DownloadTask)
                    .where(
                        DownloadTask.chapter_id == chapter_id,
                        DownloadTask.status.in_(
                            [DownloadTaskStatus.QUEUED, DownloadTaskStatus.DOWNLOADING]
                        ),
                    )
                    .limit(1)
                )
            ).first()
            if existing is not None:
                return existing, False

            variant = await self.session.get(LibraryTitleVariant, chapter.variant_id)
            title = await self.session.get(LibraryTitle, chapter.library_title_id)
            if variant is None or title is None:
                raise BridgeAPIError(500, f"Broken chapter references: {chapter_id}")

            task = self._build_queued_task(
                library_title_id=int(title.id),
                variant_id=int(variant.id),
                chapter_id=chapter_id,
                source_id=variant.source_id,
                chapter_url=chapter.chapter_url,
                title_name=variant.title or title.title,
                chapter_name=chapter.name,
                trigger=trigger,
                priority=priority,
                max_attempts=settings.downloads.max_attempts,
                available_at=_now_utc(),
                attempt_group_id=attempt_group_id,
            )
            await self._finalize_new_task(task)
            return task, True

    async def _resolve_variant(
        self,
        title_id: int,
        preferred_variant_id: int | None,
    ) -> LibraryTitleVariant:
        if preferred_variant_id is not None:
            preferred = await self.session.get(LibraryTitleVariant, preferred_variant_id)
            if preferred is not None and preferred.library_title_id == title_id:
                return preferred

        variant = (
            await self.session.exec(
                select(LibraryTitleVariant)
                .where(LibraryTitleVariant.library_title_id == title_id)
                .order_by(desc(LibraryTitleVariant.last_synced_at), LibraryTitleVariant.id)
                .limit(1)
            )
        ).first()
        if variant is None:
            raise BridgeAPIError(404, f"Library title has no source variants: {title_id}")
        return variant

    async def _profile_variant_ids(self, profile: DownloadProfile | None) -> list[int]:
        if profile is None:
            return []
        if profile.id is not None:
            rows = (
                await self.session.exec(
                    select(DownloadProfileVariant.variant_id)
                    .where(DownloadProfileVariant.profile_id == int(profile.id))
                    .order_by(DownloadProfileVariant.position, DownloadProfileVariant.id)
                )
            ).all()
            normalized = normalize_positive_int_ids(rows)
            if normalized:
                return normalized
        return parse_selected_variant_ids(
            profile.variant_ids_json,
            profile.preferred_variant_id,
        )

    async def _set_profile_variant_ids(
        self,
        profile: DownloadProfile,
        variant_ids: list[int],
    ) -> None:
        unique_ids = DownloadService._normalize_positive_int_ids(variant_ids)
        profile.variant_ids_json = serialize_selected_variant_ids(unique_ids)
        profile.preferred_variant_id = unique_ids[0] if unique_ids else None
        self.session.add(profile)
        await self.session.flush()
        if profile.id is None:
            return

        await self.session.exec(
            delete(DownloadProfileVariant).where(
                DownloadProfileVariant.profile_id == int(profile.id)
            )
        )
        for position, variant_id in enumerate(unique_ids):
            self.session.add(
                DownloadProfileVariant(
                    profile_id=int(profile.id),
                    variant_id=variant_id,
                    position=position,
                    created_at=_now_utc(),
                )
            )

    @staticmethod
    def _normalize_positive_int_ids(values: list[object]) -> list[int]:
        return normalize_positive_int_ids(values)

    async def _normalize_profile_variant_ids(
        self,
        title_id: int,
        variant_ids: list[int],
    ) -> list[int]:
        unique_ids = self._normalize_positive_int_ids(variant_ids)
        if not unique_ids:
            return []
        rows = (
            await self.session.exec(
                select(LibraryTitleVariant.id).where(
                    LibraryTitleVariant.library_title_id == title_id,
                    LibraryTitleVariant.id.in_(unique_ids),
                )
            )
        ).all()
        allowed_ids = {int(item) for item in rows}
        return [item for item in unique_ids if item in allowed_ids]

    async def _resolve_profile_variants(
        self,
        title_id: int,
        profile: DownloadProfile,
    ) -> list[LibraryTitleVariant]:
        selected_ids = await self._normalize_profile_variant_ids(
            title_id=title_id,
            variant_ids=await self._profile_variant_ids(profile),
        )
        if selected_ids:
            rows = (
                await self.session.exec(
                    select(LibraryTitleVariant).where(
                        LibraryTitleVariant.library_title_id == title_id,
                        LibraryTitleVariant.id.in_(selected_ids),
                    )
                )
            ).all()
            by_id = {int(variant.id): variant for variant in rows if variant.id is not None}
            ordered = [by_id[item] for item in selected_ids if item in by_id]
            if ordered:
                if selected_ids != await self._profile_variant_ids(profile):
                    await self._set_profile_variant_ids(
                        profile, [int(variant.id) for variant in ordered if variant.id is not None]
                    )
                return ordered

        fallback = await self._resolve_variant(
            title_id=title_id,
            preferred_variant_id=profile.preferred_variant_id,
        )
        if fallback.id is None:
            raise BridgeAPIError(500, "Resolved fallback variant is missing id")
        await self._set_profile_variant_ids(profile, [int(fallback.id)])
        return [fallback]

    async def _get_or_create_profile(self, title_id: int) -> DownloadProfile:
        profile = (
            await self.session.exec(
                select(DownloadProfile).where(DownloadProfile.library_title_id == title_id)
            )
        ).first()
        if profile is not None:
            return profile

        now = _now_utc()
        variant = await self._resolve_variant(title_id=title_id, preferred_variant_id=None)
        # Avoid duplicate-profile races when monitor/worker and UI updates overlap.
        await self.session.exec(
            insert(DownloadProfile)
            .values(
                library_title_id=title_id,
                enabled=False,
                paused=False,
                auto_download=True,
                strategy=DownloadStrategy.NEW_ONLY,
                preferred_variant_id=int(variant.id),
                variant_ids_json=json.dumps([int(variant.id)]),
                start_from=None,
                created_at=now,
                updated_at=now,
            )
            .prefix_with("OR IGNORE")
        )
        profile = (
            await self.session.exec(
                select(DownloadProfile).where(DownloadProfile.library_title_id == title_id)
            )
        ).first()
        if profile is None:
            raise BridgeAPIError(
                500,
                f"Failed to create download profile for title: {title_id}",
            )
        if profile.preferred_variant_id is not None and not await self._profile_variant_ids(profile):
            await self._set_profile_variant_ids(profile, [int(profile.preferred_variant_id)])
        return profile

    def _downloads_root(self) -> Path:
        if self._download_root_cache is not None:
            return self._download_root_cache

        configured = settings.downloads.root_dir
        fallback = settings.app.data_dir / "downloads"
        legacy_fallback = settings.app.config_dir / "downloads"

        for candidate in [configured, fallback, legacy_fallback]:
            try:
                candidate.mkdir(parents=True, exist_ok=True)
                probe = candidate / ".write-check"
                probe.touch(exist_ok=True)
                probe.unlink(missing_ok=True)
                if candidate != configured:
                    _service_logger.warning(
                        "Downloads root '{}' is not writable; using fallback '{}'",
                        configured,
                        candidate,
                    )
                self._download_root_cache = candidate
                return candidate
            except Exception:
                continue

        raise BridgeAPIError(
            500,
            "No writable download root found "
            f"(configured: {configured}, fallback: {fallback}, legacy: {legacy_fallback})",
        )

    def _chapter_dir(
        self,
        title: LibraryTitle,
        variant: LibraryTitleVariant,
        chapter: LibraryChapter,
    ) -> Path:
        source_name = _safe_segment(variant.source_name or "source", "source")
        source_lang = _safe_segment((variant.source_lang or "und").lower(), "und")
        source_segment = f"{source_name} [{source_lang}]"

        title_segment = _safe_segment(variant.title or title.title, f"title-{title.id}")

        chapter_number = _coerce_positive_float(chapter.chapter_number) or _chapter_number_from_text(
            chapter.name
        )
        chapter_number_segment = _format_chapter_number_segment(chapter_number)

        base_dir = self._downloads_root() / source_segment / title_segment
        chapter_segment = self._chapter_download_segment(
            chapter=chapter,
            chapter_number_segment=chapter_number_segment,
        )
        chapter_segment = self._unique_chapter_download_segment(
            base_dir=base_dir,
            preferred_segment=chapter_segment,
            chapter_url=chapter.chapter_url,
        )
        return base_dir / chapter_segment

    @staticmethod
    def _chapter_download_segment(
        chapter: LibraryChapter,
        chapter_number_segment: str | None,
    ) -> str:
        if chapter_number_segment:
            return _safe_segment(chapter_number_segment, "chapter")

        from_name = _safe_segment((chapter.name or "").strip(), "")
        if from_name:
            return from_name
        if chapter.id is not None:
            return f"chapter-{chapter.id}"
        return "chapter"

    @staticmethod
    def _chapter_download_entry_exists(chapter_dir: Path) -> bool:
        if chapter_dir.is_dir():
            return True
        return chapter_archive_path(chapter_dir).is_file()

    @staticmethod
    def _chapter_download_entry_matches_url(
        chapter_dir: Path,
        chapter_url: str | None,
    ) -> bool:
        expected_url = (chapter_url or "").strip()
        if not expected_url:
            return False
        payload = read_chapter_metadata(chapter_dir)
        existing_url = _payload_str(payload, "chapter", "url")
        return bool(existing_url and existing_url == expected_url)

    def _unique_chapter_download_segment(
        self,
        base_dir: Path,
        preferred_segment: str,
        chapter_url: str | None,
    ) -> str:
        segment = preferred_segment
        counter = 2
        stem = preferred_segment[:72].rstrip(" ._-") or "chapter"
        while True:
            candidate = base_dir / segment
            if not self._chapter_download_entry_exists(candidate):
                return segment
            if self._chapter_download_entry_matches_url(candidate, chapter_url):
                return segment
            segment = f"{stem}-{counter}"
            counter += 1

    @staticmethod
    def _chapter_order_oldest_first():
        return (
            case((LibraryChapter.chapter_number < 0, 1), else_=0),
            LibraryChapter.chapter_number,
            LibraryChapter.date_upload,
            LibraryChapter.id,
        )

    @staticmethod
    def _write_chapter_metadata_file(
        chapter_dir: Path,
        title: LibraryTitle,
        variant: LibraryTitleVariant,
        chapter: LibraryChapter,
        page_count: int,
    ) -> None:
        DownloadService._write_title_metadata_file(
            title_dir=chapter_dir.parent,
            title=title,
            variant=variant,
        )
        payload = {
            "schema": "mangarr.chapter.metadata.v1",
            "generated_at": _now_utc().isoformat(),
            "source": {
                "id": variant.source_id,
                "name": variant.source_name,
                "lang": variant.source_lang,
            },
            "title": {
                "name": variant.title or title.title,
                "url": variant.title_url,
            },
            "chapter": {
                "url": chapter.chapter_url,
                "name": chapter.name,
                "number": str(chapter.chapter_number),
                "scanlator": chapter.scanlator,
                "uploaded_at": chapter.date_upload.isoformat(),
                "downloaded_at": _now_utc().isoformat(),
                "pages": page_count,
            },
        }
        write_chapter_metadata(chapter_dir, payload)

    @staticmethod
    def _write_title_metadata_file(
        title_dir: Path,
        title: LibraryTitle,
        variant: LibraryTitleVariant,
    ) -> None:
        payload = {
            "schema": "mangarr.title.metadata.v1",
            "generated_at": _now_utc().isoformat(),
            "source": {
                "id": variant.source_id,
                "name": variant.source_name,
                "lang": variant.source_lang,
            },
            "title": {
                "library_title_id": int(title.id) if title.id is not None else None,
                "variant_id": int(variant.id) if variant.id is not None else None,
                "name": variant.title or title.title,
                "url": variant.title_url,
            },
        }
        write_title_metadata(title_dir, payload)

    @staticmethod
    def _write_external_title_metadata_file(
        title_dir: Path,
        source_id: str | None,
        source_name: str | None,
        source_lang: str | None,
        title_name: str | None,
        title_url: str | None,
    ) -> None:
        payload = {
            "schema": "mangarr.title.metadata.v1",
            "generated_at": _now_utc().isoformat(),
            "source": {
                "id": source_id,
                "name": source_name,
                "lang": source_lang,
            },
            "title": {
                "name": title_name,
                "url": title_url,
            },
        }
        write_title_metadata(title_dir, payload)

    async def _to_profile_resource(self, profile: DownloadProfile) -> DownloadProfileResource:
        return DownloadProfileResource(
            id=int(profile.id),
            library_title_id=profile.library_title_id,
            enabled=profile.enabled,
            paused=profile.paused,
            auto_download=profile.auto_download,
            strategy=profile.strategy,
            preferred_variant_id=profile.preferred_variant_id,
            variant_ids=await self._profile_variant_ids(profile),
            start_from=_as_utc(profile.start_from),
            last_checked_at=_as_utc(profile.last_checked_at),
            last_success_at=_as_utc(profile.last_success_at),
            last_error=profile.last_error,
        )

    @staticmethod
    def _to_task_resource(
        task: DownloadTask,
        is_paused: bool = False,
    ) -> DownloadTaskResource:
        return DownloadTaskResource(
            id=int(task.id),
            attempt_group_id=task.attempt_group_id,
            retry_of_task_id=task.retry_of_task_id,
            library_title_id=task.library_title_id,
            variant_id=task.variant_id,
            chapter_id=task.chapter_id,
            source_id=task.source_id,
            is_paused=is_paused,
            chapter_url=task.chapter_url,
            title_name=task.title_name,
            chapter_name=task.chapter_name,
            status=task.status,
            trigger=task.trigger,
            priority=task.priority,
            attempts=task.attempts,
            max_attempts=task.max_attempts,
            available_at=_as_utc(task.available_at),
            downloaded_pages=task.downloaded_pages,
            total_pages=task.total_pages,
            output_dir=task.output_dir,
            error=task.error,
            started_at=_as_utc(task.started_at),
            finished_at=_as_utc(task.finished_at),
            created_at=_as_utc(task.created_at),
            updated_at=_as_utc(task.updated_at),
        )
