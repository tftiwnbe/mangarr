from app.config import settings
from app.core.cache import PersistentCache
from app.core.database import sessionmanager
from app.core.scheduler import scheduler
from app.features.downloads.service import DownloadService


@scheduler.interval(seconds=settings.downloads.monitor_interval_seconds, label="Downloads Watch")
async def refresh_watched_titles_job() -> None:
    """Refresh watched titles and enqueue new chapters."""
    async with sessionmanager.session() as session:
        service = DownloadService(session)
        await service.run_monitor_once(limit=100)


@scheduler.interval(seconds=settings.downloads.worker_interval_seconds, label="Downloads Worker")
async def downloads_worker_job() -> None:
    """Process queued chapter download tasks."""
    async with sessionmanager.session() as session:
        service = DownloadService(session)
        await service.run_worker_once()


@scheduler.interval(seconds=6 * 60 * 60, label="Cache Cleanup")  # every 6 hours
async def purge_expired_cache_job() -> None:
    """Remove expired entries from the persistent cache table."""
    cache = PersistentCache(sessionmanager.session)
    await cache.purge_expired()
