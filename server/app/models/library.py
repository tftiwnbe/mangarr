from datetime import datetime, timezone
from typing import Any, ClassVar

from sqlalchemy import UniqueConstraint
from sqlmodel import Field, Relationship, SQLModel


class LibraryTitle(SQLModel, table=True):
    """Canonical title saved in user library."""

    __tablename__: ClassVar[Any] = "library_titles"

    id: int | None = Field(default=None, primary_key=True)
    canonical_key: str = Field(index=True)
    title: str
    thumbnail_url: str = ""
    description: str | None = None
    artist: str | None = None
    author: str | None = None
    genre: str | None = None
    status: int = 0
    created_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))
    updated_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))
    last_refreshed_at: datetime | None = None

    variants: list["LibraryTitleVariant"] = Relationship(back_populates="library_title")
    chapters: list["LibraryChapter"] = Relationship(back_populates="library_title")


class LibraryTitleVariant(SQLModel, table=True):
    """One source-specific variant linked to canonical library title."""

    __tablename__: ClassVar[Any] = "library_title_variants"
    __table_args__ = (
        UniqueConstraint("source_id", "title_url", name="uq_library_variant_source_title"),
    )

    id: int | None = Field(default=None, primary_key=True)
    library_title_id: int = Field(foreign_key="library_titles.id", index=True)

    source_id: str = Field(index=True)
    source_name: str | None = None
    source_lang: str | None = None
    title_url: str

    title: str
    thumbnail_url: str = ""
    description: str | None = None
    artist: str | None = None
    author: str | None = None
    genre: str | None = None
    status: int = 0

    created_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))
    updated_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))
    last_synced_at: datetime | None = None

    library_title: LibraryTitle = Relationship(back_populates="variants")
    chapters: list["LibraryChapter"] = Relationship(back_populates="variant")


class LibraryChapter(SQLModel, table=True):
    """Persisted chapter list for a library title variant."""

    __tablename__: ClassVar[Any] = "library_chapters"
    __table_args__ = (
        UniqueConstraint("variant_id", "chapter_url", name="uq_library_chapter_variant_url"),
    )

    id: int | None = Field(default=None, primary_key=True)
    library_title_id: int = Field(foreign_key="library_titles.id", index=True)
    variant_id: int = Field(foreign_key="library_title_variants.id", index=True)

    chapter_url: str
    name: str
    chapter_number: float = 0.0
    scanlator: str | None = None
    date_upload: datetime = Field(default_factory=lambda: datetime.fromtimestamp(0, tz=timezone.utc))
    position: int = 0

    is_read: bool = Field(default=False, index=True)
    is_downloaded: bool = Field(default=False, index=True)
    downloaded_at: datetime | None = None
    download_path: str | None = None
    download_error: str | None = None

    created_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))
    updated_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))
    last_synced_at: datetime | None = None

    library_title: LibraryTitle = Relationship(back_populates="chapters")
    variant: LibraryTitleVariant = Relationship(back_populates="chapters")
    pages: list["LibraryChapterPage"] = Relationship(back_populates="chapter")


class LibraryChapterPage(SQLModel, table=True):
    """Cached pages for a chapter, fetched on demand for reader."""

    __tablename__: ClassVar[Any] = "library_chapter_pages"
    __table_args__ = (
        UniqueConstraint("chapter_id", "page_index", name="uq_library_page_chapter_index"),
    )

    id: int | None = Field(default=None, primary_key=True)
    chapter_id: int = Field(foreign_key="library_chapters.id", index=True)
    page_index: int

    url: str
    image_url: str = ""
    local_path: str | None = None
    local_size: int | None = None
    fetched_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))

    chapter: LibraryChapter = Relationship(back_populates="pages")


class LibraryTitleSummary(SQLModel):
    id: int
    title: str
    thumbnail_url: str = ""
    status: int = 0
    variants_count: int = 0
    chapters_count: int = 0


class LibraryTitleVariantResource(SQLModel):
    id: int
    source_id: str
    source_name: str | None = None
    source_lang: str | None = None
    title_url: str
    title: str
    thumbnail_url: str = ""


class LibraryTitleResource(SQLModel):
    id: int
    canonical_key: str
    title: str
    thumbnail_url: str = ""
    description: str | None = None
    artist: str | None = None
    author: str | None = None
    genre: str | None = None
    status: int = 0
    variants: list[LibraryTitleVariantResource]


class LibraryChapterResource(SQLModel):
    id: int
    variant_id: int
    chapter_url: str
    name: str
    chapter_number: float
    scanlator: str | None
    date_upload: datetime
    is_read: bool
    is_downloaded: bool
    downloaded_at: datetime | None
    download_path: str | None
    download_error: str | None


class LibraryChapterPageResource(SQLModel):
    id: int
    page_index: int
    url: str
    image_url: str
    local_path: str | None
    local_size: int | None


class ReaderPageResource(SQLModel):
    id: int
    page_index: int
    src: str
    is_local: bool
    local_path: str | None
    remote_url: str
    local_size: int | None


class LibraryReaderChapterResource(SQLModel):
    chapter_id: int
    library_title_id: int
    variant_id: int
    is_downloaded: bool
    prev_chapter_id: int | None
    next_chapter_id: int | None
    pages: list[ReaderPageResource]


class LibraryImportRequest(SQLModel):
    source_id: str
    title_url: str


class LibraryImportResponse(SQLModel):
    library_title_id: int
    created: bool
