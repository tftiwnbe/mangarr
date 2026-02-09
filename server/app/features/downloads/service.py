import asyncio
import re
import shutil
from datetime import datetime, timedelta, timezone
from pathlib import Path
from urllib.parse import urlparse

import httpx
from loguru import logger
from sqlalchemy import case
from sqlmodel import delete, desc, func, select
from sqlmodel.ext.asyncio.session import AsyncSession

from app.bridge import tachibridge
from app.config import settings
from app.core.errors import BridgeAPIError
from app.models import (
    DownloadOverviewResource,
    DownloadProfile,
    DownloadProfileResource,
    DownloadProfileUpdate,
    DownloadDashboardResource,
    DownloadMonitoredTitleResource,
    DownloadStrategy,
    DownloadTask,
    DownloadTaskResource,
    DownloadTaskStatus,
    DownloadTrigger,
    EnqueueChapterResponse,
    EnqueueTitleResponse,
    LibraryChapter,
    LibraryChapterPage,
    LibraryTitle,
    LibraryTitleVariant,
    MonitorRunResponse,
    SourceChapter,
    WorkerRunResponse,
)

_service_logger = logger.bind(module="downloads.service")
_SAFE_SEGMENT_RE = re.compile(r"[^a-zA-Z0-9._ -]+")


def _now_utc() -> datetime:
    return datetime.now(timezone.utc)


def _safe_segment(value: str, fallback: str) -> str:
    cleaned = _SAFE_SEGMENT_RE.sub("_", value).strip(" ._")
    return cleaned[:80] or fallback


