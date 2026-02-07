import json
from datetime import datetime, timedelta, timezone
from typing import Literal, Optional

from loguru import logger as service_logger
from sqlmodel import select, and_, desc
from sqlmodel.ext.asyncio.session import AsyncSession

from app.bridge import tachibridge
from app.features.extensions import ExtensionService
from app.models import CanonicalTitle, SourceTitle, FetchedSectionPage

logger = service_logger.bind(module="service.discover")


class DiscoverService:
    def __init__(self, session: AsyncSession):
        self.session = session
        self.extension_service = ExtensionService(session)

    # Database operations (inlined from storage)

    async def _list_canonical_titles(
        self, section: str, cursor: int = 0, limit: int = 20
    ) -> tuple[list[CanonicalTitle], int, bool]:
        """Get canonical titles with cursor-based pagination."""
        stmt = (
            select(CanonicalTitle)
            .where(CanonicalTitle.id > cursor)
            .order_by(CanonicalTitle.id)
            .limit(limit + 1)
        )

        result = await self.session.exec(stmt)
        titles = list(result.all())

        has_more = len(titles) > limit
        if has_more:
            titles = titles[:limit]

        next_cursor = int(titles[-1].id) if titles else cursor
        return titles, next_cursor, has_more

    async def _get_last_fetched_page(self, source_id: str, section: str) -> int:
        """Get the highest page number we've fetched from this source."""
        stmt = (
            select(FetchedSectionPage.page)
            .where(
                and_(
                    FetchedSectionPage.source_id == source_id,
                    FetchedSectionPage.section == section,
                )
            )
            .order_by(desc(FetchedSectionPage.page))
            .limit(1)
        )

        result = await self.session.exec(stmt)
        page = result.first()
        return page if page else 0

    async def _get_next_page_to_fetch(
        self, source_id: str, section: str
    ) -> Optional[int]:
        """Get the next page number we should fetch."""
        last_page = await self._get_last_fetched_page(source_id, section)

        if last_page == 0:
            return 1

        last_fetched = await self.session.get(
            FetchedSectionPage,
            {"source_id": source_id, "section": section, "page": last_page},
        )

        if last_fetched and last_fetched.has_next_page:
            return last_page + 1

        return None

    async def _mark_page_fetched(
        self,
        source_id: str,
        section: str,
        page: int,
        title_count: int,
        has_next_page: bool,
    ):
        """Mark a page as fetched."""
        existing = await self.session.get(
            FetchedSectionPage,
            {"source_id": source_id, "section": section, "page": page},
        )

        if existing:
            existing.fetched_at = datetime.now(timezone.utc)
            existing.title_count = title_count
            existing.has_next_page = has_next_page
            self.session.add(existing)
        else:
            fetched = FetchedSectionPage(
                source_id=source_id,
                section=section,
                page=page,
                title_count=title_count,
                has_next_page=has_next_page,
                fetched_at=datetime.now(timezone.utc),
            )
            self.session.add(fetched)

        await self.session.commit()

    async def _link_or_create(self, source_title: SourceTitle) -> CanonicalTitle:
        """Link a SourceTitle to existing CanonicalTitle or create new one."""
        # Check if this SourceTitle already exists
        existing_source = (
            await self.session.exec(
                select(SourceTitle).where(
                    and_(
                        SourceTitle.url == source_title.url,
                        SourceTitle.source_id == source_title.source_id,
                    )
                )
            )
        ).first()

        if existing_source and existing_source.canonical_title_id:
            canonical = await self.session.get(
                CanonicalTitle, existing_source.canonical_title_id
            )
            if canonical:
                return canonical

        # Try to find existing CanonicalTitle by matching title
        conditions = [
            CanonicalTitle.sources_titles.any(
                SourceTitle.title.ilike(source_title.title)
            )
        ]
        if source_title.artist:
            conditions.append(
                CanonicalTitle.sources_titles.any(
                    SourceTitle.artist == source_title.artist
                )
            )
        if source_title.author:
            conditions.append(
                CanonicalTitle.sources_titles.any(
                    SourceTitle.author == source_title.author
                )
            )

        stmt = select(CanonicalTitle).where(and_(*conditions))
        canonical_title = (await self.session.exec(stmt)).first()

        if not canonical_title:
            canonical_title = CanonicalTitle(title=source_title.title)
            self.session.add(canonical_title)
            await self.session.flush()
            await self.session.refresh(canonical_title)

        source_title.canonical_title_id = canonical_title.id
        self.session.add(source_title)
        await self.session.commit()

        await self.session.refresh(canonical_title)
        return canonical_title

    async def _link_or_create_bulk(
        self, source_titles: list[SourceTitle]
    ) -> list[CanonicalTitle]:
        """Link multiple SourceTitles to canonical titles."""
        linked_canonical_titles = []

        for source_title in source_titles:
            try:
                canonical = await self._link_or_create(source_title)
                linked_canonical_titles.append(canonical)
            except Exception as e:
                logger.error(f"Error linking title {source_title.title}: {e}")
                await self.session.rollback()
                continue

        return linked_canonical_titles

    # Service methods

    async def _fetch_page_from_source(
        self, source_id: str, section: Literal["popular", "latest"], page: int
    ) -> tuple[list[CanonicalTitle], bool]:
        """Fetch a single page from a source and store in database."""
        fetch_fn = (
            tachibridge.fetch_popular_titles
            if section == "popular"
            else tachibridge.fetch_latest_titles
        )

        titles_list, has_next_page = await fetch_fn(source_id=source_id, page=page)

        if not titles_list:
            await self._mark_page_fetched(
                source_id=source_id,
                section=section,
                page=page,
                title_count=0,
                has_next_page=False,
            )
            return [], False

        source_titles = [
            SourceTitle(**t.model_dump(), source_id=source_id) for t in titles_list
        ]

        canonical_titles = await self._link_or_create_bulk(source_titles)

        await self._mark_page_fetched(
            source_id=source_id,
            section=section,
            page=page,
            title_count=len(canonical_titles),
            has_next_page=has_next_page,
        )

        return canonical_titles, has_next_page

    async def _fetch_next_batch(
        self, section: Literal["popular", "latest"], limit: int, seen_ids: set[int]
    ) -> list[CanonicalTitle]:
        """Fetch next batch of titles from sources."""
        sources = await self.extension_service.list_enabled_sources(
            True if section == "latest" else None
        )

        new_titles = []

        for extension, source in sources:
            logger.debug(source)
            if len(new_titles) >= limit:
                break

            next_page = await self._get_next_page_to_fetch(
                source_id=source.id, section=section
            )

            if next_page is None:
                continue

            try:
                canonical_titles, has_next = await self._fetch_page_from_source(
                    source_id=source.id, section=section, page=next_page
                )

                for title in canonical_titles:
                    if title.id not in seen_ids and len(new_titles) < limit:
                        seen_ids.add(int(title.id))
                        new_titles.append(title)

            except Exception as e:
                logger.error(f"Error fetching from source {source.id}: {e}")
                continue

        return new_titles

    async def stream_titles(
        self, section: Literal["popular", "latest"], cursor: int = 0, limit: int = 20
    ):
        """Stream titles for a given section."""
        seen_ids = set()
        titles_to_send = []

        db_titles, next_cursor, has_more = await self._list_canonical_titles(
            section=section, cursor=cursor, limit=limit
        )

        for title in db_titles:
            if title.id not in seen_ids:
                seen_ids.add(title.id)
                titles_to_send.append(title)

        yield f"data: {json.dumps({'type': 'status', 'message': f'Loaded {len(titles_to_send)} titles from cache'})}\n\n"

        if len(titles_to_send) < limit:
            needed = limit - len(titles_to_send)

            yield f"data: {json.dumps({'type': 'status', 'message': f'Fetching {needed} more titles from sources...'})}\n\n"

            new_titles = await self._fetch_next_batch(
                section=section, limit=needed, seen_ids=seen_ids
            )

            titles_to_send.extend(new_titles)

        for idx, title in enumerate(titles_to_send):
            yield f"data: {json.dumps({'type': 'title', 'id': title.id, 'title': title.title, 'progress': {'current': idx + 1, 'total': len(titles_to_send)}})}\n\n"

        final_cursor = titles_to_send[-1].id if titles_to_send else cursor

        yield f"data: {json.dumps({'type': 'complete', 'cursor': final_cursor, 'has_more': len(titles_to_send) == limit, 'count': len(titles_to_send)})}\n\n"

    async def stream_popular_titles(self, cursor: int = 0, limit: int = 20):
        """Stream popular titles with cursor-based pagination."""
        async for event in self.stream_titles("popular", cursor, limit):
            yield event

    async def stream_latest_titles(self, cursor: int = 0, limit: int = 20):
        """Stream latest titles with cursor-based pagination."""
        async for event in self.stream_titles("latest", cursor, limit):
            yield event
