from fastapi import APIRouter, Depends

from app.core.deps import CurrentUserDep, require_authenticated_user
from app.features.settings.service import SettingsService
from app.models import (
    DownloadSettingsResource,
    DownloadSettingsUpdate,
    FlareSolverrSettingsResource,
    FlareSolverrSettingsUpdate,
    JobsCleanupRunResource,
    JobsSettingsResource,
    JobsSettingsUpdate,
)

router = APIRouter(
    prefix="/api/v2/settings",
    tags=["settings"],
    dependencies=[Depends(require_authenticated_user)],
)


@router.get("/downloads", response_model=DownloadSettingsResource)
async def get_download_settings():
    return SettingsService.get_download_settings()


@router.put("/downloads", response_model=DownloadSettingsResource)
async def update_download_settings(
    payload: DownloadSettingsUpdate,
    current_user: CurrentUserDep,
):
    return SettingsService.update_download_settings(payload=payload, current_user=current_user)


@router.get("/jobs", response_model=JobsSettingsResource)
async def get_jobs_settings():
    return await SettingsService.get_jobs_settings()


@router.put("/jobs", response_model=JobsSettingsResource)
async def update_jobs_settings(
    payload: JobsSettingsUpdate,
    current_user: CurrentUserDep,
):
    return await SettingsService.update_jobs_settings(
        payload=payload,
        current_user=current_user,
    )


@router.post("/jobs/cleanup-now", response_model=JobsCleanupRunResource)
async def run_jobs_cleanup_now(current_user: CurrentUserDep):
    return await SettingsService.run_jobs_cleanup_now(current_user=current_user)


@router.get("/flaresolverr", response_model=FlareSolverrSettingsResource)
async def get_flaresolverr_settings():
    return await SettingsService.get_flaresolverr_settings()


@router.put("/flaresolverr", response_model=FlareSolverrSettingsResource)
async def update_flaresolverr_settings(
    payload: FlareSolverrSettingsUpdate,
    current_user: CurrentUserDep,
):
    return await SettingsService.update_flaresolverr_settings(
        payload=payload,
        current_user=current_user,
    )
