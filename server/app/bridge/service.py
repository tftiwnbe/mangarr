import asyncio
import json
import re
from datetime import UTC, datetime
from typing import Any, NoReturn

import grpc
from grpc.aio import AioRpcError
from loguru import logger

from app.config import settings
from app.core.errors import BridgeAPIError
from app.models import (
    ExtensionSourceTitle,
    Page,
    PreferenceType,
    RepoExtension,
    RepoSource,
    SourcePreference,
    SourceChapter,
    SourcePreferencesResource,
)
from .proto.mangarr.tachibridge.extensions import extensions_pb2
from .proto.mangarr.tachibridge.config import config_pb2

from .connection import TachibridgeConnection
from .process import TachibridgeProcess

SOURCE_RPC_TIMEOUT_SECONDS = 90.0
DELETE_PREFERENCE_MARKER = "__mangarr_delete_preference__"


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

        port = settings.tachibridge.port
        await self._process.start()

        try:
            await self._wait_until_ready_or_exit()
            await self._ensure_process_stable()
        except Exception as exc:
            self._logger.exception("Bridge startup failed on port {}", port)
            await self._process.stop()
            raise RuntimeError(
                f"Bridge failed to start on port {port}. "
                "Ensure the port is free or reconfigure MANGARR__TACHIBRIDGE__PORT."
            ) from exc

    async def stop(self) -> None:
        """Stop the bridge process and close connections."""
        await self._connection.close()
        await self._process.stop()

    async def is_healthy(self, timeout: float = 2.0) -> bool:
        """Check if the bridge is healthy."""
        if not self._process.is_running():
            return False
        return await self._connection.check_health(timeout=timeout)

    async def _ensure_process_stable(self, grace_period: float = 2.0) -> None:
        """Ensure the launched process survives initial startup window."""
        loop = asyncio.get_running_loop()
        deadline = loop.time() + grace_period
        while loop.time() < deadline:
            if not self._process.is_running():
                raise RuntimeError(
                    "Bridge process exited during startup. "
                    "Check bridge logs for bind/runtime errors."
                )
            await asyncio.sleep(0.1)

    async def _wait_until_ready_or_exit(
        self,
        timeout: float = 15.0,
        kcef_download_timeout: float = 300.0,
        interval: float = 0.3,
    ) -> None:
        """Wait for bridge readiness, aborting early if process exits.

        Extends timeout automatically when KCEF download is detected.
        """
        loop = asyncio.get_running_loop()
        start_time = loop.time()
        current_timeout = timeout
        kcef_download_logged = False

        while (loop.time() - start_time) < current_timeout:
            if not self._process.is_running():
                raise RuntimeError(
                    "Bridge process exited during startup. "
                    "Check bridge logs for bind/runtime errors."
                )

            # Extend timeout if KCEF is downloading
            if self._process.is_kcef_downloading():
                if not kcef_download_logged:
                    self._logger.info(
                        "KCEF download in progress, extending startup timeout to {}s",
                        kcef_download_timeout,
                    )
                    kcef_download_logged = True
                current_timeout = kcef_download_timeout

            if await self._connection.check_health(timeout=1.0):
                self._logger.info("Bridge ready at {}", self._connection.address)
                return

            await asyncio.sleep(interval)

        raise RuntimeError(
            f"Timed out waiting for bridge readiness after {current_timeout:.1f}s"
        )

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

    async def fetch_flaresolverr_config(self) -> dict[str, Any]:
        """Return current FlareSolverr config from bridge."""
        try:
            stub = await self._connection.get_stub()
            request = config_pb2.GetFlareSolverrConfigRequest()
            response = await stub.GetFlareSolverrConfig(request, timeout=10.0)
            config = response.config
            return {
                "enabled": bool(config.enabled),
                "url": config.url,
                "timeout_seconds": int(config.timeout_seconds),
                "response_fallback": bool(config.response_fallback),
                "session_name": (
                    config.session_name if config.HasField("session_name") else None
                ),
                "session_ttl_minutes": (
                    int(config.session_ttl_minutes)
                    if config.HasField("session_ttl_minutes")
                    else None
                ),
            }
        except AioRpcError as e:
            self._handle_grpc_error(e, "fetch_flaresolverr_config")

    async def set_flaresolverr_config(
        self,
        *,
        enabled: bool,
        url: str,
        timeout_seconds: int,
        response_fallback: bool,
        session_name: str | None,
        session_ttl_minutes: int | None,
    ) -> bool:
        """Set FlareSolverr config in bridge."""
        try:
            stub = await self._connection.get_stub()
            flare_config = config_pb2.FlareSolverrConfig(
                enabled=enabled,
                url=url,
                timeout_seconds=timeout_seconds,
                response_fallback=response_fallback,
            )
            if session_name is not None:
                flare_config.session_name = session_name
            if session_ttl_minutes is not None:
                flare_config.session_ttl_minutes = session_ttl_minutes

            request = config_pb2.SetFlareSolverrConfigRequest(config=flare_config)
            response = await stub.SetFlareSolverrConfig(request, timeout=10.0)
            if not response.success:
                raise BridgeAPIError(500, response.error or "Failed to set FlareSolverr config")
            return True
        except AioRpcError as e:
            self._handle_grpc_error(e, "set_flaresolverr_config")

    async def fetch_proxy_config(self) -> dict[str, Any]:
        """Return current proxy config from bridge."""
        try:
            stub = await self._connection.get_stub()
            request = config_pb2.GetProxyConfigRequest()
            response = await stub.GetProxyConfig(request, timeout=10.0)
            config = response.config
            return {
                "hostname": config.hostname,
                "port": int(config.port),
                "username": config.username if config.HasField("username") else None,
                "password": config.password if config.HasField("password") else None,
                "ignored_addresses": config.ignored_addresses,
                "bypass_local_addresses": bool(config.bypass_local_addresses),
            }
        except AioRpcError as e:
            self._handle_grpc_error(e, "fetch_proxy_config")

    async def set_proxy_config(
        self,
        *,
        hostname: str,
        port: int,
        username: str | None,
        password: str | None,
        ignored_addresses: str,
        bypass_local_addresses: bool,
    ) -> bool:
        """Set proxy config in bridge."""
        try:
            stub = await self._connection.get_stub()
            proxy_config = config_pb2.ProxyConfig(
                hostname=hostname,
                port=port,
                ignored_addresses=ignored_addresses,
                bypass_local_addresses=bypass_local_addresses,
            )
            if username is not None:
                proxy_config.username = username
            if password is not None:
                proxy_config.password = password

            request = config_pb2.SetProxyConfigRequest(config=proxy_config)
            response = await stub.SetProxyConfig(request, timeout=10.0)
            if not response.success:
                raise BridgeAPIError(500, response.error or "Failed to set proxy config")
            return True
        except AioRpcError as e:
            self._handle_grpc_error(e, "set_proxy_config")

    async def set_extension_proxy(
        self,
        *,
        package_name: str,
        use_proxy: bool,
    ) -> bool:
        """Enable or disable proxy mode for an extension in bridge runtime config."""
        try:
            stub = await self._connection.get_stub()
            request = config_pb2.SetExtensionProxyRequest(
                package_name=package_name,
                use_proxy=use_proxy,
            )
            response = await stub.SetExtensionProxy(request, timeout=10.0)
            if not response.success:
                raise BridgeAPIError(500, response.error or "Failed to set extension proxy")
            return True
        except AioRpcError as e:
            self._handle_grpc_error(e, "set_extension_proxy")

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

            source_meta = await self._source_metadata(source_id)
            return self._proto_to_preferences(source_id, source_meta, response)
        except AioRpcError as e:
            self._handle_grpc_error(e, "fetch_source_preferences")

    async def fetch_search_filters(self, source_id: str) -> SourcePreferencesResource:
        """Return source search filters for catalogue search."""
        try:
            stub = await self._connection.get_stub()
            request = extensions_pb2.GetFiltersRequest(source_id=int(source_id))
            response = await stub.GetSearchFilters(request, timeout=10.0)

            source_meta = await self._source_metadata(source_id)
            return self._proto_to_preferences(source_id, source_meta, response)
        except AioRpcError as e:
            self._handle_grpc_error(e, "fetch_search_filters")

    async def set_source_preference(
        self,
        source_id: str,
        key: str,
        value: Any,
    ) -> None:
        """Set one source preference value."""
        try:
            stub = await self._connection.get_stub()
            request = extensions_pb2.SetPreferenceRequest(
                source_id=int(source_id),
                key=key,
                value=json.dumps(value),
            )
            response = await stub.SetPreference(request, timeout=10.0)

            if not response.success:
                raise BridgeAPIError(500, response.error or "Failed to set preference")
        except AioRpcError as e:
            self._handle_grpc_error(e, "set_source_preference")

    async def remove_source_preference(
        self,
        source_id: str,
        key: str,
    ) -> None:
        """Remove one source preference value."""
        await self.set_source_preference(
            source_id=source_id,
            key=key,
            value={DELETE_PREFERENCE_MARKER: True},
        )

    async def set_source_preferences(
        self,
        source_id: str,
        preferences: dict[str, Any],
    ) -> None:
        """Set multiple source preferences concurrently."""
        await asyncio.gather(*(
            self.set_source_preference(source_id=source_id, key=k, value=v)
            for k, v in preferences.items()
        ))

    # Title Explore

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
            response = await stub.GetPopularTitles(
                request, timeout=SOURCE_RPC_TIMEOUT_SECONDS
            )

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
            response = await stub.GetLatestTitles(
                request, timeout=SOURCE_RPC_TIMEOUT_SECONDS
            )

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
        search_filters: dict[str, Any] | None = None,
    ) -> tuple[list[ExtensionSourceTitle], bool]:
        """Search titles within a source."""
        try:
            stub = await self._connection.get_stub()
            filters = [
                extensions_pb2.SearchFilter(
                    key=key,
                    value=json.dumps(value),
                )
                for key, value in (search_filters or {}).items()
            ]
            request = extensions_pb2.SearchTitleRequest(
                source_id=int(source_id),
                query=query,
                page=page or 1,
                filters=filters,
            )
            response = await stub.SearchTitle(request, timeout=SOURCE_RPC_TIMEOUT_SECONDS)

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
        title_url: str,
    ) -> ExtensionSourceTitle:
        """Return a title with details populated."""
        try:
            stub = await self._connection.get_stub()
            request = extensions_pb2.GetTitleDetailsRequest(
                source_id=int(source_id), title_url=title_url
            )
            response = await stub.GetTitleDetails(
                request, timeout=SOURCE_RPC_TIMEOUT_SECONDS
            )

            return self._proto_to_extension_title(response.title)
        except AioRpcError as e:
            self._handle_grpc_error(e, "fetch_title_details")

    async def fetch_title_chapters(
        self,
        source_id: str,
        title_url: str,
    ) -> list[SourceChapter]:
        """Return all chapters for a given title."""
        try:
            stub = await self._connection.get_stub()
            request = extensions_pb2.GetChaptersListRequest(
                source_id=int(source_id), title_url=title_url
            )
            response = await stub.GetChapterList(
                request, timeout=SOURCE_RPC_TIMEOUT_SECONDS
            )

            return [self._proto_to_chapter(ch) for ch in response.chapters]
        except AioRpcError as e:
            self._handle_grpc_error(e, "fetch_title_chapters")

    async def fetch_chapter_pages(
        self,
        source_id: str,
        chapter_url: str,
    ) -> list[Page]:
        """Return all pages for a given chapter."""
        try:
            stub = await self._connection.get_stub()
            request = extensions_pb2.GetPagesListRequest(
                source_id=int(source_id), chapter_url=chapter_url
            )
            response = await stub.GetPageList(request, timeout=SOURCE_RPC_TIMEOUT_SECONDS)

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
        details = (error.details() or "").strip()
        debug_details = (error.debug_error_string() or "").strip()

        # gRPC sometimes returns UNKNOWN with an empty grpc_message payload.
        # Replace opaque peer text with a readable actionable message.
        peer_unknown = (
            status_code == grpc.StatusCode.UNKNOWN
            and (
                not details
                or "Error received from peer" in details
                or (debug_details and "Error received from peer" in debug_details)
            )
        )
        if peer_unknown:
            grpc_message = ""
            for blob in (details, debug_details):
                match = re.search(r'grpc_message:\s*"([^"]*)"', blob)
                if match:
                    grpc_message = match.group(1).strip()
                    if grpc_message:
                        break
            details = (
                grpc_message
                or "Bridge extension failed with an empty internal error. "
                "Check bridge logs for root cause."
            )
        elif not details:
            details = debug_details or "No error details from gRPC peer"
        message = f"{operation} failed ({status_code.name}): {details}"
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

    def _proto_to_chapter(self, chapter: extensions_pb2.Chapter) -> SourceChapter:
        """Convert protobuf Chapter to SourceChapter model."""
        return SourceChapter(
            url=chapter.url,
            name=chapter.name,
            date_upload=self._epoch_to_datetime(chapter.date_upload),
            chapter_number=chapter.chapter_number,
            scanlator=chapter.scanlator,
        )

    def _proto_to_page(self, page: extensions_pb2.Page) -> Page:
        """Convert protobuf Page to model."""
        return Page(index=page.index, url=page.url, image_url=page.image_url)

    def _proto_to_preferences(
        self,
        source_id: str,
        source_meta: RepoSource | None,
        filters: extensions_pb2.FiltersResponse,
    ) -> SourcePreferencesResource:
        """Convert protobuf filters to preferences."""
        return SourcePreferencesResource(
            source_id=source_id,
            name=source_meta.name if source_meta else None,
            lang=source_meta.lang if source_meta else None,
            preferences=[self._proto_to_source_preference(f) for f in filters.filters],
        )

    async def _source_metadata(self, source_id: str) -> RepoSource | None:
        sources = await self.fetch_installed_sources()
        return next((source for source in sources if source.id == source_id), None)

    def _proto_to_source_preference(
        self, filter_item: extensions_pb2.Filter
    ) -> SourcePreference:
        payload = self._parse_filter_payload(filter_item.data)

        pref_type = str(payload.get("type") or filter_item.type or "text").lower()
        if pref_type not in {"list", "toggle", "multi_select", "text"}:
            pref_type = "text"

        return SourcePreference(
            key=str(payload.get("key") or filter_item.name),
            title=str(payload.get("title") or filter_item.name),
            summary=self._optional_text(payload.get("summary")),
            type=PreferenceType(pref_type),
            enabled=bool(payload.get("enabled", True)),
            visible=bool(payload.get("visible", True)),
            default_value=payload.get("default_value"),
            current_value=payload.get("current_value"),
            entries=self._string_list(payload.get("entries")),
            entry_values=self._string_list(payload.get("entry_values")),
            dialog_title=self._optional_text(payload.get("dialog_title")),
            dialog_message=self._optional_text(payload.get("dialog_message")),
        )

    @staticmethod
    def _parse_filter_payload(raw: str) -> dict[str, Any]:
        try:
            parsed = json.loads(raw)
        except (TypeError, json.JSONDecodeError):
            return {}

        if isinstance(parsed, dict):
            return parsed
        return {}

    @staticmethod
    def _optional_text(value: Any) -> str | None:
        if value is None:
            return None
        text = str(value).strip()
        return text or None

    @staticmethod
    def _string_list(value: Any) -> list[str] | None:
        if not isinstance(value, list):
            return None
        return [str(item) for item in value]

    @staticmethod
    def _epoch_to_datetime(value: int) -> datetime:
        if value <= 0:
            return datetime.fromtimestamp(0, tz=UTC)
        seconds = value / 1000 if value > 10_000_000_000 else value
        return datetime.fromtimestamp(seconds, tz=UTC)


# Factory function for easy initialization
def create_bridge_service() -> TachibridgeService:
    """Create a configured TachibridgeService instance."""
    process = TachibridgeProcess(shutdown_timeout=100.0)
    connection = TachibridgeConnection(port=settings.tachibridge.port)
    return TachibridgeService(process, connection)


# Shared service singleton used across the backend.
tachibridge = create_bridge_service()
