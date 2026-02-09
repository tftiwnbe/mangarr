from loguru import logger

from app.core.database import sessionmanager
from app.core.scheduler import scheduler
from app.features.discover.service import DiscoverService

job_logger = logger.bind(module="discover.jobs")


@scheduler.interval(seconds=300)
async def refresh_discover_cache_job() -> None:
    """Refresh first pages of discover feeds for enabled sources."""
    try:
        async with sessionmanager.session() as session:
            service = DiscoverService(session)
            await service.refresh_enabled_sources_cache(max_pages=2)
    except Exception:
        job_logger.exception("Discover cache refresh job failed")
