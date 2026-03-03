import shutil
from pathlib import Path

from app.bridge import tachibridge
from app.config import settings
from app.core.errors import BridgeAPIError
from app.features.library.jobs import get_last_cleanup_run_at, run_unassigned_cleanup
from app.models import (
    ContentLanguagesResource,
    ContentLanguagesUpdate,
    DownloadSettingsResource,
    DownloadSettingsUpdate,
    FlareSolverrSettingsResource,
    FlareSolverrSettingsUpdate,
    JobsCleanupRunResource,
    JobsSettingsResource,
    JobsSettingsUpdate,
    ProxySettingsResource,
    ProxySettingsUpdate,
    User,
)


class SettingsService:
    @staticmethod
    def _resolve_download_root() -> Path:
        configured = settings.downloads.root_dir.expanduser()
        fallback = settings.app.data_dir / "downloads"
        legacy_fallback = settings.app.config_dir / "downloads"

        for candidate in [configured, fallback, legacy_fallback]:
            resolved = candidate.resolve()
            try:
                resolved.mkdir(parents=True, exist_ok=True)
                shutil.disk_usage(resolved)
                return resolved
            except OSError:
                continue

        raise BridgeAPIError(
            500,
            "No writable download root found "
            f"(configured: {configured}, fallback: {fallback}, legacy: {legacy_fallback})",
        )

    @staticmethod
    def get_download_settings() -> DownloadSettingsResource:
        root = SettingsService._resolve_download_root()
        usage = shutil.disk_usage(root)
        return DownloadSettingsResource(
            root_dir=str(root),
            parallel_downloads=settings.downloads.parallel_downloads,
            failed_chapter_retry_delay_seconds=settings.downloads.failed_chapter_retry_delay_seconds,
            total_bytes=int(usage.total),
            used_bytes=int(usage.used),
            free_bytes=int(usage.free),
        )

    @staticmethod
    def update_download_settings(
        payload: DownloadSettingsUpdate,
        current_user: User,
    ) -> DownloadSettingsResource:
        if not current_user.is_admin:
            raise BridgeAPIError(403, "Only admins can update download settings")

        if (
            payload.root_dir is None
            and payload.parallel_downloads is None
            and payload.failed_chapter_retry_delay_seconds is None
        ):
            raise BridgeAPIError(400, "No download settings changes provided")

        if payload.root_dir is not None:
            candidate = Path(payload.root_dir).expanduser()
            if not candidate.is_absolute():
                candidate = (settings.app.config_dir / candidate).resolve()
            else:
                candidate = candidate.resolve()
            candidate.mkdir(parents=True, exist_ok=True)
            settings.downloads.root_dir = candidate

        if payload.parallel_downloads is not None:
            settings.downloads.parallel_downloads = int(payload.parallel_downloads)
        if payload.failed_chapter_retry_delay_seconds is not None:
            settings.downloads.failed_chapter_retry_delay_seconds = int(
                payload.failed_chapter_retry_delay_seconds
            )

        settings.save_settings()
        return SettingsService.get_download_settings()

    @staticmethod
    async def get_jobs_settings() -> JobsSettingsResource:
        last_cleanup_at = await get_last_cleanup_run_at()
        return JobsSettingsResource(
            cleanup_unassigned_enabled=settings.jobs.cleanup_unassigned_enabled,
            cleanup_unassigned_interval_days=settings.jobs.cleanup_unassigned_interval_days,
            cleanup_unassigned_older_than_days=settings.jobs.cleanup_unassigned_older_than_days,
            cleanup_unassigned_batch_limit=settings.jobs.cleanup_unassigned_batch_limit,
            last_cleanup_at=last_cleanup_at.isoformat() if last_cleanup_at else None,
        )

    @staticmethod
    async def update_jobs_settings(
        payload: JobsSettingsUpdate,
        current_user: User,
    ) -> JobsSettingsResource:
        if not current_user.is_admin:
            raise BridgeAPIError(403, "Only admins can update job settings")

        updates = payload.model_dump(exclude_unset=True)
        if not updates:
            raise BridgeAPIError(400, "No job settings changes provided")

        if "cleanup_unassigned_enabled" in updates:
            settings.jobs.cleanup_unassigned_enabled = bool(
                updates["cleanup_unassigned_enabled"]
            )
        if "cleanup_unassigned_interval_days" in updates:
            settings.jobs.cleanup_unassigned_interval_days = int(
                updates["cleanup_unassigned_interval_days"]
            )
        if "cleanup_unassigned_older_than_days" in updates:
            settings.jobs.cleanup_unassigned_older_than_days = int(
                updates["cleanup_unassigned_older_than_days"]
            )
        if "cleanup_unassigned_batch_limit" in updates:
            settings.jobs.cleanup_unassigned_batch_limit = int(
                updates["cleanup_unassigned_batch_limit"]
            )

        settings.save_settings()
        return await SettingsService.get_jobs_settings()

    @staticmethod
    async def run_jobs_cleanup_now(current_user: User) -> JobsCleanupRunResource:
        if not current_user.is_admin:
            raise BridgeAPIError(403, "Only admins can run cleanup jobs")

        executed, deleted_titles, ran_at = await run_unassigned_cleanup(force=True)
        return JobsCleanupRunResource(
            executed=executed,
            deleted_titles=deleted_titles,
            ran_at=ran_at.isoformat() if ran_at else None,
            reason=None if executed else "not_due",
        )

    @staticmethod
    async def get_flaresolverr_settings() -> FlareSolverrSettingsResource:
        config = await tachibridge.fetch_flaresolverr_config()
        return FlareSolverrSettingsResource(**config)

    @staticmethod
    async def update_flaresolverr_settings(
        payload: FlareSolverrSettingsUpdate,
        current_user: User,
    ) -> FlareSolverrSettingsResource:
        if not current_user.is_admin:
            raise BridgeAPIError(403, "Only admins can update FlareSolverr settings")

        updates = payload.model_dump(exclude_unset=True)
        if not updates:
            raise BridgeAPIError(400, "No FlareSolverr settings changes provided")

        current = await tachibridge.fetch_flaresolverr_config()
        merged = {**current, **updates}

        # Empty string means disabled session pinning.
        session_name = merged.get("session_name")
        if isinstance(session_name, str):
            session_name = session_name.strip() or None

        await tachibridge.set_flaresolverr_config(
            enabled=bool(merged["enabled"]),
            url=str(merged["url"]).strip(),
            timeout_seconds=int(merged["timeout_seconds"]),
            response_fallback=bool(merged["response_fallback"]),
            session_name=session_name,
            session_ttl_minutes=(
                int(merged["session_ttl_minutes"])
                if merged.get("session_ttl_minutes") is not None
                else None
            ),
        )

        return await SettingsService.get_flaresolverr_settings()

    @staticmethod
    async def get_proxy_settings() -> ProxySettingsResource:
        config = await tachibridge.fetch_proxy_config()
        return ProxySettingsResource(**config)

    @staticmethod
    def get_content_languages() -> ContentLanguagesResource:
        return ContentLanguagesResource(preferred=list(settings.content_languages.preferred))

    @staticmethod
    def update_content_languages(
        payload: ContentLanguagesUpdate,
    ) -> ContentLanguagesResource:
        settings.content_languages.preferred = [lang.lower() for lang in payload.preferred]
        settings.save_settings()
        return SettingsService.get_content_languages()

    @staticmethod
    async def update_proxy_settings(
        payload: ProxySettingsUpdate,
        current_user: User,
    ) -> ProxySettingsResource:
        if not current_user.is_admin:
            raise BridgeAPIError(403, "Only admins can update proxy settings")

        updates = payload.model_dump(exclude_unset=True)
        if not updates:
            raise BridgeAPIError(400, "No proxy settings changes provided")

        current = await tachibridge.fetch_proxy_config()
        merged = {**current, **updates}

        hostname = str(merged.get("hostname") or "").strip()
        port = int(merged.get("port") or 0)
        if hostname and not (1 <= port <= 65535):
            raise BridgeAPIError(400, "Proxy port must be between 1 and 65535")
        if not hostname:
            port = 0

        username = merged.get("username")
        password = merged.get("password")
        ignored_addresses = str(merged.get("ignored_addresses") or "").strip()
        bypass_local_addresses = bool(merged.get("bypass_local_addresses", True))

        if isinstance(username, str):
            username = username.strip() or None
        if isinstance(password, str):
            password = password.strip() or None

        await tachibridge.set_proxy_config(
            hostname=hostname,
            port=port,
            username=username,
            password=password,
            ignored_addresses=ignored_addresses,
            bypass_local_addresses=bypass_local_addresses,
        )

        return await SettingsService.get_proxy_settings()
