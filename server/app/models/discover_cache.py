from datetime import datetime, timezone
from typing import Any, ClassVar

from sqlalchemy import UniqueConstraint
from sqlmodel import Field, SQLModel


class DiscoverCachePage(SQLModel, table=True):
    """Tracks cache freshness for one source page in one discover section."""

    __tablename__: ClassVar[Any] = "discover_cache_pages"

    section: str = Field(primary_key=True)
    source_id: str = Field(primary_key=True)
    page: int = Field(primary_key=True)
    fetched_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))
    has_next_page: bool = Field(default=False)
    item_count: int = Field(default=0)


class DiscoverCacheItem(SQLModel, table=True):
    """Cached title snapshot fetched from a source page."""

    __tablename__: ClassVar[Any] = "discover_cache_items"
    __table_args__ = (
        UniqueConstraint(
            "section",
            "source_id",
            "page",
            "rank",
            name="uq_discover_cache_items_rank",
        ),
    )

    id: int | None = Field(default=None, primary_key=True)
    section: str = Field(index=True)
    source_id: str = Field(index=True)
    page: int = Field(index=True)
    rank: int
    dedupe_key: str = Field(index=True)

    title_url: str
    title: str
    thumbnail_url: str = ""
    artist: str | None = None
    author: str | None = None
    description: str | None = None
    genre: str | None = None
    status: int = 0
    fetched_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))
