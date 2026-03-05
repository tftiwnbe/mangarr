from fastapi import APIRouter, Depends, HTTPException

from app.core.deps import CurrentUserDep, require_authenticated_user
from app.core.scheduler import scheduler
from app.features.settings.service import SettingsService
from app.models import (
    ContentLanguagesResource,
    ContentLanguagesUpdate,
    DownloadSettingsResource,
    DownloadSettingsUpdate,
    FlareSolverrSettingsResource,
    FlareSolverrSettingsUpdate,
    JobsCleanupRunResource,
    JobsSettingsResource,
    JobsSettingsUpdate,
    ProxySettingsResource,
    ProxySettingsUpdate,
    SchedulerJobResource,
    SchedulerStatusResource,
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
    return await SettingsService.update_download_settings(payload=payload, current_user=current_user)


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


@router.get("/scheduler", response_model=SchedulerStatusResource)
async def get_scheduler_status():
    jobs = [SchedulerJobResource(**j) for j in scheduler.get_status()]
    return SchedulerStatusResource(jobs=jobs)


@router.post("/scheduler/{job_name}/trigger", response_model=SchedulerJobResource)
async def trigger_scheduler_job(job_name: str, _: CurrentUserDep):
    if not scheduler.trigger_job(job_name):
        raise HTTPException(status_code=404, detail=f"Job '{job_name}' not found or scheduler not running")
    job = scheduler.find_job(job_name)
    if not job:
        raise HTTPException(status_code=404, detail=f"Job '{job_name}' not found")
    return SchedulerJobResource(
        name=job.name,
        label=job.label,
        interval_seconds=job.interval,
        paused=job.paused,
        running=job.running,
        last_run_at=job.last_run_at,
    )


@router.post("/scheduler/{job_name}/pause", response_model=SchedulerJobResource)
async def pause_scheduler_job(job_name: str, _: CurrentUserDep):
    if not scheduler.pause_job(job_name):
        raise HTTPException(status_code=404, detail=f"Job '{job_name}' not found")
    job = scheduler.find_job(job_name)
    if not job:
        raise HTTPException(status_code=404, detail=f"Job '{job_name}' not found")
    return SchedulerJobResource(
        name=job.name,
        label=job.label,
        interval_seconds=job.interval,
        paused=job.paused,
        running=job.running,
        last_run_at=job.last_run_at,
    )


@router.post("/scheduler/{job_name}/resume", response_model=SchedulerJobResource)
async def resume_scheduler_job(job_name: str, _: CurrentUserDep):
    if not scheduler.resume_job(job_name):
        raise HTTPException(status_code=404, detail=f"Job '{job_name}' not found")
    job = scheduler.find_job(job_name)
    if not job:
        raise HTTPException(status_code=404, detail=f"Job '{job_name}' not found")
    return SchedulerJobResource(
        name=job.name,
        label=job.label,
        interval_seconds=job.interval,
        paused=job.paused,
        running=job.running,
        last_run_at=job.last_run_at,
    )


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


@router.get("/proxy", response_model=ProxySettingsResource)
async def get_proxy_settings():
    return await SettingsService.get_proxy_settings()


@router.put("/proxy", response_model=ProxySettingsResource)
async def update_proxy_settings(
    payload: ProxySettingsUpdate,
    current_user: CurrentUserDep,
):
    return await SettingsService.update_proxy_settings(
        payload=payload,
        current_user=current_user,
    )


@router.get("/content-languages", response_model=ContentLanguagesResource)
async def get_content_languages():
    return SettingsService.get_content_languages()


@router.put("/content-languages", response_model=ContentLanguagesResource)
async def update_content_languages(
    payload: ContentLanguagesUpdate,
    current_user: CurrentUserDep,
):
    return await SettingsService.update_content_languages(payload=payload, current_user=current_user)
