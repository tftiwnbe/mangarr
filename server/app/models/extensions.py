from enum import Enum
from typing import TYPE_CHECKING, Any, ClassVar

from pydantic import HttpUrl, model_validator
from sqlmodel import Field, Relationship, SQLModel

if TYPE_CHECKING:
    from app.models.titles import SourceTitle


class PreferenceType(str, Enum):
    list = "list"
    toggle = "toggle"
    multi_select = "multi_select"
    text = "text"


class RepositoryUpdate(SQLModel):
    url: HttpUrl


class SourcePreference(SQLModel):
    key: str
    title: str
    summary: str | None
    type: PreferenceType
    enabled: bool
    visible: bool
    default_value: Any | None = None
    current_value: Any | None = None
    entries: list[str] | None = None
    entry_values: list[str] | None = None
    dialog_title: str | None = None
    dialog_message: str | None = None

    @model_validator(mode="before")
    def coerce_current_value(cls, values):
        cv = values.get("current_value")
        if isinstance(cv, str):
            if cv.lower() == "true":
                values["current_value"] = True
            elif cv.lower() == "false":
                values["current_value"] = False
        return values


class RepoSource(SQLModel):
    id: str = Field(primary_key=True)
    name: str
    lang: str
    base_url: str | None = None
    supports_latest: bool | None


class ExtensionBase(SQLModel):
    pkg: str = Field(primary_key=True)
    name: str
    lang: str
    version: str
    nsfw: bool
    sources_has_prefs: bool


class RepoExtension(ExtensionBase):
    sources: list[RepoSource]


class RepoExtensionResource(ExtensionBase):
    icon: str
    installed: bool


class Extension(ExtensionBase, table=True):
    __tablename__: ClassVar[Any] = "extensions"

    icon: str
    priority: int | None = Field(default=False)
    installed: bool = Field(default=False)
    use_proxy: bool = Field(default=False)

    sources: list["Source"] = Relationship(back_populates="extension")


class Source(RepoSource, table=True):
    __tablename__: ClassVar[Any] = "sources"

    extension_pkg: str = Field(primary_key=True, foreign_key="extensions.pkg")
    enabled: bool = Field(default=False)

    extension: Extension = Relationship(back_populates="sources")
    titles: list["SourceTitle"] = Relationship(back_populates="source")


class SourcePreferencesResource(SQLModel):
    source_id: str
    name: str
    lang: str
    preferences: list[SourcePreference]


class ExtensionResource(ExtensionBase):
    icon: str
    priority: int
    installed: bool
    use_proxy: bool
    sources: list["Source"]


class UpdateSource(SQLModel):
    enabled: bool | None = None
    supports_latest: bool | None = None


class UpdateExtension(SQLModel):
    sources_has_prefs: bool | None = None
    priority: int | None = None
    installed: bool | None = None
    use_proxy: bool | None = None
