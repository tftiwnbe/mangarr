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
    preferred_variant_id: int | None = Field(default=None, index=True)
    user_status_id: int | None = Field(default=None, index=True)
    user_rating: float | None = None
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
    reader_page_index: int | None = Field(default=None, index=True)
    reader_comment: str | None = None
    reader_updated_at: datetime | None = None

    created_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))
    updated_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))
    last_synced_at: datetime | None = None

    library_title: LibraryTitle = Relationship(back_populates="chapters")
    variant: LibraryTitleVariant = Relationship(back_populates="chapters")
    pages: list["LibraryChapterPage"] = Relationship(back_populates="chapter")
    comments: list["LibraryChapterComment"] = Relationship(back_populates="chapter")


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


class LibraryChapterComment(SQLModel, table=True):
    __tablename__: ClassVar[Any] = "library_chapter_comments"

    id: int | None = Field(default=None, primary_key=True)
    chapter_id: int = Field(foreign_key="library_chapters.id", index=True)
    page_index: int = Field(default=0, ge=0)
    message: str
    created_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))
    updated_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))

    chapter: LibraryChapter = Relationship(back_populates="comments")


class LibraryTitleSummary(SQLModel):
    id: int
    title: str
    thumbnail_url: str = ""
    status: int = 0
    user_status: "LibraryUserStatusResource | None" = None
    user_rating: float | None = None
    collections: list["LibraryCollectionSummary"] = []
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
    description: str | None = None
    artist: str | None = None
    author: str | None = None
    genre: str | None = None
    status: int = 0


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
    preferred_variant_id: int | None = None
    user_status: "LibraryUserStatusResource | None" = None
    user_rating: float | None = None
    collections: list["LibraryCollectionSummary"] = []
    monitoring_enabled: bool = False
    monitoring_variant_ids: list[int] = []
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
    reader_page_index: int | None = None
    reader_updated_at: datetime | None = None


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
    reader_page_index: int | None = None
    reader_comment: str | None = None
    reader_updated_at: datetime | None = None
    pages: list[ReaderPageResource]


class LibraryChapterProgressResource(SQLModel):
    chapter_id: int
    page_index: int | None = None
    comment: str | None = None
    updated_at: datetime | None = None


class LibraryChapterProgressUpdate(SQLModel):
    page_index: int | None = Field(default=None, ge=0)
    comment: str | None = None


class LibraryChapterCommentResource(SQLModel):
    id: int
    chapter_id: int
    library_title_id: int
    variant_id: int
    chapter_name: str
    chapter_number: float
    page_index: int
    message: str
    created_at: datetime
    updated_at: datetime


class LibraryChapterCommentCreate(SQLModel):
    page_index: int = Field(default=0, ge=0)
    message: str


class LibraryChapterCommentUpdate(SQLModel):
    page_index: int | None = Field(default=None, ge=0)
    message: str | None = None


class LibraryImportRequest(SQLModel):
    source_id: str
    title_url: str


class LibraryImportResponse(SQLModel):
    library_title_id: int
    created: bool


class LibrarySourceMatchResource(SQLModel):
    source_id: str
    source_name: str
    source_lang: str | None = None
    title_url: str
    title: str
    thumbnail_url: str = ""
    artist: str | None = None
    author: str | None = None
    score: float = 0.0
    already_linked: bool = False
    linked_library_title_id: int | None = None


class LibraryLinkVariantRequest(SQLModel):
    source_id: str
    title_url: str


class LibraryLinkVariantResponse(SQLModel):
    library_title_id: int
    variant: LibraryTitleVariantResource
    created: bool


class LibraryMergeTitlesRequest(SQLModel):
    source_title_id: int


class LibraryMergeTitlesResponse(SQLModel):
    library_title_id: int
    merged_title_id: int
    moved_variants: int = 0
    moved_chapters: int = 0


class LibraryUserStatus(SQLModel, table=True):
    __tablename__: ClassVar[Any] = "library_user_statuses"

    id: int | None = Field(default=None, primary_key=True)
    key: str = Field(index=True, unique=True)
    label: str
    color: str = "#71717a"
    position: int = 0
    is_default: bool = False
    created_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))
    updated_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))


class LibraryUserStatusResource(SQLModel):
    id: int
    key: str
    label: str
    color: str
    position: int
    is_default: bool


class LibraryUserStatusCreate(SQLModel):
    label: str
    key: str | None = None
    color: str = "#71717a"
    position: int | None = None


class LibraryUserStatusUpdate(SQLModel):
    label: str | None = None
    key: str | None = None
    color: str | None = None
    position: int | None = None


class LibraryCollection(SQLModel, table=True):
    __tablename__: ClassVar[Any] = "library_collections"

    id: int | None = Field(default=None, primary_key=True)
    name: str = Field(index=True, unique=True)
    description: str | None = None
    color: str = "#6366f1"
    position: int = 0
    created_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))
    updated_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))


class LibraryCollectionTitle(SQLModel, table=True):
    __tablename__: ClassVar[Any] = "library_collection_titles"
    __table_args__ = (
        UniqueConstraint("collection_id", "library_title_id", name="uq_collection_title"),
    )

    id: int | None = Field(default=None, primary_key=True)
    collection_id: int = Field(foreign_key="library_collections.id", index=True)
    library_title_id: int = Field(foreign_key="library_titles.id", index=True)
    created_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))


class LibraryCollectionSummary(SQLModel):
    id: int
    name: str
    color: str


class LibraryCollectionResource(SQLModel):
    id: int
    name: str
    description: str | None = None
    color: str
    position: int
    titles_count: int = 0


class LibraryCollectionCreate(SQLModel):
    name: str
    description: str | None = None
    color: str = "#6366f1"
    position: int | None = None


class LibraryCollectionUpdate(SQLModel):
    name: str | None = None
    description: str | None = None
    color: str | None = None
    position: int | None = None


class LibraryTitlePreferencesUpdate(SQLModel):
    preferred_variant_id: int | None = None
    user_status_id: int | None = None
    user_rating: float | None = Field(default=None, ge=0, le=5)
    monitoring_enabled: bool | None = None
    monitoring_variant_ids: list[int] | None = None
    collection_ids: list[int] | None = None
