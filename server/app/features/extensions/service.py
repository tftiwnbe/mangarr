from datetime import datetime, timedelta, timezone

from loguru import logger
from sqlmodel import delete, func, select, asc
from sqlmodel.ext.asyncio.session import AsyncSession

from app.bridge import tachibridge
from app.core.cache import PersistentCache
from app.core.database import sessionmanager
from app.core.errors import BridgeAPIError
from app.features.extensions.repo_changes import fetch_repository_changes, load_repository_url
from app.models import (
    Extension,
    ExtensionResource,
    RepoExtensionChangeResource,
    RepoExtensionChangesResource,
    RepoExtension,
    Source,
    SourcePreferenceUpdate,
    SourcePreferencesResource,
    UpdateExtension,
    UpdateSource,
)

_extensions_logger = logger.bind(module="extensions.service")
CACHE_TTL_SECONDS = 15 * 60


class ExtensionService:
    def __init__(self, session: AsyncSession):
        self.session = session
        self._cache = PersistentCache(sessionmanager.session)

    async def _get_extension_or_raise(self, pkg: str) -> Extension:
        extension = (
            await self.session.exec(select(Extension).where(Extension.pkg == pkg))
        ).first()
        if not extension:
            raise ValueError(f"Extension {pkg} not found")
        return extension

    async def _get_sources_by_ids(self, source_ids: list[str]) -> dict[str, Source]:
        if not source_ids:
            return {}
        rows = (
            await self.session.exec(select(Source).where(Source.id.in_(source_ids)))
        ).all()
        return {source.id: source for source in rows}

    async def _replace_all_extensions(
        self, repo_index_url: str, new_repo_extensions: list[RepoExtension]
    ) -> list[Extension]:
        """Replace persisted extensions with the provided collection."""
        await self.session.exec(delete(Source))
        await self.session.exec(delete(Extension))

        extensions: list[Extension] = []

        for repo_ext in new_repo_extensions:
            extension = Extension(
                **repo_ext.model_dump(
                    include={"pkg", "version", "nsfw", "sources_has_prefs"}
                ),
                name=repo_ext.name.removeprefix("Tachiyomi: "),
                lang="multi" if repo_ext.lang == "all" else repo_ext.lang,
                icon=f"{repo_index_url.rsplit('/', 1)[0]}/icon/{repo_ext.pkg}.png",
                sources=[
                    Source(
                        id=src.id,
                        name=src.name,
                        lang=("multi" if src.lang == "all" else src.lang),
                        base_url=src.base_url,
                        supports_latest=src.supports_latest,
                        extension_pkg=repo_ext.pkg,
                    )
                    for src in repo_ext.sources
                ],
            )
            extensions.append(extension)

        self.session.add_all(extensions)
        await self.session.commit()
        return extensions

    async def _list_extensions(self, installed: bool | None = None) -> list[Extension]:
        stmt = select(Extension)
        if installed is not None:
            stmt = stmt.where(Extension.installed == installed)
        stmt = stmt.order_by(asc(Extension.priority))
        extensions = (await self.session.exec(stmt)).all()
        return list(extensions)

    async def _get_max_extension_priority(self) -> int:
        stmt = select(func.max(Extension.priority)).where(Extension.installed)
        max_priority = (await self.session.exec(stmt)).first()
        return max_priority or 0

    async def _list_extension_sources(
        self,
        extension_pkg: str,
        enabled: bool | None = None,
        supports_latest: bool | None = None,
    ) -> list[Source]:
        stmt = select(Source).where(Source.extension_pkg == extension_pkg)
        if enabled is not None:
            stmt = stmt.where(Source.enabled == enabled)
        if supports_latest is not None:
            stmt = stmt.where(Source.supports_latest == supports_latest)
        sources = (await self.session.exec(stmt)).all()
        return list(sources)

    async def _update_extension(self, pkg: str, updates: UpdateExtension) -> Extension:
        extension = await self._get_extension_or_raise(pkg)

        for key, value in updates.model_dump(exclude_unset=True).items():
            if hasattr(extension, key):
                setattr(extension, key, value)

        self.session.add(extension)
        await self.session.commit()
        await self.session.refresh(extension)
        return extension

    async def _update_source(self, source_id: str, updates: UpdateSource) -> Source:
        stmt = select(Source).where(Source.id == source_id)
        source = (await self.session.exec(stmt)).first()
        if not source:
            raise ValueError(f"Source {source_id} not found")

        for key, value in updates.model_dump(exclude_unset=True).items():
            if hasattr(source, key):
                setattr(source, key, value)

        self.session.add(source)
        await self.session.commit()
        await self.session.refresh(source)
        return source

    # Public API methods

    async def change_extensions_repo(self, repo_index_url: str) -> list[Extension]:
        success = await tachibridge.set_repository_url(repo_index_url)
        if not success:
            raise BridgeAPIError(502, "Failed to update repository URL in bridge")

        repo_extensions = await tachibridge.fetch_repository_extensions()
        return await self._replace_all_extensions(repo_index_url, repo_extensions)

    async def list_all_extensions(self) -> list[Extension]:
        return await self._list_extensions()

    async def list_repository_changes(
        self,
        days: int = 3,
        limit: int = 120,
    ) -> RepoExtensionChangesResource:
        safe_days = max(1, min(int(days), 30))
        safe_limit = max(1, min(int(limit), 300))
        repo_url = load_repository_url()
        cache_key = f"extensions:repo_changes:{repo_url}:{safe_days}:{safe_limit}"
        cached = await self._cache.get(cache_key)
        if isinstance(cached, dict):
            try:
                return RepoExtensionChangesResource.model_validate(cached)
            except Exception:
                _extensions_logger.warning("extensions.repo_changes_cache_invalid")

        error, tracked_path, changes = await fetch_repository_changes(
            repo_url=repo_url,
            days=safe_days,
            limit=safe_limit,
        )
        resource = await self._build_repository_changes_resource(
            repo_url=repo_url,
            tracked_path=tracked_path,
            days=safe_days,
            error=error,
            changes=changes,
        )
        await self._cache.set(
            cache_key,
            resource.model_dump(mode="json"),
            ttl=CACHE_TTL_SECONDS,
        )
        return resource

    async def list_installed_extensions(self) -> list[ExtensionResource]:
        extensions = await self._list_extensions(installed=True)
        if not extensions:
            return []
        pkgs = [e.pkg for e in extensions]
        all_sources = (
            await self.session.exec(select(Source).where(Source.extension_pkg.in_(pkgs)))
        ).all()
        sources_by_pkg: dict[str, list[Source]] = {}
        for src in all_sources:
            sources_by_pkg.setdefault(src.extension_pkg, []).append(src)
        return [
            ExtensionResource(**ext.model_dump(), sources=sources_by_pkg.get(ext.pkg, []))
            for ext in extensions
        ]

    async def _build_repository_changes_resource(
        self,
        *,
        repo_url: str,
        tracked_path: str,
        days: int,
        error: str | None,
        changes: list[dict[str, object]],
    ) -> RepoExtensionChangesResource:
        pkg_candidates = {
            str(pkg)
            for change in changes
            for pkg in (
                change.get("extension_pkg"),
                change.get("renamed_to_pkg"),
            )
            if isinstance(pkg, str) and pkg.strip()
        }
        extensions_by_pkg: dict[str, Extension] = {}
        if pkg_candidates:
            rows = (
                await self.session.exec(select(Extension).where(Extension.pkg.in_(sorted(pkg_candidates))))
            ).all()
            extensions_by_pkg = {extension.pkg: extension for extension in rows}

        resources: list[RepoExtensionChangeResource] = []
        for change in changes:
            pkg = (
                str(change.get("extension_pkg") or "").strip()
                or str(change.get("renamed_to_pkg") or "").strip()
                or None
            )
            extension = extensions_by_pkg.get(pkg or "")
            resources.append(
                RepoExtensionChangeResource(
                    status=change["status"],
                    extension_pkg=change.get("extension_pkg"),
                    name=str(change.get("name") or ""),
                    extension_name=extension.name if extension is not None else None,
                    lang=change.get("lang"),
                    version=change.get("version"),
                    new_version=change.get("new_version"),
                    renamed_to=change.get("renamed_to"),
                    renamed_to_pkg=change.get("renamed_to_pkg"),
                    installed=bool(extension.installed) if extension is not None else False,
                    known=extension is not None,
                    icon=extension.icon if extension is not None else None,
                    commit_sha=str(change.get("commit_sha") or ""),
                    commit_message=change.get("commit_message"),
                    committed_at=str(change.get("committed_at") or ""),
                )
            )

        return RepoExtensionChangesResource(
            repo_url=repo_url,
            tracked_path=tracked_path,
            since=(datetime.now(timezone.utc) - timedelta(days=days)).isoformat(),
            fetched_at=datetime.now(timezone.utc).isoformat(),
            error=error,
            changes=resources,
        )

    async def install_extension(self, extension_pkg: str) -> ExtensionResource:
        extension, sources = await tachibridge.install_extension(extension_pkg)

        source_ids = [installed_source.id for installed_source in sources]
        sources_by_id = await self._get_sources_by_ids(source_ids)
        updated_sources: list[Source] = []
        for installed_source in sources:
            source = sources_by_id.get(installed_source.id)
            if source is None:
                raise ValueError(f"Source {installed_source.id} not found")
            source.supports_latest = installed_source.supports_latest
            self.session.add(source)
            updated_sources.append(source)

        max_priority = await self._get_max_extension_priority()
        extension_row = await self._get_extension_or_raise(extension_pkg)
        extension_row.installed = True
        extension_row.priority = max_priority + 1
        extension_row.sources_has_prefs = extension.sources_has_prefs
        self.session.add(extension_row)
        await self.session.commit()
        return ExtensionResource(**extension_row.model_dump(), sources=updated_sources)

    async def uninstall_extension(self, extension_pkg: str) -> Extension:
        await tachibridge.uninstall_extension(extension_pkg)
        extension_update = UpdateExtension(installed=False)
        extension = await self._update_extension(extension_pkg, extension_update)
        return extension

    async def update_extensions_priority(
        self, extensions_by_priority: list[str]
    ) -> list[Extension]:
        rows = (
            await self.session.exec(
                select(Extension).where(Extension.pkg.in_(extensions_by_priority))
            )
        ).all()
        extensions_by_pkg = {extension.pkg: extension for extension in rows}
        updated_extensions: list[Extension] = []
        for index, pkg in enumerate(extensions_by_priority):
            extension = extensions_by_pkg.get(pkg)
            if extension is None:
                raise ValueError(f"Extension {pkg} not found")
            extension.priority = index + 1
            self.session.add(extension)
            updated_extensions.append(extension)
        await self.session.commit()
        return updated_extensions

    async def toggle_extension_proxy(
        self, extension_pkg: str, use_proxy: bool
    ) -> Extension:
        await tachibridge.set_extension_proxy(
            package_name=extension_pkg,
            use_proxy=use_proxy,
        )
        extension_update = UpdateExtension(use_proxy=use_proxy)
        return await self._update_extension(extension_pkg, extension_update)

    async def list_enabled_sources(
        self, supports_latest: bool | None = None
    ) -> list[tuple[Extension, Source]]:
        return await self.list_sources(
            installed=True,
            enabled=True,
            supports_latest=supports_latest,
        )

    async def list_sources(
        self,
        installed: bool | None = True,
        enabled: bool | None = None,
        supports_latest: bool | None = None,
    ) -> list[tuple[Extension, Source]]:
        extensions = await self._list_extensions(installed=installed)
        if not extensions:
            return []
        pkgs = [e.pkg for e in extensions]
        stmt = select(Source).where(Source.extension_pkg.in_(pkgs))
        if enabled is not None:
            stmt = stmt.where(Source.enabled == enabled)
        if supports_latest is not None:
            stmt = stmt.where(Source.supports_latest == supports_latest)
        all_sources = (await self.session.exec(stmt)).all()
        sources_by_pkg: dict[str, list[Source]] = {}
        for src in all_sources:
            sources_by_pkg.setdefault(src.extension_pkg, []).append(src)
        result: list[tuple[Extension, Source]] = []
        for extension in extensions:
            for src in sources_by_pkg.get(extension.pkg, []):
                result.append((extension, src))
        return result

    async def toggle_source(self, source_id: str, enabled: bool) -> Source:
        source_update = UpdateSource(enabled=enabled)
        return await self._update_source(source_id, source_update)

    async def list_source_preferences(
        self, source_id: str
    ) -> SourcePreferencesResource:
        return await tachibridge.fetch_source_preferences(source_id)

    async def list_source_search_filters(
        self, source_id: str
    ) -> SourcePreferencesResource:
        return await tachibridge.fetch_search_filters(source_id)

    async def update_source_preferences(
        self, source_id: str, preferences: list[SourcePreferenceUpdate]
    ) -> SourcePreferencesResource:
        delete_keys = [pref.key for pref in preferences if pref.delete]
        upserts = {pref.key: pref.value for pref in preferences if not pref.delete}

        for key in delete_keys:
            await tachibridge.remove_source_preference(source_id, key)
        if upserts:
            await tachibridge.set_source_preferences(source_id, upserts)

        return await tachibridge.fetch_source_preferences(source_id)
