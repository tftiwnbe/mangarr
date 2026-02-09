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


class DiscoverSourceLink(SQLModel):
    source: SourceSummary
    title_url: str


class DiscoverItem(SQLModel):
    dedupe_key: str
    title: str
    thumbnail_url: str = ""
    artist: str | None = None
    author: str | None = None
    description: str | None = None
    genre: str | None = None
    status: int = 0
    links: list[DiscoverSourceLink]
    imported_library_id: int | None = None


class DiscoverFeed(SQLModel):
    section: Literal["popular", "latest", "search", "category"]
    page: int
    limit: int
    query: str | None = None
    category: str | None = None
    has_next_page: bool
    items: list[DiscoverItem]


class DiscoverCategory(SQLModel):
    name: str
    count: int

