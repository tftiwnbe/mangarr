from datetime import datetime, timezone
from enum import Enum
from typing import TYPE_CHECKING, Any, ClassVar

from sqlmodel import Field, Relationship, SQLModel

if TYPE_CHECKING:
    from app.models.extensions import Source


class Page(SQLModel):
    index: int
    url: str
    image_url: str


class SourceChapter(SQLModel):
    url: str
    name: str
    date_upload: datetime
    chapter_number: float
    scanlator: str


class Status(Enum):
    UNKNOWN = 0
    ONGOING = 1
    COMPLETED = 2
    LICENSED = 3
    PUBLISHING_FINISHED = 4
    CANCELLED = 5
    ON_HIATUS = 6


class ExtensionSourceTitle(SQLModel):
    url: str = Field(primary_key=True)
    title: str
    status: Status
    thumbnail_url: str
    artist: str | None
    author: str | None
    description: str | None
    genre: str | None


class FetchedSectionPage(SQLModel, table=True):
    """Track which pages we've fetched from each source."""

    __tablename__: ClassVar[Any] = "fetched_pages"

    source_id: str = Field(primary_key=True)
    section: str = Field(primary_key=True)  # 'popular' or 'latest'
    page: int = Field(primary_key=True)
    fetched_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))
    title_count: int = Field(default=0)
    has_next_page: bool = Field(default=True)


class SourceTitle(ExtensionSourceTitle, table=True):
    __tablename__: ClassVar[Any] = "source_titles"

    source_id: str = Field(foreign_key="sources.id")
    canonical_title_id: int = Field(
        foreign_key="canonical_title.id", ondelete="CASCADE"
    )
    source: "Source" = Relationship(back_populates="titles")
    canonical_title: "CanonicalTitle" = Relationship(back_populates="sources_titles")


class CanonicalTitle(SQLModel, table=True):
    __tablename__: ClassVar[Any] = "canonical_title"

    id: int = Field(default=None, primary_key=True)
    title: str
    sources_titles: list["SourceTitle"] = Relationship(
        back_populates="canonical_title", cascade_delete=True
    )


class CanonicalTitleResource(SQLModel):
    id: int
    title: str
    source_titles: list["SourceTitle"]


class SourceTitlesListPage(SQLModel):
    pass
