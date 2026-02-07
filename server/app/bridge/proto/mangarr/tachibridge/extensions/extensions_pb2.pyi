from google.protobuf.internal import containers as _containers
from google.protobuf import descriptor as _descriptor
from google.protobuf import message as _message
from collections.abc import Iterable as _Iterable, Mapping as _Mapping
from typing import ClassVar as _ClassVar, Optional as _Optional, Union as _Union

DESCRIPTOR: _descriptor.FileDescriptor

class Title(_message.Message):
    __slots__ = ("url", "title", "artist", "author", "description", "genre", "status", "thumbnail_url", "initialized")
    URL_FIELD_NUMBER: _ClassVar[int]
    TITLE_FIELD_NUMBER: _ClassVar[int]
    ARTIST_FIELD_NUMBER: _ClassVar[int]
    AUTHOR_FIELD_NUMBER: _ClassVar[int]
    DESCRIPTION_FIELD_NUMBER: _ClassVar[int]
    GENRE_FIELD_NUMBER: _ClassVar[int]
    STATUS_FIELD_NUMBER: _ClassVar[int]
    THUMBNAIL_URL_FIELD_NUMBER: _ClassVar[int]
    INITIALIZED_FIELD_NUMBER: _ClassVar[int]
    url: str
    title: str
    artist: str
    author: str
    description: str
    genre: str
    status: int
    thumbnail_url: str
    initialized: bool
    def __init__(self, url: _Optional[str] = ..., title: _Optional[str] = ..., artist: _Optional[str] = ..., author: _Optional[str] = ..., description: _Optional[str] = ..., genre: _Optional[str] = ..., status: _Optional[int] = ..., thumbnail_url: _Optional[str] = ..., initialized: bool = ...) -> None: ...

class Chapter(_message.Message):
    __slots__ = ("url", "name", "date_upload", "chapter_number", "scanlator")
    URL_FIELD_NUMBER: _ClassVar[int]
    NAME_FIELD_NUMBER: _ClassVar[int]
    DATE_UPLOAD_FIELD_NUMBER: _ClassVar[int]
    CHAPTER_NUMBER_FIELD_NUMBER: _ClassVar[int]
    SCANLATOR_FIELD_NUMBER: _ClassVar[int]
    url: str
    name: str
    date_upload: int
    chapter_number: float
    scanlator: str
    def __init__(self, url: _Optional[str] = ..., name: _Optional[str] = ..., date_upload: _Optional[int] = ..., chapter_number: _Optional[float] = ..., scanlator: _Optional[str] = ...) -> None: ...

class Page(_message.Message):
    __slots__ = ("index", "url", "image_url")
    INDEX_FIELD_NUMBER: _ClassVar[int]
    URL_FIELD_NUMBER: _ClassVar[int]
    IMAGE_URL_FIELD_NUMBER: _ClassVar[int]
    index: int
    url: str
    image_url: str
    def __init__(self, index: _Optional[int] = ..., url: _Optional[str] = ..., image_url: _Optional[str] = ...) -> None: ...

class Filter(_message.Message):
    __slots__ = ("name", "type", "data")
    NAME_FIELD_NUMBER: _ClassVar[int]
    TYPE_FIELD_NUMBER: _ClassVar[int]
    DATA_FIELD_NUMBER: _ClassVar[int]
    name: str
    type: str
    data: str
    def __init__(self, name: _Optional[str] = ..., type: _Optional[str] = ..., data: _Optional[str] = ...) -> None: ...

class SourceInfo(_message.Message):
    __slots__ = ("id", "name", "lang", "is_nsfw", "supports_latest")
    ID_FIELD_NUMBER: _ClassVar[int]
    NAME_FIELD_NUMBER: _ClassVar[int]
    LANG_FIELD_NUMBER: _ClassVar[int]
    IS_NSFW_FIELD_NUMBER: _ClassVar[int]
    SUPPORTS_LATEST_FIELD_NUMBER: _ClassVar[int]
    id: int
    name: str
    lang: str
    is_nsfw: bool
    supports_latest: bool
    def __init__(self, id: _Optional[int] = ..., name: _Optional[str] = ..., lang: _Optional[str] = ..., is_nsfw: bool = ..., supports_latest: bool = ...) -> None: ...

