import asyncio
import re
import time as _time
from datetime import datetime, timedelta, timezone
from typing import Any, Literal

from loguru import logger
from sqlmodel import delete, select
from sqlmodel.ext.asyncio.session import AsyncSession

from app.bridge import tachibridge
from app.core.database import sessionmanager
from app.core.utils import normalize_text
from app.domain.title_identity import canonical_title_key, title_url_group_key
from app.features.extensions import ExtensionService
from app.models import (
    ExploreCacheItem,
    ExploreCachePage,
    ExploreCategory,
    ExploreFeed,
    ExploreItem,
    ExploreSourceLink,
    ExploreTitleDetailsCache,
    ExploreTitleDetailsResource,
    LibraryTitle,
    LibraryTitleVariant,
    SourceSummary,
    SourcePreferencesResource,
)

CACHE_TTL_SECONDS = 15 * 60
TITLE_DETAILS_CACHE_TTL_SECONDS = 24 * 60 * 60
MAX_CATEGORY_ITEMS = 250
AUTO_LINK_EXPLORE_MAX_ITEMS = 4
SOURCE_FETCH_CONCURRENCY = 6


_normalize = normalize_text


def _dedupe_key(title: str, author: str | None = None) -> str:
    return canonical_title_key(title, author)


def _ensure_utc(dt: datetime) -> datetime:
    if dt.tzinfo is None:
        return dt.replace(tzinfo=timezone.utc)
    return dt.astimezone(timezone.utc)


def _status_value(value: object) -> int:
    raw = getattr(value, "value", value)
    return int(raw)


def _genre_contains_category(genre_value: str | None, category: str | None) -> bool:
    normalized_category = _normalize(category)
    if not normalized_category:
        return True
    if not genre_value:
        return False
    return any(
        _normalize(part) == normalized_category for part in genre_value.split(",")
    )


_explore_logger = logger.bind(module="explore.service")


