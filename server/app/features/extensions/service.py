from sqlmodel import delete, func, select, asc
from sqlmodel.ext.asyncio.session import AsyncSession

from app.bridge import tachibridge
from app.config import settings
from app.models import (
    Extension,
    ExtensionResource,
    RepoExtension,
    Source,
    SourcePreference,
    SourcePreferencesResource,
    UpdateExtension,
    UpdateSource,
)


class ExtensionService:
    def __init__(self, session: AsyncSession):
        self.session = session

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
        stmt = select(Extension).where(Extension.pkg == pkg)
        extension = (await self.session.exec(stmt)).first()
        if not extension:
            raise ValueError(f"Extension {pkg} not found")

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
        repo_extensions = await tachibridge.fetch_repository_extensions()
        return await self._replace_all_extensions(repo_index_url, repo_extensions)

    async def list_all_extensions(self) -> list[Extension]:
        return await self._list_extensions()

    async def list_installed_extensions(self) -> list[ExtensionResource]:
        extensions = await self._list_extensions(installed=True)
        resources: list[ExtensionResource] = [
            ExtensionResource(
                **extension.model_dump(),
                sources=(await self._list_extension_sources(extension.pkg)),
            )
            for extension in extensions
        ]
        return resources

    async def install_extension(self, extension_pkg: str) -> ExtensionResource:
        extension, sources = await tachibridge.install_extension(extension_pkg)

        updated_sources: list[Source] = []

        for installed_source in sources:
            source_update = UpdateSource(supports_latest=installed_source.supports_latest)
            updated_source = await self._update_source(installed_source.id, source_update)
            updated_sources.append(updated_source)

        max_priority = await self._get_max_extension_priority()
        extension_update = UpdateExtension(
            installed=True,
            priority=max_priority + 1,
            sources_has_prefs=extension.sources_has_prefs,
        )
        extension = await self._update_extension(extension_pkg, extension_update)

        settings.save_installed_extension(extension_pkg)

        return ExtensionResource(**extension.model_dump(), sources=updated_sources)

    async def uninstall_extension(self, extension_pkg: str) -> Extension:
        await tachibridge.uninstall_extension(extension_pkg)
        extension_update = UpdateExtension(installed=False)
        extension = await self._update_extension(extension_pkg, extension_update)
        settings.remove_installed_extension(extension_pkg)
        return extension

    async def update_extensions_priority(
        self, extensions_by_priority: list[str]
    ) -> list[Extension]:
        updated_extensions: list[Extension] = []
        for index, pkg in enumerate(extensions_by_priority):
            extension_update = UpdateExtension(priority=index + 1)
            extension = await self._update_extension(pkg, extension_update)
            updated_extensions.append(extension)
        return updated_extensions

    async def toggle_extension_proxy(
        self, extension_pkg: str, use_proxy: bool
    ) -> Extension:
        extension_update = UpdateExtension(use_proxy=use_proxy)
        return await self._update_extension(extension_pkg, extension_update)

    async def list_enabled_sources(
        self, supports_latest: bool | None = None
    ) -> list[tuple[Extension, Source]]:
        extensions = await self._list_extensions(installed=True)
        result = [
            (ext, s)
            for ext in extensions
            for s in await self._list_extension_sources(
                ext.pkg, enabled=True, supports_latest=supports_latest
            )
        ]
        return result

    async def toggle_source(self, source_id: str, enabled: bool) -> Source:
        source_update = UpdateSource(enabled=enabled)
        return await self._update_source(source_id, source_update)

    async def list_source_preferences(
        self, source_id: str
    ) -> SourcePreferencesResource:
        return await tachibridge.fetch_source_preferences(source_id)

    async def update_source_preferences(
        self, source_id: str, preferences: list[SourcePreference]
    ) -> SourcePreferencesResource:
        preferences_dict = {pref.key: pref.current_value for pref in preferences}
        settings.save_source_preferences(source_id, preferences_dict)
        await tachibridge.reload_config()
        return await tachibridge.fetch_source_preferences(source_id)
