import asyncio
import re
from datetime import datetime, timedelta, timezone
from typing import Literal

from sqlmodel import delete, select
from sqlmodel.ext.asyncio.session import AsyncSession

from app.bridge import tachibridge
from app.features.extensions import ExtensionService
from app.models import (
    DiscoverCacheItem,
    DiscoverCachePage,
    DiscoverCategory,
    DiscoverFeed,
    DiscoverItem,
    DiscoverSourceLink,
    LibraryTitleVariant,
    SourceSummary,
)

_NORMALIZE_RE = re.compile(r"[^a-z0-9]+")
CACHE_TTL_SECONDS = 15 * 60
MAX_CATEGORY_ITEMS = 250


def _normalize(value: str | None) -> str:
    if not value:
        return ""
    lowered = value.strip().lower()
    return _NORMALIZE_RE.sub(" ", lowered).strip()


def _dedupe_key(title: str, author: str | None = None) -> str:
    title_key = _normalize(title)
    author_key = _normalize(author)
    return f"{title_key}|{author_key}" if author_key else title_key


def _ensure_utc(dt: datetime) -> datetime:
    if dt.tzinfo is None:
        return dt.replace(tzinfo=timezone.utc)
    return dt.astimezone(timezone.utc)


def _status_value(value: object) -> int:
    raw = getattr(value, "value", value)
    return int(raw)


