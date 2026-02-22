from sqlmodel import Field, SQLModel


class DownloadSettingsResource(SQLModel):
    root_dir: str
    parallel_downloads: int = Field(default=1, ge=1, le=16)
    total_bytes: int = Field(default=0, ge=0)
    used_bytes: int = Field(default=0, ge=0)
    free_bytes: int = Field(default=0, ge=0)


class DownloadSettingsUpdate(SQLModel):
    root_dir: str | None = None
    parallel_downloads: int | None = Field(default=None, ge=1, le=16)


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
