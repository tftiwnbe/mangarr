from sqlmodel import Field, SQLModel


class DownloadSettingsResource(SQLModel):
    root_dir: str
    parallel_downloads: int = Field(default=1, ge=1, le=16)
    failed_chapter_retry_delay_seconds: int = Field(default=21600, ge=60, le=604800)
    compress_downloaded_chapters: bool = False
    total_bytes: int = Field(default=0, ge=0)
    used_bytes: int = Field(default=0, ge=0)
    free_bytes: int = Field(default=0, ge=0)


class DownloadSettingsUpdate(SQLModel):
    root_dir: str | None = None
    parallel_downloads: int | None = Field(default=None, ge=1, le=16)
    failed_chapter_retry_delay_seconds: int | None = Field(default=None, ge=60, le=604800)
    compress_downloaded_chapters: bool | None = None


class JobsSettingsResource(SQLModel):
    cleanup_unassigned_enabled: bool = True
    cleanup_unassigned_interval_days: int = Field(default=30, ge=1, le=365)
    cleanup_unassigned_older_than_days: int = Field(default=30, ge=1, le=3650)
    cleanup_unassigned_batch_limit: int = Field(default=200, ge=1, le=5000)
    last_cleanup_at: str | None = None


class JobsSettingsUpdate(SQLModel):
    cleanup_unassigned_enabled: bool | None = None
    cleanup_unassigned_interval_days: int | None = Field(default=None, ge=1, le=365)
    cleanup_unassigned_older_than_days: int | None = Field(default=None, ge=1, le=3650)
    cleanup_unassigned_batch_limit: int | None = Field(default=None, ge=1, le=5000)


class JobsCleanupRunResource(SQLModel):
    executed: bool
    deleted_titles: int = 0
    ran_at: str | None = None
    reason: str | None = None


class FlareSolverrSettingsResource(SQLModel):
    enabled: bool = False
    url: str = "http://localhost:8191"
    timeout_seconds: int = Field(default=45, ge=5, le=300)
    response_fallback: bool = True
    session_name: str | None = None
    session_ttl_minutes: int | None = Field(default=None, ge=1, le=1440)


class FlareSolverrSettingsUpdate(SQLModel):
    enabled: bool | None = None
    url: str | None = None
    timeout_seconds: int | None = Field(default=None, ge=5, le=300)
    response_fallback: bool | None = None
    session_name: str | None = None
    session_ttl_minutes: int | None = Field(default=None, ge=1, le=1440)


class ProxySettingsResource(SQLModel):
    hostname: str = ""
    port: int = Field(default=0, ge=0, le=65535)
    username: str | None = None
    password: str | None = None
    ignored_addresses: str = ""
    bypass_local_addresses: bool = True


class ProxySettingsUpdate(SQLModel):
    hostname: str | None = None
    port: int | None = Field(default=None, ge=0, le=65535)
    username: str | None = None
    password: str | None = None
    ignored_addresses: str | None = None
    bypass_local_addresses: bool | None = None


class ContentLanguagesResource(SQLModel):
    preferred: list[str] = Field(default_factory=list)


class ContentLanguagesUpdate(SQLModel):
    preferred: list[str]


class SchedulerJobResource(SQLModel):
    name: str
    label: str
    interval_seconds: float
    paused: bool
    running: bool
    last_run_at: str | None = None
    next_run_at: str | None = None
    last_status: str | None = None
    last_duration_ms: int | None = None
    last_error: str | None = None


class BridgePageMetricsResource(SQLModel):
    page_fetch_attempts: int = 0
    page_fetch_not_found: int = 0
    page_fetch_recovery_attempts: int = 0
    page_fetch_recovered: int = 0
    page_fetch_recovery_failed: int = 0
    last_recovery_at: str | None = None


class SchedulerStatusResource(SQLModel):
    jobs: list[SchedulerJobResource]
    bridge_page_metrics: BridgePageMetricsResource | None = None
