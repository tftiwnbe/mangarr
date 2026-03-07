from fastapi import APIRouter, Depends, Query

from app.core.deps import DBSessionDep, require_authenticated_user
from app.features.downloads.service import DownloadService
from app.models import (
    DownloadDashboardResource,
    DownloadExternalImportRequest,
    DownloadExternalImportResponse,
    DownloadOverviewResource,
    DownloadProfileResource,
    DownloadProfileUpdate,
    DownloadReconcileResource,
    DownloadTaskResource,
    DownloadTaskStatus,
    EnqueueChapterResponse,
    EnqueueTitleResponse,
    WatchRunResponse,
    WorkerRunResponse,
)

router = APIRouter(
    prefix="/api/v2/downloads",
    tags=["downloads"],
    dependencies=[Depends(require_authenticated_user)],
)


async def get_service(db: DBSessionDep) -> DownloadService:
    return DownloadService(db)


@router.get("/overview", response_model=DownloadOverviewResource)
async def get_overview(service: DownloadService = Depends(get_service)):
    return await service.get_overview()


@router.get("/dashboard", response_model=DownloadDashboardResource)
async def get_dashboard(
    watched_limit: int = Query(30, ge=1, le=100),
    active_limit: int = Query(20, ge=1, le=100),
    recent_limit: int = Query(20, ge=1, le=100),
    service: DownloadService = Depends(get_service),
):
    return await service.get_dashboard(
        watched_limit=watched_limit,
        active_limit=active_limit,
        recent_limit=recent_limit,
    )


@router.get("/profiles", response_model=list[DownloadProfileResource])
async def list_profiles(
    enabled: bool | None = Query(None),
    title_id: int | None = Query(None),
    offset: int = Query(0, ge=0),
    limit: int = Query(50, ge=1, le=200),
    service: DownloadService = Depends(get_service),
):
    return await service.list_profiles(
        enabled=enabled,
        title_id=title_id,
        offset=offset,
        limit=limit,
    )


@router.put("/profiles/{title_id}", response_model=DownloadProfileResource)
async def update_profile(
    title_id: int,
    payload: DownloadProfileUpdate,
    service: DownloadService = Depends(get_service),
):
    return await service.update_profile(title_id=title_id, payload=payload)


@router.get("/profiles/{title_id}", response_model=DownloadProfileResource)
async def get_profile(
    title_id: int,
    service: DownloadService = Depends(get_service),
):
    return await service.get_profile(title_id=title_id)


@router.get("/tasks", response_model=list[DownloadTaskResource])
async def list_tasks(
    status: DownloadTaskStatus | None = Query(None),
    title_id: int | None = Query(None),
    offset: int = Query(0, ge=0),
    limit: int = Query(50, ge=1, le=200),
    service: DownloadService = Depends(get_service),
):
    return await service.list_tasks(
        status=status,
        title_id=title_id,
        offset=offset,
        limit=limit,
    )


@router.post("/chapters/{chapter_id}/enqueue", response_model=EnqueueChapterResponse)
async def enqueue_chapter(
    chapter_id: int,
    priority: int = Query(100, ge=0, le=1000),
    service: DownloadService = Depends(get_service),
):
    return await service.enqueue_chapter(chapter_id=chapter_id, priority=priority)


@router.post("/titles/{title_id}/enqueue-missing", response_model=EnqueueTitleResponse)
async def enqueue_title_missing(
    title_id: int,
    variant_id: int | None = Query(None),
    unread_only: bool = Query(True),
    service: DownloadService = Depends(get_service),
):
    return await service.enqueue_missing_for_title(
        title_id=title_id,
        variant_id=variant_id,
        unread_only=unread_only,
    )


@router.post("/tasks/{task_id}/retry", response_model=DownloadTaskResource)
async def retry_task(
    task_id: int,
    service: DownloadService = Depends(get_service),
):
    return await service.retry_task(task_id)


@router.post("/tasks/{task_id}/cancel", response_model=DownloadTaskResource)
async def cancel_task(
    task_id: int,
    service: DownloadService = Depends(get_service),
):
    return await service.cancel_task(task_id)


@router.post("/run-watch", response_model=WatchRunResponse)
async def run_watch(
    limit: int = Query(25, ge=1, le=200),
    seed_existing: bool = Query(True),
    service: DownloadService = Depends(get_service),
):
    return await service.run_monitor_once(limit=limit, seed_existing=seed_existing)


@router.post("/run-worker", response_model=WorkerRunResponse)
async def run_worker(
    batch_size: int | None = Query(None, ge=1, le=50),
    service: DownloadService = Depends(get_service),
):
    return await service.run_worker_once(batch_size=batch_size)


@router.post("/reconcile", response_model=DownloadReconcileResource)
async def reconcile_downloads(
    query: str | None = Query(None),
    limit: int = Query(100, ge=1, le=500),
    service: DownloadService = Depends(get_service),
):
    return await service.reconcile_downloads(query=query, limit=limit)


@router.post(
    "/external-titles/import",
    response_model=DownloadExternalImportResponse,
)
async def import_external_download_title(
    payload: DownloadExternalImportRequest,
    service: DownloadService = Depends(get_service),
):
    return await service.import_external_download_title(payload)
