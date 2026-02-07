from sqlmodel.ext.asyncio.session import AsyncSession

from app.bridge import tachibridge
from app.config import settings
from app.features.extensions.storage import ExtensionStorage
from app.models import (
    Extension,
    ExtensionResource,
    Source,
    SourcePreference,
    SourcePreferencesResource,
    UpdateExtension,
    UpdateSource,
)


class ExtensionService:
    def __init__(self, session: AsyncSession):
        self.storage = ExtensionStorage(session)

    async def change_extensions_repo(self, repo_index_url: str) -> list[Extension]:
        repo_extensions = await tachibridge.fetch_repository_extensions()
        return await self.storage.replace_all_extensions(
            repo_index_url, repo_extensions
        )

    async def list_all_extensions(self) -> list[Extension]:
        return await self.storage.list_extensions()

    async def list_installed_extensions(
        self,
    ) -> list[ExtensionResource]:
        extensions = await self.storage.list_extensions(installed=True)
        resources: list[ExtensionResource] = [
            ExtensionResource(
                **extension.model_dump(),
                sources=(await self.storage.list_extension_sources(extension.pkg)),
            )
            for extension in extensions
        ]
        return resources

    async def install_extension(self, extension_pkg: str) -> ExtensionResource:
        extension, sources = await tachibridge.install_extension(extension_pkg)

        updated_sources: list[Source] = []

        # Update each source in the database and collect the updated object
        for installed_source in sources:
            source_update = UpdateSource(
                supports_latest=installed_source.supports_latest
            )
            updated_source = await self.storage.update_object(
                Source, source_update, id=installed_source.id
            )
            updated_sources.append(updated_source)

        # Update the extension itself
        max_priority = await self.storage.get_max_extension_priority()
        extension_priority = max_priority + 1
        extension_update = UpdateExtension(
            installed=True,
            priority=extension_priority,
            sources_has_prefs=extension.sources_has_prefs,
        )
        extension = await self.storage.update_object(
            Extension, extension_update, pkg=extension_pkg
        )

        settings.save_installed_extension(extension_pkg)

        return ExtensionResource(**extension.model_dump(), sources=updated_sources)

    async def uninstall_extension(self, extension_pkg: str) -> Extension:
        await tachibridge.uninstall_extension(extension_pkg)
        extension_update = UpdateExtension(installed=False)
        extension = await self.storage.update_object(
            Extension, extension_update, pkg=extension_pkg
        )
        settings.remove_installed_extension(extension_pkg)
        return extension

    async def update_extensions_priority(
        self, extensions_by_priority: list[str]
    ) -> list[Extension]:
        updated_extensions: list[Extension] = []
        for index, pkg in enumerate(extensions_by_priority):
            extension_update = UpdateExtension(priority=index + 1)
            extension = await self.storage.update_object(
                Extension, extension_update, pkg=pkg
            )
            updated_extensions.append(extension)
        return updated_extensions

    async def toggle_extension_proxy(
        self, extension_pkg: str, use_proxy: bool
    ) -> Extension:
        extension_update = UpdateExtension(use_proxy=use_proxy)
        extension = await self.storage.update_object(
            Extension, extension_update, pkg=extension_pkg
        )
        return extension

    async def list_enabled_sources(
        self, supports_latest: bool | None = None
    ) -> list[tuple[Extension, Source]]:
        extensions = await self.storage.list_extensions(installed=True)
        result = [
            (ext, s)
            for ext in extensions
            for s in await self.storage.list_extension_sources(
                ext.pkg, enabled=True, supports_latest=supports_latest
            )
        ]
        return result

    async def toggle_source(self, source_id: str, enabled: bool) -> Source:
        source_update = UpdateSource(enabled=enabled)
        source = await self.storage.update_object(Source, source_update, id=source_id)
        return source

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
        updated_preferences = await tachibridge.fetch_source_preferences(source_id)

        return updated_preferences
