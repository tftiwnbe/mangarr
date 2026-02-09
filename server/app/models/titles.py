from datetime import datetime, timezone
from enum import IntEnum

from sqlmodel import Field, SQLModel


class Page(SQLModel):
    index: int
    url: str
    image_url: str


class SourceChapter(SQLModel):
    url: str
    name: str
    date_upload: datetime = Field(
        default_factory=lambda: datetime.fromtimestamp(0, tz=timezone.utc)
    )
    chapter_number: float = 0.0
    scanlator: str = ""


class Status(IntEnum):
    UNKNOWN = 0
    ONGOING = 1
    COMPLETED = 2
    LICENSED = 3
    PUBLISHING_FINISHED = 4
    CANCELLED = 5
    ON_HIATUS = 6


class ExtensionSourceTitle(SQLModel):
    url: str
    title: str
    status: Status = Status.UNKNOWN
    thumbnail_url: str = ""
    artist: str | None = None
    author: str | None = None
    description: str | None = None
    genre: str | None = None
