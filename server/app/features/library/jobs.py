from datetime import UTC, datetime, timedelta

from app.config import settings
from app.core.cache import PersistentCache
from app.core.database import sessionmanager
from app.core.scheduler import scheduler
from app.features.library.service import LibraryService

LIBRARY_CLEANUP_LAST_RUN_CACHE_KEY = "jobs:library_cleanup_unassigned:last_run"


def _parse_last_run(value: object) -> datetime | None:
    if isinstance(value, str):
        try:
            parsed = datetime.fromisoformat(value)
        except ValueError:
            return None
        if parsed.tzinfo is None:
            return parsed.replace(tzinfo=UTC)
        return parsed.astimezone(UTC)
    if isinstance(value, dict):
        return _parse_last_run(value.get("ran_at"))
    return None


async def get_last_cleanup_run_at() -> datetime | None:
    cache = PersistentCache(sessionmanager.session)
    payload = await cache.get(LIBRARY_CLEANUP_LAST_RUN_CACHE_KEY)
    return _parse_last_run(payload)


async def run_unassigned_cleanup(
    force: bool = False,
) -> tuple[bool, int, datetime | None]:
    if not settings.jobs.cleanup_unassigned_enabled and not force:
        return False, 0, None

    now = datetime.now(tz=UTC)
    last_run = await get_last_cleanup_run_at()
    interval_days = max(1, int(settings.jobs.cleanup_unassigned_interval_days))
    is_due = (
        force or last_run is None or (now - last_run) >= timedelta(days=interval_days)
    )
    if not is_due:
        return False, 0, last_run

    deleted = 0
    async with sessionmanager.session() as session:
        service = LibraryService(session)
        deleted = await service.cleanup_unassigned_titles(
            older_than_days=int(settings.jobs.cleanup_unassigned_older_than_days),
            limit=int(settings.jobs.cleanup_unassigned_batch_limit),
        )

    cache = PersistentCache(sessionmanager.session)
    await cache.set(
        LIBRARY_CLEANUP_LAST_RUN_CACHE_KEY,
        {"ran_at": now.isoformat(), "deleted_titles": deleted},
    )
    return True, deleted, now


@scheduler.interval(seconds=24 * 60 * 60, label="Library Cleanup")
async def cleanup_unassigned_library_titles_job() -> None:
    await run_unassigned_cleanup(force=False)
