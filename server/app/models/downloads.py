from datetime import datetime, timezone
from enum import Enum
from typing import Any, ClassVar

from sqlalchemy import UniqueConstraint
from sqlmodel import Field, Relationship, SQLModel


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
    paused: bool = Field(default=False, index=True)
    auto_download: bool = True
    strategy: DownloadStrategy = DownloadStrategy.NEW_ONLY
    preferred_variant_id: int | None = Field(default=None, index=True)
    variant_ids_json: str | None = None

    # When set, monitor/download only chapters uploaded after this timestamp.
    start_from: datetime | None = None

    last_checked_at: datetime | None = None
    last_success_at: datetime | None = None
    last_error: str | None = None

    created_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))
    updated_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))

    watch_variants: list["DownloadProfileVariant"] = Relationship(
        back_populates="profile"
    )


class DownloadProfileVariant(SQLModel, table=True):
    __tablename__: ClassVar[Any] = "download_profile_variants"
    __table_args__ = (
        UniqueConstraint(
            "profile_id", "variant_id", name="uq_download_profile_variant"
        ),
    )

    id: int | None = Field(default=None, primary_key=True)
    profile_id: int = Field(foreign_key="download_profiles.id", index=True)
    variant_id: int = Field(index=True)
    position: int = Field(default=0, index=True)
    created_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))

    profile: DownloadProfile = Relationship(back_populates="watch_variants")


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
    attempt_group_id: int | None = Field(default=None, index=True)
    retry_of_task_id: int | None = Field(default=None, index=True)

    status: DownloadTaskStatus = Field(default=DownloadTaskStatus.QUEUED, index=True)
    trigger: DownloadTrigger = DownloadTrigger.MONITOR

    priority: int = Field(default=100, index=True)
    attempts: int = 0
    max_attempts: int = 4
    available_at: datetime = Field(
        default_factory=lambda: datetime.now(timezone.utc), index=True
    )

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
    paused: bool
    auto_download: bool
    strategy: DownloadStrategy
    preferred_variant_id: int | None
    variant_ids: list[int] = Field(default_factory=list)
    start_from: datetime | None
    last_checked_at: datetime | None
    last_success_at: datetime | None
    last_error: str | None


class DownloadProfileUpdate(SQLModel):
    enabled: bool | None = None
    paused: bool | None = None
    auto_download: bool | None = None
    strategy: DownloadStrategy | None = None
    preferred_variant_id: int | None = None
    variant_ids: list[int] | None = None
    start_from: datetime | None = None


class DownloadTaskResource(SQLModel):
    id: int
    attempt_group_id: int | None
    retry_of_task_id: int | None
    library_title_id: int
    variant_id: int | None
    chapter_id: int
    source_id: str
    is_paused: bool = False
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
    watched_titles: int
    queued: int
    downloading: int
    completed: int
    failed: int
    cancelled: int
    downloaded_chapters: int = 0
    total_downloaded_bytes: int = 0
    avg_chapter_size_bytes: int = 0
    free_disk_bytes: int = 0
    estimated_chapters_fit: int = 0


class DownloadWatchedTitleResource(SQLModel):
    library_title_id: int
    title: str
    thumbnail_url: str = ""
    enabled: bool
    paused: bool = False
    auto_download: bool
    strategy: DownloadStrategy
    preferred_variant_id: int | None
    variant_ids: list[int] = Field(default_factory=list)
    variant_sources: list[str] = Field(default_factory=list)
    start_from: datetime | None
    last_checked_at: datetime | None
    last_success_at: datetime | None
    last_error: str | None
    total_chapters: int
    downloaded_chapters: int
    queued_tasks: int
    failed_tasks: int
    downloaded_bytes: int = 0
    avg_chapter_size_bytes: int = 0


class DownloadDashboardResource(SQLModel):
    generated_at: datetime
    overview: DownloadOverviewResource
    watched_titles: list[DownloadWatchedTitleResource]
    active_tasks: list["DownloadTaskResource"]
    recent_tasks: list["DownloadTaskResource"]


class EnqueueChapterResponse(SQLModel):
    task_id: int
    status: DownloadTaskStatus


class EnqueueTitleResponse(SQLModel):
    queued: int


class WatchRunResponse(SQLModel):
    checked_titles: int
    enqueued_tasks: int


class WorkerRunResponse(SQLModel):
    processed_tasks: int


class DownloadExternalTitleResource(SQLModel):
    key: str
    source_id: str | None = None
    source_name: str
    source_lang: str | None = None
    title: str
    title_url: str | None = None
    path: str
    chapters_count: int
    in_library: bool
    importable: bool
    reason: str | None = None


class DownloadReconcileResource(SQLModel):
    scanned_at: datetime
    reconciled_missing_chapters: int
    external_titles: list[DownloadExternalTitleResource]


class DownloadExternalImportRequest(SQLModel):
    source_id: str | None = None
    title: str
    title_url: str | None = None
    path: str | None = None


class DownloadExternalImportResponse(SQLModel):
    library_title_id: int
    created: bool
    source_id: str
    title_url: str
    linked_downloaded_chapters: int = 0
