from typing import Any, NoReturn

import grpc
from grpc.aio import AioRpcError
from loguru import logger

from app.config import settings
from app.core.errors import BridgeAPIError
from app.models import (
    ExtensionSourceTitle,
    RepoExtension,
    RepoSource,
    SourceChapter,
    SourcePreferencesResource,
    SourceTitle,
)
from .proto.mangarr.tachibridge.extensions import extensions_pb2
from .proto.mangarr.tachibridge.config import config_pb2

from .connection import TachibridgeConnection
from .process import TachibridgeProcess


class TachibridgeService:
    """
    High-level service for interacting with Tachibridge.

    Orchestrates process lifecycle and gRPC communication.
    """

    def __init__(
        self,
        process: TachibridgeProcess,
        connection: TachibridgeConnection,
    ):
        self._process = process
        self._connection = connection
        self._logger = logger.bind(module="bridge.service")

    async def start(self) -> None:
        """Start the bridge process and wait until ready."""
        if self._process.is_running():
            self._logger.debug("Bridge already running")
            return

        await self._process.start()

        try:
            await self._connection.wait_until_ready()
        except Exception:
            await self._process.stop()
            raise

    async def stop(self) -> None:
        """Stop the bridge process and close connections."""
        await self._connection.close()
        await self._process.stop()

    async def is_healthy(self) -> bool:
        """Check if the bridge is healthy."""
        return await self._connection.check_health()

    # Extension Management

    async def set_repository_url(self, url: str) -> bool:
        """Set the repository URL in the bridge via gRPC.

        Returns True if the operation succeeded, False otherwise.
        """
        try:
            stub = await self._connection.get_stub()
            request = config_pb2.SetRepoUrlRequest(url=url)
            response = await stub.SetRepoUrl(request)
            return response.success
        except AioRpcError as e:
            self._handle_grpc_error(e, "set_repository_url")

    async def fetch_repository_extensions(self) -> list[RepoExtension]:
        """Return metadata for extensions available in the remote repository."""
        try:
            stub = await self._connection.get_stub()
            request = extensions_pb2.ListRepoExtensionsRequest()
            response = await stub.ListRepoExtensions(request, timeout=30.0)

            return [self._proto_to_repo_extension(ext) for ext in response.extensions]
        except AioRpcError as e:
            self._handle_grpc_error(e, "fetch_repository_extensions")

    async def fetch_installed_sources(self) -> list[RepoSource]:
        """Return list of sources from installed extensions."""
        try:
            stub = await self._connection.get_stub()
            request = extensions_pb2.ListSourcesRequest()
            response = await stub.ListSources(request, timeout=10.0)

            return [self._proto_to_repo_source(source) for source in response.sources]
        except AioRpcError as e:
            self._handle_grpc_error(e, "fetch_installed_sources")

    async def install_extension(
        self, package: str
    ) -> tuple[RepoExtension, list[RepoSource]]:
        """Install an extension by package name."""
        try:
            stub = await self._connection.get_stub()
            request = extensions_pb2.InstallExtensionRequest(package_name=package)
            response = await stub.InstallExtension(request, timeout=180.0)

            if not response.success:
                raise BridgeAPIError(500, response.error or "Installation failed")

            extension = self._proto_to_repo_extension(response.extension)
            sources = [
                self._proto_to_repo_source(s) for s in response.extension.sources
            ]
            return extension, sources
        except AioRpcError as e:
            self._handle_grpc_error(e, "install_extension")

    async def uninstall_extension(self, package: str) -> str:
        """Uninstall an extension."""
        try:
            stub = await self._connection.get_stub()
            request = extensions_pb2.UninstallExtensionRequest(package_name=package)
            response = await stub.UninstallExtension(request, timeout=120.0)

            if not response.success:
                raise BridgeAPIError(500, response.error or "Uninstallation failed")

            return "Extension uninstalled successfully"
        except AioRpcError as e:
            self._handle_grpc_error(e, "uninstall_extension")

    async def update_extension(self, package: str) -> RepoExtension:
        """Update an installed extension."""
        try:
            stub = await self._connection.get_stub()
            request = extensions_pb2.UpdateExtensionRequest(package_name=package)
            response = await stub.UpdateExtension(request, timeout=180.0)

            if not response.success:
                raise BridgeAPIError(500, response.error or "Update failed")

            return self._proto_to_repo_extension(response.extension)
        except AioRpcError as e:
            self._handle_grpc_error(e, "update_extension")

    # Source Preferences

    async def fetch_source_preferences(
        self, source_id: str
    ) -> SourcePreferencesResource:
        """Return source with its preferences."""
        try:
            stub = await self._connection.get_stub()
            request = extensions_pb2.GetFiltersRequest(source_id=int(source_id))
            response = await stub.GetFilters(request, timeout=10.0)

            return self._proto_to_preferences(source_id, response)
        except AioRpcError as e:
            self._handle_grpc_error(e, "fetch_source_preferences")

    # Title Discovery

    async def fetch_popular_titles(
        self,
        source_id: str,
        page: int | None = None,
    ) -> tuple[list[ExtensionSourceTitle], bool]:
        """Return the list of popular titles for a source."""
        try:
            stub = await self._connection.get_stub()
            request = extensions_pb2.GetPopularTitlesRequest(
                source_id=int(source_id), page=page or 1
            )
            response = await stub.GetPopularTitles(request, timeout=30.0)

            titles = [
                self._proto_to_extension_title(title) for title in response.titles
            ]
            return titles, response.has_next_page
        except AioRpcError as e:
            self._handle_grpc_error(e, "fetch_popular_titles")

    async def fetch_latest_titles(
        self,
        source_id: str,
        page: int | None = None,
    ) -> tuple[list[ExtensionSourceTitle], bool]:
        """Return the latest title updates for a source."""
        try:
            stub = await self._connection.get_stub()
            request = extensions_pb2.GetLatestTitlesRequest(
                source_id=int(source_id), page=page or 1
            )
            response = await stub.GetLatestTitles(request, timeout=30.0)

            titles = [
                self._proto_to_extension_title(title) for title in response.titles
            ]
            return titles, response.has_next_page
        except AioRpcError as e:
            self._handle_grpc_error(e, "fetch_latest_titles")

    async def search_titles(
        self,
        source_id: str,
        query: str,
        page: int | None = None,
    ) -> tuple[list[ExtensionSourceTitle], bool]:
        """Search titles within a source."""
        try:
            stub = await self._connection.get_stub()
            request = extensions_pb2.SearchTitleRequest(
                source_id=int(source_id), query=query, page=page or 1
            )
            response = await stub.SearchTitle(request, timeout=30.0)

            titles = [
                self._proto_to_extension_title(title) for title in response.titles
            ]
            return titles, response.has_next_page
        except AioRpcError as e:
            self._handle_grpc_error(e, "search_titles")

    # Title Details

    async def fetch_title_details(
        self,
        source_id: str,
        title: SourceTitle,
    ) -> SourceTitle:
        """Return a title with details populated."""
        try:
            stub = await self._connection.get_stub()
            request = extensions_pb2.GetTitleDetailsRequest(
                source_id=int(source_id), title_url=title.url
            )
            response = await stub.GetTitleDetails(request, timeout=30.0)

            return self._proto_to_source_title(response.title)
        except AioRpcError as e:
            self._handle_grpc_error(e, "fetch_title_details")

    async def fetch_title_chapters(
        self,
        source_id: str,
        title: dict[str, Any],
    ) -> list[SourceChapter]:
        """Return all chapters for a given title."""
        try:
            stub = await self._connection.get_stub()
            request = extensions_pb2.GetChaptersListRequest(
                source_id=int(source_id), title_url=title.get("url")
            )
            response = await stub.GetChapterList(request, timeout=30.0)

            return [self._proto_to_chapter(ch) for ch in response.chapters]
        except AioRpcError as e:
            self._handle_grpc_error(e, "fetch_title_chapters")

    async def fetch_chapter_pages(
        self,
        source_id: str,
        chapter: dict[str, Any],
    ) -> list[dict[str, Any]]:
        """Return all pages for a given chapter."""
        try:
            stub = await self._connection.get_stub()
            request = extensions_pb2.GetPagesListRequest(
                source_id=int(source_id), chapter_url=chapter.get("url")
            )
            response = await stub.GetPageList(request, timeout=30.0)

            return [self._proto_to_page(page) for page in response.pages]
        except AioRpcError as e:
            self._handle_grpc_error(e, "fetch_chapter_pages")

    # Error Handling

    def _handle_grpc_error(self, error: AioRpcError, operation: str) -> NoReturn:
        """Convert gRPC errors to BridgeAPIError with context."""
        status_code = error.code()

        code_map = {
            grpc.StatusCode.NOT_FOUND: 404,
            grpc.StatusCode.INVALID_ARGUMENT: 400,
            grpc.StatusCode.ALREADY_EXISTS: 409,
            grpc.StatusCode.PERMISSION_DENIED: 403,
            grpc.StatusCode.UNAUTHENTICATED: 401,
            grpc.StatusCode.RESOURCE_EXHAUSTED: 429,
            grpc.StatusCode.UNIMPLEMENTED: 501,
            grpc.StatusCode.UNAVAILABLE: 503,
            grpc.StatusCode.DEADLINE_EXCEEDED: 504,
        }

        http_code = code_map.get(status_code, 500)
        message = f"{operation} failed: {error.details()}"
        raise BridgeAPIError(http_code, message)

    # Protobuf Converters

    def _proto_to_repo_extension(
        self, ext: extensions_pb2.ExtensionInfo
    ) -> RepoExtension:
        """Convert protobuf ExtensionInfo to RepoExtension model."""
        return RepoExtension(
            pkg=ext.pkg_name,
            name=ext.name,
            version=ext.version,
            lang=ext.lang,
            nsfw=ext.nsfw,
            sources=[self._proto_to_repo_source(s) for s in ext.sources],
            sources_has_prefs=False,
        )

    def _proto_to_repo_source(self, source: extensions_pb2.SourceInfo) -> RepoSource:
        """Convert protobuf SourceInfo to RepoSource model."""
        return RepoSource(
            id=str(source.id),
            name=source.name,
            lang=source.lang,
            supports_latest=source.supports_latest,
        )

    def _proto_to_extension_title(
        self, title: extensions_pb2.Title
    ) -> ExtensionSourceTitle:
        """Convert protobuf Title to ExtensionSourceTitle model."""
        return ExtensionSourceTitle(
            url=title.url,
            title=title.title,
            thumbnail_url=title.thumbnail_url,
            artist=title.artist,
            author=title.author,
            description=title.description,
            genre=title.genre,
            status=title.status,
        )

    def _proto_to_source_title(self, title: extensions_pb2.Title) -> SourceTitle:
        """Convert protobuf Title to SourceTitle model."""
        return SourceTitle(
            url=title.url,
            title=title.title,
            thumbnail_url=title.thumbnail_url,
            artist=title.artist,
            author=title.author,
            description=title.description,
            genre=title.genre,
            status=title.status,
        )

    def _proto_to_chapter(self, chapter: extensions_pb2.Chapter) -> SourceChapter:
        """Convert protobuf Chapter to SourceChapter model."""
        return SourceChapter(
            url=chapter.url,
            name=chapter.name,
            date_upload=chapter.date_upload,
            chapter_number=chapter.chapter_number,
            scanlator=chapter.scanlator,
        )

    def _proto_to_page(self, page: extensions_pb2.Page) -> dict[str, Any]:
        """Convert protobuf Page to dict."""
        return {
            "index": page.index,
            "url": page.url,
            "image_url": page.image_url,
        }

    def _proto_to_preferences(
        self, source_id: str, filters: extensions_pb2.FiltersResponse
    ) -> SourcePreferencesResource:
        """Convert protobuf filters to preferences."""
        return SourcePreferencesResource(
            source_id=source_id,
            filters=[
                {"name": f.name, "type": f.type, "data": f.data}
                for f in filters.filters
            ],
        )


# Factory function for easy initialization
def create_bridge_service() -> TachibridgeService:
    """Create a configured TachibridgeService instance."""
    process = TachibridgeProcess(shutdown_timeout=100.0)
    connection = TachibridgeConnection(port=settings.tachibridge.port)
    return TachibridgeService(process, connection)


# Global instance for backward compatibility
tachibridge = create_bridge_service()