class ExtensionInfo(_message.Message):
    __slots__ = ("pkg_name", "name", "version", "lang", "nsfw", "sources")
    PKG_NAME_FIELD_NUMBER: _ClassVar[int]
    NAME_FIELD_NUMBER: _ClassVar[int]
    VERSION_FIELD_NUMBER: _ClassVar[int]
    LANG_FIELD_NUMBER: _ClassVar[int]
    NSFW_FIELD_NUMBER: _ClassVar[int]
    SOURCES_FIELD_NUMBER: _ClassVar[int]
    pkg_name: str
    name: str
    version: str
    lang: str
    nsfw: bool
    sources: _containers.RepeatedCompositeFieldContainer[SourceInfo]
    def __init__(self, pkg_name: _Optional[str] = ..., name: _Optional[str] = ..., version: _Optional[str] = ..., lang: _Optional[str] = ..., nsfw: bool = ..., sources: _Optional[_Iterable[_Union[SourceInfo, _Mapping]]] = ...) -> None: ...

class ListSourcesRequest(_message.Message):
    __slots__ = ()
    def __init__(self) -> None: ...

class ListSourcesResponse(_message.Message):
    __slots__ = ("sources",)
    SOURCES_FIELD_NUMBER: _ClassVar[int]
    sources: _containers.RepeatedCompositeFieldContainer[SourceInfo]
    def __init__(self, sources: _Optional[_Iterable[_Union[SourceInfo, _Mapping]]] = ...) -> None: ...

class SearchTitleRequest(_message.Message):
    __slots__ = ("source_id", "query", "page")
    SOURCE_ID_FIELD_NUMBER: _ClassVar[int]
    QUERY_FIELD_NUMBER: _ClassVar[int]
    PAGE_FIELD_NUMBER: _ClassVar[int]
    source_id: int
    query: str
    page: int
    def __init__(self, source_id: _Optional[int] = ..., query: _Optional[str] = ..., page: _Optional[int] = ...) -> None: ...

class TitlesPageResponse(_message.Message):
    __slots__ = ("titles", "has_next_page")
    TITLES_FIELD_NUMBER: _ClassVar[int]
    HAS_NEXT_PAGE_FIELD_NUMBER: _ClassVar[int]
    titles: _containers.RepeatedCompositeFieldContainer[Title]
    has_next_page: bool
    def __init__(self, titles: _Optional[_Iterable[_Union[Title, _Mapping]]] = ..., has_next_page: bool = ...) -> None: ...

class GetPopularTitlesRequest(_message.Message):
    __slots__ = ("source_id", "page")
    SOURCE_ID_FIELD_NUMBER: _ClassVar[int]
    PAGE_FIELD_NUMBER: _ClassVar[int]
    source_id: int
    page: int
    def __init__(self, source_id: _Optional[int] = ..., page: _Optional[int] = ...) -> None: ...

class GetLatestTitlesRequest(_message.Message):
    __slots__ = ("source_id", "page")
    SOURCE_ID_FIELD_NUMBER: _ClassVar[int]
    PAGE_FIELD_NUMBER: _ClassVar[int]
    source_id: int
    page: int
    def __init__(self, source_id: _Optional[int] = ..., page: _Optional[int] = ...) -> None: ...

class GetTitleDetailsRequest(_message.Message):
    __slots__ = ("source_id", "title_url")
    SOURCE_ID_FIELD_NUMBER: _ClassVar[int]
    TITLE_URL_FIELD_NUMBER: _ClassVar[int]
    source_id: int
    title_url: str
    def __init__(self, source_id: _Optional[int] = ..., title_url: _Optional[str] = ...) -> None: ...

class TitleResponse(_message.Message):
    __slots__ = ("title",)
    TITLE_FIELD_NUMBER: _ClassVar[int]
    title: Title
    def __init__(self, title: _Optional[_Union[Title, _Mapping]] = ...) -> None: ...

class GetChaptersListRequest(_message.Message):
    __slots__ = ("source_id", "title_url")
    SOURCE_ID_FIELD_NUMBER: _ClassVar[int]
    TITLE_URL_FIELD_NUMBER: _ClassVar[int]
    source_id: int
    title_url: str
    def __init__(self, source_id: _Optional[int] = ..., title_url: _Optional[str] = ...) -> None: ...

class ChaptersListResponse(_message.Message):
    __slots__ = ("chapters",)
    CHAPTERS_FIELD_NUMBER: _ClassVar[int]
    chapters: _containers.RepeatedCompositeFieldContainer[Chapter]
    def __init__(self, chapters: _Optional[_Iterable[_Union[Chapter, _Mapping]]] = ...) -> None: ...

