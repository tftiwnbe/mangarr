from fastapi import APIRouter, BackgroundTasks, Depends, Query, status

from app.core.database import sessionmanager
from app.core.deps import DBSessionDep, require_authenticated_user
from app.features.discover.service import DiscoverService
from app.models import DiscoverCategory, DiscoverFeed, SourceSummary

router = APIRouter(
    prefix="/api/v2/discover",
    tags=["discover"],
    dependencies=[Depends(require_authenticated_user)],
)


async def get_service(db: DBSessionDep) -> DiscoverService:
    return DiscoverService(db)


async def _refresh_discover_cache_task(max_pages: int) -> None:
    async with sessionmanager.session() as session:
        service = DiscoverService(session)
        await service.refresh_enabled_sources_cache(max_pages=max_pages)


@router.get("/sources", response_model=list[SourceSummary])
async def discover_sources(
    enabled: bool = Query(True, description="Return only enabled sources"),
    supports_latest: bool | None = Query(
        None, description="Filter by latest-updates support"
    ),
    service: DiscoverService = Depends(get_service),
):
    return await service.list_sources(
        enabled=enabled,
        supports_latest=supports_latest,
    )


@router.get("/categories", response_model=list[DiscoverCategory])
async def discover_categories(
    limit: int = Query(30, ge=1, le=100),
    service: DiscoverService = Depends(get_service),
):
    return await service.list_categories(limit=limit)


@router.post("/refresh", status_code=status.HTTP_202_ACCEPTED)
async def refresh_discover_cache(
    background_tasks: BackgroundTasks,
    pages: int = Query(2, ge=1, le=10),
):
    background_tasks.add_task(_refresh_discover_cache_task, pages)
    return {"status": "accepted", "pages": pages}


@router.get("/popular", response_model=DiscoverFeed)
async def discover_popular(
    page: int = Query(1, ge=1),
    limit: int = Query(20, ge=1, le=100),
    source_id: str | None = Query(None),
    service: DiscoverService = Depends(get_service),
):
    return await service.popular(page=page, limit=limit, source_id=source_id)


@router.get("/latest", response_model=DiscoverFeed)
async def discover_latest(
    page: int = Query(1, ge=1),
    limit: int = Query(20, ge=1, le=100),
    source_id: str | None = Query(None),
    service: DiscoverService = Depends(get_service),
):
    return await service.latest(page=page, limit=limit, source_id=source_id)


@router.get("/search", response_model=DiscoverFeed)
async def discover_search(
    query: str = Query(..., min_length=1),
    page: int = Query(1, ge=1),
    limit: int = Query(20, ge=1, le=100),
    source_id: str | None = Query(None),
    service: DiscoverService = Depends(get_service),
):
    return await service.search(
        query=query,
        page=page,
        limit=limit,
        source_id=source_id,
    )


@router.get("/category", response_model=DiscoverFeed)
async def discover_category(
    name: str = Query(..., min_length=1),
    page: int = Query(1, ge=1),
    limit: int = Query(20, ge=1, le=100),
    source_id: str | None = Query(None),
    service: DiscoverService = Depends(get_service),
):
    return await service.category(
        name=name,
        page=page,
        limit=limit,
        source_id=source_id,
    )
