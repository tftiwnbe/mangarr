import json

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, Query, status

from app.core.database import sessionmanager
from app.core.deps import DBSessionDep, require_authenticated_user
from app.features.explore.service import ExploreService
from app.models import (
    ExploreCategory,
    ExploreFeed,
    ExploreTitleDetailsResource,
    SourcePreferencesResource,
    SourceSummary,
)

explore_router = APIRouter(
    prefix="/api/v2/explore",
    tags=["explore"],
    dependencies=[Depends(require_authenticated_user)],
)


async def get_service(db: DBSessionDep) -> ExploreService:
    return ExploreService(db)


async def _refresh_explore_cache_task(max_pages: int) -> None:
    async with sessionmanager.session() as session:
        service = ExploreService(session)
        await service.refresh_enabled_sources_cache(max_pages=max_pages)


@explore_router.get("/sources", response_model=list[SourceSummary])
async def explore_sources(
    enabled: bool = Query(True, description="Return only enabled sources"),
    supports_latest: bool | None = Query(
        None, description="Filter by latest-updates support"
    ),
    service: ExploreService = Depends(get_service),
):
    return await service.list_sources(
        enabled=enabled,
        supports_latest=supports_latest,
    )


@explore_router.get("/categories", response_model=list[ExploreCategory])
async def explore_categories(
    limit: int = Query(30, ge=1, le=100),
    service: ExploreService = Depends(get_service),
):
    return await service.list_categories(limit=limit)


@explore_router.post("/refresh", status_code=status.HTTP_202_ACCEPTED)
async def refresh_explore_cache(
    background_tasks: BackgroundTasks,
    pages: int = Query(2, ge=1, le=10),
):
    background_tasks.add_task(_refresh_explore_cache_task, pages)
    return {"status": "accepted", "pages": pages}


@explore_router.get("/popular", response_model=ExploreFeed)
async def explore_popular(
    page: int = Query(1, ge=1),
    limit: int = Query(20, ge=1, le=100),
    source_id: str | None = Query(None),
    extension_pkg: list[str] | None = Query(None),
    service: ExploreService = Depends(get_service),
):
    return await service.popular(
        page=page,
        limit=limit,
        source_id=source_id,
        extension_pkgs=extension_pkg,
    )


@explore_router.get("/latest", response_model=ExploreFeed)
async def explore_latest(
    page: int = Query(1, ge=1),
    limit: int = Query(20, ge=1, le=100),
    source_id: str | None = Query(None),
    extension_pkg: list[str] | None = Query(None),
    service: ExploreService = Depends(get_service),
):
    return await service.latest(
        page=page,
        limit=limit,
        source_id=source_id,
        extension_pkgs=extension_pkg,
    )


@explore_router.get("/search", response_model=ExploreFeed)
async def explore_search(
    query: str = Query(..., min_length=1),
    page: int = Query(1, ge=1),
    limit: int = Query(20, ge=1, le=100),
    source_id: str | None = Query(None),
    extension_pkg: list[str] | None = Query(None),
    category: str | None = Query(None),
    search_filters_json: str | None = Query(None),
    service: ExploreService = Depends(get_service),
):
    search_filters: dict[str, object] | None = None
    if search_filters_json:
        try:
            parsed = json.loads(search_filters_json)
        except json.JSONDecodeError as exc:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Invalid search_filters_json payload",
            ) from exc
        if not isinstance(parsed, dict):
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="search_filters_json must be a JSON object",
            )
        search_filters = parsed

    return await service.search(
        query=query,
        page=page,
        limit=limit,
        source_id=source_id,
        extension_pkgs=extension_pkg,
        category=category,
        search_filters=search_filters,
    )


@explore_router.get("/category", response_model=ExploreFeed)
async def explore_category(
    name: str = Query(..., min_length=1),
    page: int = Query(1, ge=1),
    limit: int = Query(20, ge=1, le=100),
    source_id: str | None = Query(None),
    extension_pkg: list[str] | None = Query(None),
    service: ExploreService = Depends(get_service),
):
    return await service.category(
        name=name,
        page=page,
        limit=limit,
        source_id=source_id,
        extension_pkgs=extension_pkg,
    )


@explore_router.get("/title-details", response_model=ExploreTitleDetailsResource)
async def explore_title_details(
    source_id: str = Query(..., min_length=1),
    title_url: str = Query(..., min_length=1),
    refresh: bool = Query(False),
    service: ExploreService = Depends(get_service),
):
    return await service.title_details(
        source_id=source_id,
        title_url=title_url,
        refresh=refresh,
    )


@explore_router.get("/search-filters", response_model=SourcePreferencesResource)
async def explore_search_filters(
    source_id: str = Query(..., min_length=1),
    service: ExploreService = Depends(get_service),
):
    return await service.search_filters(source_id=source_id)