class GetPagesListRequest(_message.Message):
    __slots__ = ("source_id", "chapter_url")
    SOURCE_ID_FIELD_NUMBER: _ClassVar[int]
    CHAPTER_URL_FIELD_NUMBER: _ClassVar[int]
    source_id: int
    chapter_url: str
    def __init__(self, source_id: _Optional[int] = ..., chapter_url: _Optional[str] = ...) -> None: ...

class PagesListResponse(_message.Message):
    __slots__ = ("pages",)
    PAGES_FIELD_NUMBER: _ClassVar[int]
    pages: _containers.RepeatedCompositeFieldContainer[Page]
    def __init__(self, pages: _Optional[_Iterable[_Union[Page, _Mapping]]] = ...) -> None: ...

class GetFiltersRequest(_message.Message):
    __slots__ = ("source_id",)
    SOURCE_ID_FIELD_NUMBER: _ClassVar[int]
    source_id: int
    def __init__(self, source_id: _Optional[int] = ...) -> None: ...

class FiltersResponse(_message.Message):
    __slots__ = ("filters",)
    FILTERS_FIELD_NUMBER: _ClassVar[int]
    filters: _containers.RepeatedCompositeFieldContainer[Filter]
    def __init__(self, filters: _Optional[_Iterable[_Union[Filter, _Mapping]]] = ...) -> None: ...

class SetPreferenceRequest(_message.Message):
    __slots__ = ("source_id", "key", "value")
    SOURCE_ID_FIELD_NUMBER: _ClassVar[int]
    KEY_FIELD_NUMBER: _ClassVar[int]
    VALUE_FIELD_NUMBER: _ClassVar[int]
    source_id: int
    key: str
    value: str
    def __init__(self, source_id: _Optional[int] = ..., key: _Optional[str] = ..., value: _Optional[str] = ...) -> None: ...

class SetPreferenceResponse(_message.Message):
    __slots__ = ("success", "error")
    SUCCESS_FIELD_NUMBER: _ClassVar[int]
    ERROR_FIELD_NUMBER: _ClassVar[int]
    success: bool
    error: str
    def __init__(self, success: bool = ..., error: _Optional[str] = ...) -> None: ...

class InstallExtensionRequest(_message.Message):
    __slots__ = ("package_name",)
    PACKAGE_NAME_FIELD_NUMBER: _ClassVar[int]
    package_name: str
    def __init__(self, package_name: _Optional[str] = ...) -> None: ...

class InstallExtensionResponse(_message.Message):
    __slots__ = ("success", "extension", "error")
    SUCCESS_FIELD_NUMBER: _ClassVar[int]
    EXTENSION_FIELD_NUMBER: _ClassVar[int]
    ERROR_FIELD_NUMBER: _ClassVar[int]
    success: bool
    extension: ExtensionInfo
    error: str
    def __init__(self, success: bool = ..., extension: _Optional[_Union[ExtensionInfo, _Mapping]] = ..., error: _Optional[str] = ...) -> None: ...

class UninstallExtensionRequest(_message.Message):
    __slots__ = ("package_name",)
    PACKAGE_NAME_FIELD_NUMBER: _ClassVar[int]
    package_name: str
    def __init__(self, package_name: _Optional[str] = ...) -> None: ...

class UninstallExtensionResponse(_message.Message):
    __slots__ = ("success", "error")
    SUCCESS_FIELD_NUMBER: _ClassVar[int]
    ERROR_FIELD_NUMBER: _ClassVar[int]
    success: bool
    error: str
    def __init__(self, success: bool = ..., error: _Optional[str] = ...) -> None: ...

class UpdateExtensionRequest(_message.Message):
    __slots__ = ("package_name",)
    PACKAGE_NAME_FIELD_NUMBER: _ClassVar[int]
    package_name: str
    def __init__(self, package_name: _Optional[str] = ...) -> None: ...

class ListRepoExtensionsRequest(_message.Message):
    __slots__ = ()
    def __init__(self) -> None: ...

class ListRepoExtensionsResponse(_message.Message):
    __slots__ = ("extensions",)
    EXTENSIONS_FIELD_NUMBER: _ClassVar[int]
    extensions: _containers.RepeatedCompositeFieldContainer[ExtensionInfo]
    def __init__(self, extensions: _Optional[_Iterable[_Union[ExtensionInfo, _Mapping]]] = ...) -> None: ...