class ExploreService:
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
        return [
            SourceSummary.from_models(extension, source) for extension, source in rows
        ]

    async def list_categories(self, limit: int = 30) -> list[ExploreCategory]:
        cutoff = datetime.now(timezone.utc) - timedelta(seconds=CACHE_TTL_SECONDS)
        items = (
            await self.session.exec(
                select(ExploreCacheItem.genre).where(
                    ExploreCacheItem.section.in_(["popular", "latest"]),
                    ExploreCacheItem.fetched_at >= cutoff,
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
        return [ExploreCategory(name=name, count=count) for name, count in ranked]

    async def popular(
        self,
        page: int,
        limit: int,
        source_id: str | None = None,
        extension_pkgs: list[str] | None = None,
    ) -> ExploreFeed:
        return await self._cached_feed(
            section="popular",
            page=page,
            limit=limit,
            source_id=source_id,
            extension_pkgs=extension_pkgs,
        )

    async def latest(
        self,
        page: int,
        limit: int,
        source_id: str | None = None,
        extension_pkgs: list[str] | None = None,
    ) -> ExploreFeed:
        return await self._cached_feed(
            section="latest",
            page=page,
            limit=limit,
            source_id=source_id,
            extension_pkgs=extension_pkgs,
        )

    async def search(
        self,
        query: str,
        page: int,
        limit: int,
        source_id: str | None = None,
        extension_pkgs: list[str] | None = None,
        category: str | None = None,
        search_filters: dict[str, Any] | None = None,
    ) -> ExploreFeed:
        return await self._live_feed(
            section="search",
            page=page,
            limit=limit,
            source_id=source_id,
            extension_pkgs=extension_pkgs,
            query=query,
            category=category,
            search_filters=search_filters,
        )

    async def category(
        self,
        name: str,
        page: int,
        limit: int,
        source_id: str | None = None,
        extension_pkgs: list[str] | None = None,
        search_filters: dict[str, Any] | None = None,
    ) -> ExploreFeed:
        # Simple, scalable default: category query delegates to source search.
        return await self._live_feed(
            section="category",
            page=page,
            limit=limit,
            source_id=source_id,
            extension_pkgs=extension_pkgs,
            query=name,
            category=name,
            search_filters=search_filters,
        )

    async def search_filters(self, source_id: str) -> SourcePreferencesResource:
        return await self.extension_service.list_source_search_filters(source_id)

    async def title_details(
        self,
        source_id: str,
        title_url: str,
        refresh: bool = False,
    ) -> ExploreTitleDetailsResource:
        cache_row = await self.session.get(
            ExploreTitleDetailsCache,
            {
                "source_id": source_id,
                "title_url": title_url,
            },
        )
        now = datetime.now(timezone.utc)

        is_stale = True
        if cache_row is not None:
            fetched_at = _ensure_utc(cache_row.fetched_at)
            is_stale = (
                fetched_at + timedelta(seconds=TITLE_DETAILS_CACHE_TTL_SECONDS) < now
            )

        if cache_row is None or refresh or is_stale:
            details = await tachibridge.fetch_title_details(
                source_id=source_id,
                title_url=title_url,
            )
            status = _status_value(details.status)
            if cache_row is None:
                cache_row = ExploreTitleDetailsCache(
                    source_id=source_id,
                    title_url=title_url,
                    title=details.title,
                    status=status,
                    thumbnail_url=details.thumbnail_url or "",
                    artist=details.artist,
                    author=details.author,
                    description=details.description,
                    genre=details.genre,
                    fetched_at=now,
                )
            else:
                cache_row.title = details.title
                cache_row.status = status
                cache_row.thumbnail_url = details.thumbnail_url or ""
                cache_row.artist = details.artist
                cache_row.author = details.author
                cache_row.description = details.description
                cache_row.genre = details.genre
                cache_row.fetched_at = now
            self.session.add(cache_row)
            await self.session.commit()

        imported_library_id = await self.session.scalar(
            select(LibraryTitleVariant.library_title_id)
            .where(
                LibraryTitleVariant.source_id == source_id,
                LibraryTitleVariant.title_url == title_url,
            )
            .limit(1)
        )

        return ExploreTitleDetailsResource(
            source_id=cache_row.source_id,
            title_url=cache_row.title_url,
            title=cache_row.title,
            status=cache_row.status,
            thumbnail_url=cache_row.thumbnail_url,
            artist=cache_row.artist,
            author=cache_row.author,
            description=cache_row.description,
            genre=cache_row.genre,
            fetched_at=cache_row.fetched_at,
            imported_library_id=(
                int(imported_library_id) if imported_library_id is not None else None
            ),
        )

    async def refresh_enabled_sources_cache(self, max_pages: int = 2) -> None:
        _t0 = _time.monotonic()
        async with self._refresh_lock:
            sources = await self.list_sources(enabled=True)
            latest_sources = [source for source in sources if source.supports_latest]

            for page in range(1, max_pages + 1):
                await self._run_refreshes(
                    [
                        ("popular", source.id, page)
                        for source in sources
                    ]
                    + [
                        ("latest", source.id, page)
                        for source in latest_sources
                    ],
                    force=True,
                )

            _explore_logger.bind(
                sources=len(sources),
                latest_sources=len(latest_sources),
                max_pages=max_pages,
                duration_ms=round((_time.monotonic() - _t0) * 1000),
            ).info("explore.cache_refresh")

    async def _cached_feed(
        self,
        section: Literal["popular", "latest"],
        page: int,
        limit: int,
        source_id: str | None = None,
        extension_pkgs: list[str] | None = None,
    ) -> ExploreFeed:
        sources = await self.list_sources(
            enabled=True,
            supports_latest=True if section == "latest" else None,
        )
        sources = self._filter_sources(
            sources,
            source_id=source_id,
            extension_pkgs=extension_pkgs,
        )

        if not sources:
            return ExploreFeed(
                section=section,
                page=page,
                limit=limit,
                has_next_page=False,
                items=[],
            )

        refresh_targets = [
            (section, source.id, page)
            for source in sources
            if await self._needs_refresh(
                section=section, source_id=source.id, page=page
            )
        ]
        if refresh_targets:
            await self._run_refreshes(refresh_targets, force=True)

        source_items: dict[str, list[ExploreCacheItem]] = {}
        has_next_page = False

        for source in sources:
            rows = (
                await self.session.exec(
                    select(ExploreCacheItem)
                    .where(
                        ExploreCacheItem.section == section,
                        ExploreCacheItem.source_id == source.id,
                        ExploreCacheItem.page == page,
                    )
                    .order_by(ExploreCacheItem.rank)
                )
            ).all()
            source_items[source.id] = list(rows)

            page_meta = await self.session.get(
                ExploreCachePage,
                {
                    "section": section,
                    "source_id": source.id,
                    "page": page,
                },
            )
            if page_meta and page_meta.has_next_page:
                has_next_page = True

        merged = self._merge_cached_items(sources, source_items)
        await self._attach_imported_library_ids(merged, auto_link_missing=False)

        return ExploreFeed(
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
        extension_pkgs: list[str] | None = None,
        query: str | None = None,
        category: str | None = None,
        search_filters: dict[str, Any] | None = None,
    ) -> ExploreFeed:
        sources = await self.list_sources(enabled=True)
        sources = self._filter_sources(
            sources,
            source_id=source_id,
            extension_pkgs=extension_pkgs,
        )

        if not sources:
            return ExploreFeed(
                section=section,
                page=page,
                limit=limit,
                query=query,
                category=category,
                has_next_page=False,
                items=[],
            )

        source_items: dict[str, list[ExploreCacheItem]] = {}
        has_next_page = False
        now = datetime.now(timezone.utc)

        search_results = await self._search_sources(
            sources=sources,
            query=query or "",
            page=page,
            search_filters=search_filters,
        )

        for source, titles, source_has_next in search_results:
            if category:
                titles = [
                    title
                    for title in titles
                    if _genre_contains_category(title.genre, category)
                ]
            has_next_page = has_next_page or source_has_next

            source_items[source.id] = [
                ExploreCacheItem(
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
        await self._attach_imported_library_ids(merged, auto_link_missing=True)

        return ExploreFeed(
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
            ExploreCachePage,
            {"section": section, "source_id": source_id, "page": page},
        )
        if row is None:
            return True
        fetched_at = _ensure_utc(row.fetched_at)
        return fetched_at + timedelta(seconds=CACHE_TTL_SECONDS) < datetime.now(
            timezone.utc
        )

    async def _run_refreshes(
        self,
        targets: list[tuple[Literal["popular", "latest"], str, int]],
        force: bool,
    ) -> None:
        if not targets:
            return

        semaphore = asyncio.Semaphore(SOURCE_FETCH_CONCURRENCY)

        async def run_one(
            section: Literal["popular", "latest"],
            source_id: str,
            page: int,
        ) -> None:
            async with semaphore:
                try:
                    await self._refresh_source_page_isolated(
                        section=section,
                        source_id=source_id,
                        page=page,
                        force=force,
                    )
                except Exception:
                    _explore_logger.bind(
                        section=section,
                        source_id=source_id,
                        page=page,
                    ).exception("explore.cache_refresh_source")

        await asyncio.gather(
            *(run_one(section, source_id, page) for section, source_id, page in targets)
        )

    async def _refresh_source_page_isolated(
        self,
        section: Literal["popular", "latest"],
        source_id: str,
        page: int,
        force: bool = False,
    ) -> None:
        async with sessionmanager.session() as session:
            service = ExploreService(session)
            await service._refresh_source_page(
                section=section,
                source_id=source_id,
                page=page,
                force=force,
            )

    async def _search_sources(
        self,
        sources: list[SourceSummary],
        query: str,
        page: int,
        search_filters: dict[str, Any] | None,
    ) -> list[tuple[SourceSummary, list[ExtensionSourceTitle], bool]]:
        semaphore = asyncio.Semaphore(SOURCE_FETCH_CONCURRENCY)

        async def run_one(
            source: SourceSummary,
        ) -> tuple[SourceSummary, list[ExtensionSourceTitle], bool]:
            async with semaphore:
                titles, source_has_next = await tachibridge.search_titles(
                    source_id=source.id,
                    query=query,
                    page=page,
                    search_filters=search_filters,
                )
                return source, titles, source_has_next

        return list(await asyncio.gather(*(run_one(source) for source in sources)))

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
            delete(ExploreCacheItem).where(
                ExploreCacheItem.section == section,
                ExploreCacheItem.source_id == source_id,
                ExploreCacheItem.page == page,
            )
        )

        items = [
            ExploreCacheItem(
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
            ExploreCachePage,
            {"section": section, "source_id": source_id, "page": page},
        )
        if page_meta is None:
            page_meta = ExploreCachePage(
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

    async def _attach_imported_library_ids(
        self,
        items: list[ExploreItem],
        auto_link_missing: bool = False,
    ) -> None:
        source_ids = {link.source.id for item in items for link in item.links}
        title_urls = {link.title_url for item in items for link in item.links}
        if not source_ids:
            return

        stmt = select(
            LibraryTitleVariant.source_id,
            LibraryTitleVariant.title_url,
            LibraryTitleVariant.library_title_id,
        ).where(LibraryTitleVariant.source_id.in_(source_ids))
        if title_urls:
            stmt = stmt.where(LibraryTitleVariant.title_url.in_(title_urls))
        rows = (await self.session.exec(stmt)).all()
        lookup = {
            (source_id, title_url): int(library_id)
            for source_id, title_url, library_id in rows
        }

        dedupe_keys = {item.dedupe_key for item in items if item.dedupe_key}
        canonical_lookup: dict[str, int] = {}
        if dedupe_keys:
            canonical_rows = (
                await self.session.exec(
                    select(LibraryTitle.canonical_key, LibraryTitle.id).where(
                        LibraryTitle.canonical_key.in_(dedupe_keys)
                    )
                )
            ).all()
            canonical_lookup = {
                str(canonical_key): int(title_id)
                for canonical_key, title_id in canonical_rows
            }

        # Auto-merge split library titles when the same explore item points
        # to multiple canonical IDs.
        merged_redirects: dict[int, int] = {}
        merge_service = None

        def _resolve_merged_title_id(title_id: int) -> int:
            resolved = int(title_id)
            guard = 0
            while resolved in merged_redirects and guard < 32:
                resolved = int(merged_redirects[resolved])
                guard += 1
            return resolved

        async def _ensure_merge_service():
            nonlocal merge_service
            if merge_service is None:
                from app.features.library.service import LibraryService

                merge_service = LibraryService(self.session)
            return merge_service

        for item in items:
            item_ids = sorted(
                {
                    _resolve_merged_title_id(lookup[(link.source.id, link.title_url)])
                    for link in item.links
                    if (link.source.id, link.title_url) in lookup
                }
            )
            if len(item_ids) <= 1:
                continue

            target_id = int(item_ids[0])
            for source_id in item_ids[1:]:
                normalized_source_id = _resolve_merged_title_id(source_id)
                if normalized_source_id == target_id:
                    continue
                try:
                    service = await _ensure_merge_service()
                    await service.merge_titles(
                        target_title_id=target_id,
                        source_title_id=normalized_source_id,
                    )
                    merged_redirects[normalized_source_id] = target_id
                except Exception:
                    # Best-effort only; feed should still load.
                    continue

            for key, value in list(lookup.items()):
                lookup[key] = _resolve_merged_title_id(value)
            canonical_lookup = {
                key: _resolve_merged_title_id(value)
                for key, value in canonical_lookup.items()
            }

        auto_link_budget = AUTO_LINK_EXPLORE_MAX_ITEMS if auto_link_missing else 0
        for item in items:
            imported_id: int | None = canonical_lookup.get(item.dedupe_key)
            for link in item.links:
                imported_id = lookup.get((link.source.id, link.title_url), imported_id)
                if imported_id is not None:
                    break

            if imported_id is not None and auto_link_budget > 0:
                unresolved_links = [
                    link
                    for link in item.links
                    if (link.source.id, link.title_url) not in lookup
                ]
                for link in unresolved_links:
                    if auto_link_budget <= 0:
                        break
                    try:
                        service = await _ensure_merge_service()
                        await service.link_variant(
                            title_id=int(imported_id),
                            source_id=link.source.id,
                            title_url=link.title_url,
                        )
                        lookup[(link.source.id, link.title_url)] = int(imported_id)
                        auto_link_budget -= 1
                    except Exception:
                        continue

            item.imported_library_id = int(imported_id) if imported_id is not None else None

    @staticmethod
    def _merge_cached_items(
        sources: list[SourceSummary],
        source_items: dict[str, list[ExploreCacheItem]],
    ) -> list[ExploreItem]:
        source_by_id = {source.id: source for source in sources}
        source_order = {source.id: idx for idx, source in enumerate(sources)}
        merged: dict[str, ExploreItem] = {}
        ordering: list[str] = []

        for source in sources:
            for item in source_items.get(source.id, []):
                dedupe_key = item.dedupe_key or _dedupe_key(item.title, item.author)
                source_url_key = title_url_group_key(item.title_url)
                extension_url_key = (
                    f"ext::{source.extension_pkg}::{source_url_key}"
                    if source_url_key
                    else ""
                )

                key_candidates = [candidate for candidate in [extension_url_key, dedupe_key] if candidate]
                if not key_candidates:
                    key_candidates = [f"raw::{source.id}::{item.page}:{item.rank}"]
                existing_key = next((candidate for candidate in key_candidates if candidate in merged), None)
                key = existing_key or key_candidates[0]

                source_link = ExploreSourceLink(
                    source=source,
                    title_url=item.title_url,
                )

                existing = merged.get(key)
                if existing is None:
                    merged[key] = ExploreItem(
                        dedupe_key=dedupe_key,
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

    @staticmethod
    def _filter_sources(
        sources: list[SourceSummary],
        source_id: str | None = None,
        extension_pkgs: list[str] | None = None,
    ) -> list[SourceSummary]:
        filtered = sources

        if extension_pkgs:
            allowed_pkgs = {
                pkg.strip()
                for pkg in extension_pkgs
                if isinstance(pkg, str) and pkg.strip()
            }
            if allowed_pkgs:
                filtered = [
                    source
                    for source in filtered
                    if source.extension_pkg in allowed_pkgs
                ]

        if source_id:
            filtered = [source for source in filtered if source.id == source_id]

        return filtered
