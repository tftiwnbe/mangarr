from loguru import logger

from app.core.database import sessionmanager
from app.core.scheduler import scheduler
from app.features.explore.service import ExploreService

job_logger = logger.bind(module="explore.jobs")


@scheduler.interval(seconds=300, label="Explore Cache")
async def refresh_explore_cache_job() -> None:
    """Refresh first pages of explore feeds for enabled sources."""
    try:
        async with sessionmanager.session() as session:
            service = ExploreService(session)
            await service.refresh_enabled_sources_cache(max_pages=2)
    except Exception:
        job_logger.exception("Explore cache refresh job failed")
