from datetime import datetime
from typing import Literal

from sqlmodel import SQLModel

from app.models.extensions import Extension, Source


class SourceSummary(SQLModel):
    id: str
    name: str
    lang: str
    supports_latest: bool | None
    extension_pkg: str
    extension_name: str

    @classmethod
    def from_models(cls, extension: Extension, source: Source) -> "SourceSummary":
        return cls(
            id=source.id,
            name=source.name,
            lang=source.lang,
            supports_latest=source.supports_latest,
            extension_pkg=extension.pkg,
            extension_name=extension.name,
        )


class ExploreSourceLink(SQLModel):
    source: SourceSummary
    title_url: str


class ExploreItem(SQLModel):
    dedupe_key: str
    title: str
    thumbnail_url: str = ""
    artist: str | None = None
    author: str | None = None
    description: str | None = None
    genre: str | None = None
    status: int = 0
    links: list[ExploreSourceLink]
    imported_library_id: int | None = None


class ExploreFeed(SQLModel):
    section: Literal["popular", "latest", "search", "category"]
    page: int
    limit: int
    query: str | None = None
    category: str | None = None
    has_next_page: bool
    items: list[ExploreItem]


class ExploreCategory(SQLModel):
    name: str
    count: int


class ExploreTitleDetailsResource(SQLModel):
    source_id: str
    title_url: str
    title: str
    status: int = 0
    thumbnail_url: str = ""
    artist: str | None = None
    author: str | None = None
    description: str | None = None
    genre: str | None = None
    fetched_at: datetime
    imported_library_id: int | None = None
