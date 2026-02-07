from datetime import datetime
from typing import Any, ClassVar

from sqlalchemy import Column
from sqlmodel import DateTime, Field, SQLModel, text


class PersistentCacheEntry(SQLModel, table=True):
    __tablename__: ClassVar[Any] = "persistent_cache"

    key: str = Field(primary_key=True)
    data: str
    expires_at: datetime | None = Field(
        sa_column=Column(
            DateTime(timezone=True),
            server_default=text("NULL"),
            default=None,
            index=True,
        )
    )