class DiscoverService:
    _refresh_lock = asyncio.Lock()

    def __init__(self, session: AsyncSession):
        self.session = session
        self.extension_service = ExtensionService(session)

    async def list_sources(
        self,
        enabled: bool = True,
        supports_latest: bool | None = None,
    ) -> list[SourceSummary]:
        rows = await self.extension_service.list_sources(
            installed=True,
            enabled=enabled,
            supports_latest=supports_latest,
        )
        return [SourceSummary.from_models(extension, source) for extension, source in rows]

    async def list_categories(self, limit: int = 30) -> list[DiscoverCategory]:
        cutoff = datetime.now(timezone.utc) - timedelta(seconds=CACHE_TTL_SECONDS)
        items = (
            await self.session.exec(
                select(DiscoverCacheItem.genre).where(
                    DiscoverCacheItem.section.in_(["popular", "latest"]),
                    DiscoverCacheItem.fetched_at >= cutoff,
                )
            )
        ).all()

        bucket: dict[str, int] = {}
        for genre in items:
            if not genre:
                continue
            for raw in genre.split(","):
                name = raw.strip()
                if not name:
                    continue
                bucket[name] = bucket.get(name, 0) + 1

        ranked = sorted(bucket.items(), key=lambda item: item[1], reverse=True)[:limit]
        return [DiscoverCategory(name=name, count=count) for name, count in ranked]

    async def popular(
        self, page: int, limit: int, source_id: str | None = None
    ) -> DiscoverFeed:
        return await self._cached_feed(
            section="popular",
            page=page,
            limit=limit,
            source_id=source_id,
        )

    async def latest(
        self, page: int, limit: int, source_id: str | None = None
    ) -> DiscoverFeed:
        return await self._cached_feed(
            section="latest",
            page=page,
            limit=limit,
            source_id=source_id,
        )

    async def search(
        self,
        query: str,
        page: int,
        limit: int,
        source_id: str | None = None,
    ) -> DiscoverFeed:
        return await self._live_feed(
            section="search",
            page=page,
            limit=limit,
            source_id=source_id,
            query=query,
        )

    async def category(
        self,
        name: str,
        page: int,
        limit: int,
        source_id: str | None = None,
    ) -> DiscoverFeed:
        # Simple, scalable default: category query delegates to source search.
        return await self._live_feed(
            section="category",
            page=page,
            limit=limit,
            source_id=source_id,
            query=name,
            category=name,
        )

    async def refresh_enabled_sources_cache(self, max_pages: int = 2) -> None:
        async with self._refresh_lock:
            sources = await self.list_sources(enabled=True)
            latest_sources = [source for source in sources if source.supports_latest]

            for page in range(1, max_pages + 1):
                for source in sources:
                    await self._refresh_source_page(
                        section="popular",
                        source_id=source.id,
                        page=page,
                        force=True,
                    )

                for source in latest_sources:
                    await self._refresh_source_page(
                        section="latest",
                        source_id=source.id,
                        page=page,
                        force=True,
                    )

    async def _cached_feed(
        self,
        section: Literal["popular", "latest"],
        page: int,
        limit: int,
        source_id: str | None = None,
    ) -> DiscoverFeed:
        sources = await self.list_sources(
            enabled=True,
            supports_latest=True if section == "latest" else None,
        )
        if source_id:
            sources = [source for source in sources if source.id == source_id]

        if not sources:
            return DiscoverFeed(
                section=section,
                page=page,
                limit=limit,
                has_next_page=False,
                items=[],
            )

        for source in sources:
            if await self._needs_refresh(section=section, source_id=source.id, page=page):
                await self._refresh_source_page(
                    section=section,
                    source_id=source.id,
                    page=page,
                    force=True,
                )

        source_items: dict[str, list[DiscoverCacheItem]] = {}
        has_next_page = False

        for source in sources:
            rows = (
                await self.session.exec(
                    select(DiscoverCacheItem)
                    .where(
                        DiscoverCacheItem.section == section,
                        DiscoverCacheItem.source_id == source.id,
                        DiscoverCacheItem.page == page,
                    )
                    .order_by(DiscoverCacheItem.rank)
                )
            ).all()
            source_items[source.id] = list(rows)

            page_meta = await self.session.get(
                DiscoverCachePage,
                {
                    "section": section,
                    "source_id": source.id,
                    "page": page,
                },
            )
            if page_meta and page_meta.has_next_page:
                has_next_page = True

        merged = self._merge_cached_items(sources, source_items)
        await self._attach_imported_library_ids(merged)

        return DiscoverFeed(
            section=section,
            page=page,
            limit=limit,
            has_next_page=has_next_page or len(merged) > limit,
            items=merged[:limit],
        )

    async def _live_feed(
        self,
        section: Literal["search", "category"],
        page: int,
        limit: int,
        source_id: str | None = None,
        query: str | None = None,
        category: str | None = None,
    ) -> DiscoverFeed:
        sources = await self.list_sources(enabled=True)
        if source_id:
            sources = [source for source in sources if source.id == source_id]

        if not sources:
            return DiscoverFeed(
                section=section,
                page=page,
                limit=limit,
                query=query,
                category=category,
                has_next_page=False,
                items=[],
            )

        source_items: dict[str, list[DiscoverCacheItem]] = {}
        has_next_page = False
        now = datetime.now(timezone.utc)

        for source in sources:
            titles, source_has_next = await tachibridge.search_titles(
                source_id=source.id,
                query=query or "",
                page=page,
            )
            has_next_page = has_next_page or source_has_next

            source_items[source.id] = [
                DiscoverCacheItem(
                    section=section,
                    source_id=source.id,
                    page=page,
                    rank=rank,
                    dedupe_key=_dedupe_key(title.title, title.author),
                    title_url=title.url,
                    title=title.title,
                    thumbnail_url=title.thumbnail_url or "",
                    artist=title.artist,
                    author=title.author,
                    description=title.description,
                    genre=title.genre,
                    status=_status_value(title.status),
                    fetched_at=now,
                )
                for rank, title in enumerate(titles, start=1)
            ]

        merged = self._merge_cached_items(sources, source_items)
        await self._attach_imported_library_ids(merged)

        return DiscoverFeed(
            section=section,
            page=page,
            limit=limit,
            query=query,
            category=category,
            has_next_page=has_next_page or len(merged) > limit,
            items=merged[:limit],
        )

    async def _needs_refresh(self, section: str, source_id: str, page: int) -> bool:
        row = await self.session.get(
            DiscoverCachePage,
            {"section": section, "source_id": source_id, "page": page},
        )
        if row is None:
            return True
        fetched_at = _ensure_utc(row.fetched_at)
        return fetched_at + timedelta(seconds=CACHE_TTL_SECONDS) < datetime.now(
            timezone.utc
        )

    async def _refresh_source_page(
        self,
        section: Literal["popular", "latest"],
        source_id: str,
        page: int,
        force: bool = False,
    ) -> None:
        if not force and not await self._needs_refresh(section, source_id, page):
            return

        fetch_fn = (
            tachibridge.fetch_popular_titles
            if section == "popular"
            else tachibridge.fetch_latest_titles
        )
        titles, has_next_page = await fetch_fn(source_id=source_id, page=page)
        now = datetime.now(timezone.utc)

        await self.session.exec(
            delete(DiscoverCacheItem).where(
                DiscoverCacheItem.section == section,
                DiscoverCacheItem.source_id == source_id,
                DiscoverCacheItem.page == page,
            )
        )

        items = [
            DiscoverCacheItem(
                section=section,
                source_id=source_id,
                page=page,
                rank=rank,
                dedupe_key=_dedupe_key(title.title, title.author),
                title_url=title.url,
                title=title.title,
                thumbnail_url=title.thumbnail_url or "",
                artist=title.artist,
                author=title.author,
                description=title.description,
                genre=title.genre,
                status=_status_value(title.status),
                fetched_at=now,
            )
            for rank, title in enumerate(titles, start=1)
        ]
        if items:
            self.session.add_all(items)

        page_meta = await self.session.get(
            DiscoverCachePage,
            {"section": section, "source_id": source_id, "page": page},
        )
        if page_meta is None:
            page_meta = DiscoverCachePage(
                section=section,
                source_id=source_id,
                page=page,
                fetched_at=now,
                has_next_page=has_next_page,
                item_count=len(items),
            )
        else:
            page_meta.fetched_at = now
            page_meta.has_next_page = has_next_page
            page_meta.item_count = len(items)
        self.session.add(page_meta)
        await self.session.commit()

    async def _attach_imported_library_ids(self, items: list[DiscoverItem]) -> None:
        source_ids = {link.source.id for item in items for link in item.links}
        title_urls = {link.title_url for item in items for link in item.links}
        if not source_ids or not title_urls:
            return

        rows = (
            await self.session.exec(
                select(
                    LibraryTitleVariant.source_id,
                    LibraryTitleVariant.title_url,
                    LibraryTitleVariant.library_title_id,
                )
                .where(
                    LibraryTitleVariant.source_id.in_(source_ids),
                    LibraryTitleVariant.title_url.in_(title_urls),
                )
            )
        ).all()
        lookup = {(source_id, title_url): int(library_id) for source_id, title_url, library_id in rows}

        for item in items:
            imported_id: int | None = None
            for link in item.links:
                imported_id = lookup.get((link.source.id, link.title_url))
                if imported_id is not None:
                    break
            item.imported_library_id = imported_id

    @staticmethod
    def _merge_cached_items(
        sources: list[SourceSummary],
        source_items: dict[str, list[DiscoverCacheItem]],
    ) -> list[DiscoverItem]:
        source_by_id = {source.id: source for source in sources}
        source_order = {source.id: idx for idx, source in enumerate(sources)}
        merged: dict[str, DiscoverItem] = {}
        ordering: list[str] = []

        for source in sources:
            for item in source_items.get(source.id, []):
                key = item.dedupe_key or _dedupe_key(item.title, item.author)
                source_link = DiscoverSourceLink(
                    source=source,
                    title_url=item.title_url,
                )

                existing = merged.get(key)
                if existing is None:
                    merged[key] = DiscoverItem(
                        dedupe_key=key,
                        title=item.title,
                        thumbnail_url=item.thumbnail_url or "",
                        artist=item.artist,
                        author=item.author,
                        description=item.description,
                        genre=item.genre,
                        status=item.status,
                        links=[source_link],
                    )
                    ordering.append(key)
                    continue

                if not any(link.source.id == source.id for link in existing.links):
                    existing.links.append(source_link)

                if not existing.description and item.description:
                    existing.description = item.description
                if not existing.thumbnail_url and item.thumbnail_url:
                    existing.thumbnail_url = item.thumbnail_url
                if not existing.author and item.author:
                    existing.author = item.author
                if not existing.artist and item.artist:
                    existing.artist = item.artist
                if not existing.genre and item.genre:
                    existing.genre = item.genre

        deduped = [merged[key] for key in ordering]

        for item in deduped:
            item.links.sort(
                key=lambda link: (
                    source_order.get(link.source.id, len(sources)),
                    link.title_url,
                )
            )
            # Ensure link sources are still valid.
            item.links = [link for link in item.links if link.source.id in source_by_id]

        return deduped[:MAX_CATEGORY_ITEMS]
