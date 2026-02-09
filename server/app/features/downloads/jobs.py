from loguru import logger

from app.config import settings
from app.core.database import sessionmanager
from app.core.scheduler import scheduler
from app.features.downloads.service import DownloadService

job_logger = logger.bind(module="downloads.jobs")


@scheduler.interval(seconds=settings.downloads.monitor_interval_seconds)
async def refresh_monitored_titles_job() -> None:
    """Refresh monitored titles and enqueue new chapters."""
    try:
        async with sessionmanager.session() as session:
            service = DownloadService(session)
            await service.run_monitor_once(limit=100)
    except Exception:
        job_logger.exception("Monitored title refresh job failed")


@scheduler.interval(seconds=settings.downloads.worker_interval_seconds)
async def downloads_worker_job() -> None:
    """Process queued chapter download tasks."""
    try:
        async with sessionmanager.session() as session:
            service = DownloadService(session)
            await service.run_worker_once()
    except Exception:
        job_logger.exception("Download worker job failed")