def _short_error(exc: Exception) -> str:
    text = str(exc).strip()
    return text[:500] if text else exc.__class__.__name__


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

    def __init__(self, session: AsyncSession):
        self.session = session

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

        return DownloadOverviewResource(
            monitored_titles=monitored_titles,
            queued=by_status.get(DownloadTaskStatus.QUEUED, 0),
            downloading=by_status.get(DownloadTaskStatus.DOWNLOADING, 0),
            completed=by_status.get(DownloadTaskStatus.COMPLETED, 0),
            failed=by_status.get(DownloadTaskStatus.FAILED, 0),
            cancelled=by_status.get(DownloadTaskStatus.CANCELLED, 0),
        )

    async def get_dashboard(
        self,
        monitored_limit: int = 30,
        active_limit: int = 20,
        recent_limit: int = 20,
    ) -> DownloadDashboardResource:
        overview = await self.get_overview()

        monitored_rows = (
            await self.session.exec(
                select(DownloadProfile, LibraryTitle)
                .join(LibraryTitle, LibraryTitle.id == DownloadProfile.library_title_id)
                .where(DownloadProfile.enabled)
                .order_by(desc(DownloadProfile.updated_at))
                .limit(monitored_limit)
            )
        ).all()

        title_ids = [int(profile.library_title_id) for profile, _ in monitored_rows]

        chapter_stats: dict[int, tuple[int, int]] = {}
        if title_ids:
            chapter_rows = (
                await self.session.exec(
                    select(
                        LibraryChapter.library_title_id,
                        func.count(LibraryChapter.id),
                        func.sum(
                            case((LibraryChapter.is_downloaded == True, 1), else_=0)  # noqa: E712
                        ),
                    )
                    .where(LibraryChapter.library_title_id.in_(title_ids))
                    .group_by(LibraryChapter.library_title_id)
                )
            ).all()
            chapter_stats = {
                int(title_id): (int(total), int(downloaded or 0))
                for title_id, total, downloaded in chapter_rows
            }

        task_stats: dict[int, dict[DownloadTaskStatus, int]] = {}
        if title_ids:
            task_rows = (
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
                                DownloadTaskStatus.FAILED,
                            ]
                        ),
                    )
                    .group_by(DownloadTask.library_title_id, DownloadTask.status)
                )
            ).all()
            for title_id, raw_status, count in task_rows:
                status = _coerce_task_status(raw_status)
                if status is None:
                    continue
                per_title = task_stats.setdefault(int(title_id), {})
                per_title[status] = int(count)

        monitored_titles: list[DownloadMonitoredTitleResource] = []
        for profile, title in monitored_rows:
            total, downloaded = chapter_stats.get(int(profile.library_title_id), (0, 0))
            stats = task_stats.get(int(profile.library_title_id), {})
            queued = stats.get(DownloadTaskStatus.QUEUED, 0) + stats.get(
                DownloadTaskStatus.DOWNLOADING, 0
            )
            failed = stats.get(DownloadTaskStatus.FAILED, 0)
            monitored_titles.append(
                DownloadMonitoredTitleResource(
                    library_title_id=int(profile.library_title_id),
                    title=title.title,
                    thumbnail_url=title.thumbnail_url,
                    enabled=profile.enabled,
                    auto_download=profile.auto_download,
                    strategy=profile.strategy,
                    preferred_variant_id=profile.preferred_variant_id,
                    start_from=profile.start_from,
                    last_checked_at=profile.last_checked_at,
                    last_success_at=profile.last_success_at,
                    last_error=profile.last_error,
                    total_chapters=total,
                    downloaded_chapters=downloaded,
                    queued_tasks=queued,
                    failed_tasks=failed,
                )
            )

        active_rows = (
            await self.session.exec(
                select(DownloadTask)
                .where(
                    DownloadTask.status.in_(
                        [
                            DownloadTaskStatus.QUEUED,
                            DownloadTaskStatus.DOWNLOADING,
                            DownloadTaskStatus.FAILED,
                        ]
                    )
                )
                .order_by(DownloadTask.priority, DownloadTask.created_at)
                .limit(active_limit)
            )
        ).all()
        active_tasks = [self._to_task_resource(task) for task in active_rows]

        recent_rows = (
            await self.session.exec(
                select(DownloadTask)
                .where(
                    DownloadTask.status.in_(
                        [
                            DownloadTaskStatus.COMPLETED,
                            DownloadTaskStatus.CANCELLED,
                        ]
                    )
                )
                .order_by(desc(DownloadTask.finished_at), desc(DownloadTask.updated_at))
                .limit(recent_limit)
            )
        ).all()
        recent_tasks = [self._to_task_resource(task) for task in recent_rows]

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
        return [self._to_profile_resource(profile) for profile in rows]

    async def get_profile(self, title_id: int) -> DownloadProfileResource:
        title = await self.session.get(LibraryTitle, title_id)
        if title is None:
            raise BridgeAPIError(404, f"Library title not found: {title_id}")

        profile = await self._get_or_create_profile(title_id)
        await self.session.commit()
        await self.session.refresh(profile)
        return self._to_profile_resource(profile)

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

        updates = payload.model_dump(exclude_unset=True)
        now = _now_utc()

        if "enabled" in updates:
            profile.enabled = bool(updates["enabled"])
        if "auto_download" in updates:
            profile.auto_download = bool(updates["auto_download"])
        if "strategy" in updates and updates["strategy"] is not None:
            profile.strategy = updates["strategy"]
        if "preferred_variant_id" in updates:
            profile.preferred_variant_id = updates["preferred_variant_id"]
        if "start_from" in updates:
            profile.start_from = updates["start_from"]

        profile.updated_at = now
        self.session.add(profile)
        await self.session.commit()
        await self.session.refresh(profile)

        return self._to_profile_resource(profile)

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
        return [self._to_task_resource(task) for task in rows]

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
        )
        await self.session.commit()
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

        chapters = (await self.session.exec(stmt.order_by(desc(LibraryChapter.chapter_number)))).all()

        queued = 0
        for chapter in chapters:
            _, created = await self._enqueue_chapter_if_needed(
                chapter_id=int(chapter.id),
                trigger=DownloadTrigger.MANUAL,
                priority=80,
            )
            if created:
                queued += 1

        await self.session.commit()
        return EnqueueTitleResponse(queued=queued)

    async def retry_task(self, task_id: int) -> DownloadTaskResource:
        task = await self.session.get(DownloadTask, task_id)
        if task is None:
            raise BridgeAPIError(404, f"Download task not found: {task_id}")

        task.status = DownloadTaskStatus.QUEUED
        task.available_at = _now_utc()
        task.error = None
        task.finished_at = None
        task.updated_at = _now_utc()

        self.session.add(task)
        await self.session.commit()
        await self.session.refresh(task)

        return self._to_task_resource(task)

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
        await self.session.commit()
        await self.session.refresh(task)

        return self._to_task_resource(task)

    async def run_monitor_once(self, limit: int = 25) -> MonitorRunResponse:
        async with self._monitor_lock:
            rows = (
                await self.session.exec(
                    select(DownloadProfile)
                    .where(DownloadProfile.enabled)
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
                    title = await self.session.get(LibraryTitle, profile.library_title_id)
                    if title is None:
                        profile.enabled = False
                        profile.last_error = (
                            f"Library title not found: {profile.library_title_id}"
                        )
                        profile.last_checked_at = now
                        profile.updated_at = now
                        self.session.add(profile)
                        await self.session.commit()
                        continue

                    variant = await self._resolve_variant(
                        title_id=int(title.id),
                        preferred_variant_id=profile.preferred_variant_id,
                    )
                    new_chapter_ids = await self._sync_variant_and_collect_new(
                        title=title,
                        variant=variant,
                    )

                    profile.last_checked_at = now
                    profile.last_success_at = now
                    profile.last_error = None
                    profile.updated_at = now
                    self.session.add(profile)

                    if profile.auto_download:
                        candidate_ids = await self._chapters_for_profile(
                            variant_id=int(variant.id),
                            new_chapter_ids=new_chapter_ids,
                            profile=profile,
                        )
                        for chapter_id in candidate_ids:
                            _, created = await self._enqueue_chapter_if_needed(
                                chapter_id=chapter_id,
                                trigger=DownloadTrigger.MONITOR,
                                priority=60,
                            )
                            if created:
                                enqueued_total += 1

                    await self.session.commit()
                except Exception as exc:
                    profile.last_checked_at = now
                    profile.last_error = _short_error(exc)
                    profile.updated_at = now
                    self.session.add(profile)
                    await self.session.commit()
                    _service_logger.exception(
                        "Monitor refresh failed for title_id={}",
                        profile.library_title_id,
                    )

            return MonitorRunResponse(
                checked_titles=checked,
                enqueued_tasks=enqueued_total,
            )

    async def run_worker_once(self, batch_size: int | None = None) -> WorkerRunResponse:
        async with self._worker_lock:
            processed = 0
            limit = batch_size or settings.downloads.worker_batch_size
            for _ in range(limit):
                task = await self._claim_next_task()
                if task is None:
                    break
                await self._process_task(task)
                processed += 1

            return WorkerRunResponse(processed_tasks=processed)

    async def _claim_next_task(self) -> DownloadTask | None:
        now = _now_utc()
        task = (
            await self.session.exec(
                select(DownloadTask)
                .where(
                    DownloadTask.status == DownloadTaskStatus.QUEUED,
                    DownloadTask.available_at <= now,
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
        await self.session.commit()
        await self.session.refresh(task)
        return task

    async def _process_task(self, task: DownloadTask) -> None:
        now = _now_utc()
        chapter = await self.session.get(LibraryChapter, task.chapter_id)
        if chapter is None:
            await self._mark_task_cancelled(task.id, "Chapter no longer exists")
            return

        variant = await self.session.get(LibraryTitleVariant, chapter.variant_id)
        title = await self.session.get(LibraryTitle, chapter.library_title_id)
        if variant is None or title is None:
            await self._mark_task_failed(task.id, "Broken chapter references", final=True)
            return

        if chapter.is_downloaded:
            await self._mark_task_completed(task.id, output_dir=chapter.download_path)
            return

        output_dir = self._chapter_dir(title=title, chapter=chapter)

        try:
            pages = await tachibridge.fetch_chapter_pages(
                source_id=variant.source_id,
                chapter_url=chapter.chapter_url,
            )
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
                    remote_url = page.image_url or page.url
                    ext = _extension_from_url(remote_url) or ".jpg"
                    file_path = output_dir / f"{page.index:04d}{ext}"
                    content_type, file_size = await self._download_with_retries(
                        client=client,
                        url=remote_url,
                        output_path=file_path,
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
                    await self.session.commit()

            chapter.is_downloaded = True
            chapter.downloaded_at = _now_utc()
            chapter.download_path = str(output_dir.relative_to(self._downloads_root()).as_posix())
            chapter.download_error = None
            chapter.updated_at = _now_utc()
            self.session.add(chapter)

            await self._mark_task_completed(task.id, output_dir=chapter.download_path)
        except Exception as exc:
            chapter.is_downloaded = False
            chapter.download_error = _short_error(exc)
            chapter.updated_at = _now_utc()
            self.session.add(chapter)

            final = task.attempts >= task.max_attempts
            await self._mark_task_failed(task.id, chapter.download_error, final=final)

    async def _download_with_retries(
        self,
        client: httpx.AsyncClient,
        url: str,
        output_path: Path,
    ) -> tuple[str | None, int]:
        retries = max(settings.downloads.page_retry_count, 0)
        last_exc: Exception | None = None

        for attempt in range(retries + 1):
            tmp_path = output_path.with_suffix(f"{output_path.suffix}.part")
            try:
                async with client.stream("GET", url) as response:
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
                    await asyncio.sleep(min(5.0, 0.5 * (2**attempt)))

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
        await self.session.commit()

    async def _mark_task_failed(self, task_id: int | None, error: str, final: bool) -> None:
        if task_id is None:
            return

        task = await self.session.get(DownloadTask, task_id)
        if task is None:
            return

        now = _now_utc()
        task.error = error
        task.updated_at = now

        if final:
            task.status = DownloadTaskStatus.FAILED
            task.finished_at = now
        else:
            backoff = min(30 * (2 ** max(task.attempts - 1, 0)), 1800)
            task.status = DownloadTaskStatus.QUEUED
            task.available_at = now + timedelta(seconds=backoff)

        self.session.add(task)
        await self.session.commit()

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
        await self.session.commit()

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

        variant.source_name = variant.source_name
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
        await self.session.commit()
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
    ) -> list[int]:
        if profile.strategy == DownloadStrategy.NEW_ONLY:
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
                stmt.order_by(desc(LibraryChapter.chapter_number), desc(LibraryChapter.date_upload))
            )
        ).all()

        selected: list[int] = []
        cutoff = profile.start_from
        for chapter in chapters:
            if cutoff and chapter.date_upload < cutoff:
                continue
            if chapter.id is not None:
                selected.append(int(chapter.id))
        return selected

    async def _enqueue_chapter_if_needed(
        self,
        chapter_id: int,
        trigger: DownloadTrigger,
        priority: int,
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

            task = DownloadTask(
                library_title_id=int(title.id),
                variant_id=int(variant.id),
                chapter_id=chapter_id,
                source_id=variant.source_id,
                chapter_url=chapter.chapter_url,
                title_name=title.title,
                chapter_name=chapter.name,
                status=DownloadTaskStatus.QUEUED,
                trigger=trigger,
                priority=priority,
                max_attempts=settings.downloads.max_attempts,
                available_at=_now_utc(),
                created_at=_now_utc(),
                updated_at=_now_utc(),
            )
            self.session.add(task)
            await self.session.flush()
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

    async def _get_or_create_profile(self, title_id: int) -> DownloadProfile:
        profile = (
            await self.session.exec(
                select(DownloadProfile).where(DownloadProfile.library_title_id == title_id)
            )
        ).first()
        if profile is not None:
            return profile

        now = _now_utc()
        profile = DownloadProfile(
            library_title_id=title_id,
            enabled=False,
            auto_download=True,
            strategy=DownloadStrategy.NEW_ONLY,
            start_from=None,
            created_at=now,
            updated_at=now,
        )
        self.session.add(profile)
        await self.session.flush()
        return profile

    def _downloads_root(self) -> Path:
        root = settings.downloads.root_dir
        root.mkdir(parents=True, exist_ok=True)
        return root

    def _chapter_dir(self, title: LibraryTitle, chapter: LibraryChapter) -> Path:
        title_part = _safe_segment(title.title, f"title-{title.id}")
        chapter_part = _safe_segment(chapter.name, f"chapter-{chapter.id}")
        return self._downloads_root() / f"{title.id}-{title_part}" / f"{chapter.id}-{chapter_part}"

    @staticmethod
    def _to_profile_resource(profile: DownloadProfile) -> DownloadProfileResource:
        return DownloadProfileResource(
            id=int(profile.id),
            library_title_id=profile.library_title_id,
            enabled=profile.enabled,
            auto_download=profile.auto_download,
            strategy=profile.strategy,
            preferred_variant_id=profile.preferred_variant_id,
            start_from=profile.start_from,
            last_checked_at=profile.last_checked_at,
            last_success_at=profile.last_success_at,
            last_error=profile.last_error,
        )

    @staticmethod
    def _to_task_resource(task: DownloadTask) -> DownloadTaskResource:
        return DownloadTaskResource(
            id=int(task.id),
            library_title_id=task.library_title_id,
            variant_id=task.variant_id,
            chapter_id=task.chapter_id,
            source_id=task.source_id,
            chapter_url=task.chapter_url,
            title_name=task.title_name,
            chapter_name=task.chapter_name,
            status=task.status,
            trigger=task.trigger,
            priority=task.priority,
            attempts=task.attempts,
            max_attempts=task.max_attempts,
            available_at=task.available_at,
            downloaded_pages=task.downloaded_pages,
            total_pages=task.total_pages,
            output_dir=task.output_dir,
            error=task.error,
            started_at=task.started_at,
            finished_at=task.finished_at,
            created_at=task.created_at,
            updated_at=task.updated_at,
        )
