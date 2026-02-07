from typing import TypeVar

from sqlmodel import delete, func, select, asc

from app.core.storage import Storage
from app.models import Extension, RepoExtension, Source, UpdateExtension, UpdateSource

T = TypeVar("T")


class ExtensionStorage(Storage[Extension]):
    async def replace_all_extensions(
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

    async def list_extensions(self, installed: bool | None = None) -> list[Extension]:
        stmt = select(Extension)
        if installed is not None:
            stmt = stmt.where(Extension.installed == installed)
        stmt = stmt.order_by(asc(Extension.priority))
        extensions = (await self.session.exec(stmt)).all()
        return list(extensions)

    async def get_max_extension_priority(self) -> int:
        stmt = select(func.max(Extension.priority)).where(Extension.installed)
        max_priority = (await self.session.exec(stmt)).first()
        return max_priority or 0

    async def list_extension_sources(
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

    async def update_object(
        self, obj_cls: type[T], updates: UpdateExtension | UpdateSource, **filters
    ) -> T:
        stmt = select(obj_cls).filter_by(**filters)
        obj = (await self.session.exec(stmt)).first()
        if not obj:
            raise ValueError(f"{obj_cls.__name__} not found")

        update_data = updates.model_dump(exclude_unset=True)

        for key, value in update_data.items():
            if hasattr(obj, key):
                setattr(obj, key, value)

        self.session.add(obj)
        await self.session.commit()
        await self.session.refresh(obj)
        return obj
