from datetime import datetime, timezone
from enum import Enum
from typing import Any, ClassVar

from sqlalchemy import UniqueConstraint
from sqlmodel import Field, SQLModel


class DownloadStrategy(str, Enum):
    NEW_ONLY = "new_only"
    ALL_UNREAD = "all_unread"


class DownloadTaskStatus(str, Enum):
    QUEUED = "queued"
    DOWNLOADING = "downloading"
    COMPLETED = "completed"
    FAILED = "failed"
    CANCELLED = "cancelled"


class DownloadTrigger(str, Enum):
    MONITOR = "monitor"
    MANUAL = "manual"


class DownloadProfile(SQLModel, table=True):
    __tablename__: ClassVar[Any] = "download_profiles"
    __table_args__ = (
        UniqueConstraint("library_title_id", name="uq_download_profile_title"),
    )

    id: int | None = Field(default=None, primary_key=True)
    library_title_id: int = Field(index=True)

    enabled: bool = Field(default=False, index=True)
    auto_download: bool = True
    strategy: DownloadStrategy = DownloadStrategy.NEW_ONLY
    preferred_variant_id: int | None = Field(default=None, index=True)

    # When set, monitor/download only chapters uploaded after this timestamp.
    start_from: datetime | None = None

    last_checked_at: datetime | None = None
    last_success_at: datetime | None = None
    last_error: str | None = None

    created_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))
    updated_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))


class DownloadTask(SQLModel, table=True):
    __tablename__: ClassVar[Any] = "download_tasks"

    id: int | None = Field(default=None, primary_key=True)

    library_title_id: int = Field(index=True)
    variant_id: int | None = Field(default=None, index=True)
    chapter_id: int = Field(index=True)

    source_id: str = Field(index=True)
    chapter_url: str
    title_name: str
    chapter_name: str

    status: DownloadTaskStatus = Field(default=DownloadTaskStatus.QUEUED, index=True)
    trigger: DownloadTrigger = DownloadTrigger.MONITOR

    priority: int = Field(default=100, index=True)
    attempts: int = 0
    max_attempts: int = 4
    available_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc), index=True)

    downloaded_pages: int = 0
    total_pages: int = 0

    output_dir: str | None = None
    error: str | None = None

    started_at: datetime | None = None
    finished_at: datetime | None = None
    created_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))
    updated_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))


class DownloadProfileResource(SQLModel):
    id: int
    library_title_id: int
    enabled: bool
    auto_download: bool
    strategy: DownloadStrategy
    preferred_variant_id: int | None
    start_from: datetime | None
    last_checked_at: datetime | None
    last_success_at: datetime | None
    last_error: str | None


class DownloadProfileUpdate(SQLModel):
    enabled: bool | None = None
    auto_download: bool | None = None
    strategy: DownloadStrategy | None = None
    preferred_variant_id: int | None = None
    start_from: datetime | None = None


class DownloadTaskResource(SQLModel):
    id: int
    library_title_id: int
    variant_id: int | None
    chapter_id: int
    source_id: str
    chapter_url: str
    title_name: str
    chapter_name: str
    status: DownloadTaskStatus
    trigger: DownloadTrigger
    priority: int
    attempts: int
    max_attempts: int
    available_at: datetime
    downloaded_pages: int
    total_pages: int
    output_dir: str | None
    error: str | None
    started_at: datetime | None
    finished_at: datetime | None
    created_at: datetime
    updated_at: datetime


class DownloadOverviewResource(SQLModel):
    monitored_titles: int
    queued: int
    downloading: int
    completed: int
    failed: int
    cancelled: int


class DownloadMonitoredTitleResource(SQLModel):
    library_title_id: int
    title: str
    thumbnail_url: str = ""
    enabled: bool
    auto_download: bool
    strategy: DownloadStrategy
    preferred_variant_id: int | None
    start_from: datetime | None
    last_checked_at: datetime | None
    last_success_at: datetime | None
    last_error: str | None
    total_chapters: int
    downloaded_chapters: int
    queued_tasks: int
    failed_tasks: int


class DownloadDashboardResource(SQLModel):
    generated_at: datetime
    overview: DownloadOverviewResource
    monitored_titles: list[DownloadMonitoredTitleResource]
    active_tasks: list["DownloadTaskResource"]
    recent_tasks: list["DownloadTaskResource"]


class EnqueueChapterResponse(SQLModel):
    task_id: int
    status: DownloadTaskStatus


class EnqueueTitleResponse(SQLModel):
    queued: int


class MonitorRunResponse(SQLModel):
    checked_titles: int
    enqueued_tasks: int


class WorkerRunResponse(SQLModel):
    processed_tasks: int
