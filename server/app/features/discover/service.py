import json
from typing import Literal

from sqlmodel.ext.asyncio.session import AsyncSession

from app.bridge import tachibridge
from app.features.discover.storage import TitleStorage
from app.features.extensions import ExtensionService
from app.models import CanonicalTitle, SourceTitle
from loguru import logger as service_logger

logger = service_logger.bind(module="service.dicover")


class DiscoverService:
    def __init__(self, session: AsyncSession):
        self.title_storage = TitleStorage(session)
        self.extension_service = ExtensionService(session)

    async def _fetch_page_from_source(
        self, source_id: str, section: Literal["popular", "latest"], page: int
    ) -> tuple[list[CanonicalTitle], bool]:
        """
        Fetch a single page from a source and store in database.
        Returns (canonical_titles, has_next_page).
        """
        # Determine which bridge function to use
        fetch_fn = (
            tachibridge.fetch_popular_titles
            if section == "popular"
            else tachibridge.fetch_latest_titles
        )

        # Fetch from bridge
        titles_list, has_next_page = await fetch_fn(source_id=source_id, page=page)

        if not titles_list:
            # Mark page as fetched even if empty
            await self.title_storage.mark_page_fetched(
                source_id=source_id,
                section=section,
                page=page,
                title_count=0,
                has_next_page=False,
            )
            return [], False

        # Convert to SourceTitle objects
        source_titles = [
            SourceTitle(**t.model_dump(), source_id=source_id) for t in titles_list
        ]

        # Store in database
        canonical_titles = await self.title_storage.link_or_create_bulk(source_titles)

        # Mark page as fetched
        await self.title_storage.mark_page_fetched(
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
        """
        Fetch next batch of titles from sources.
        Returns up to 'limit' new titles.
        """
        sources = await self.extension_service.list_enabled_sources(
            True if section == "latest" else None
        )

        new_titles = []

        for extension, source in sources:
            logger.debug(source)
            if len(new_titles) >= limit:
                break

            # Get next page to fetch from this source
            next_page = await self.title_storage.get_next_page_to_fetch(
                source_id=source.id, section=section
            )

            if next_page is None:
                continue  # This source is exhausted

            try:
                canonical_titles, has_next = await self._fetch_page_from_source(
                    source_id=source.id, section=section, page=next_page
                )

                # Add only new titles (deduplication)
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
        """
        Stream titles for a given section.

        Flow:
        1. Try to get titles from database (cached)
        2. If not enough, fetch more from sources
        3. Stream titles one by one
        4. Return cursor for next request
        """
        seen_ids = set()
        titles_to_send = []

        # Phase 1: Get from database (fast)
        (
            db_titles,
            next_cursor,
            has_more,
        ) = await self.title_storage.list_canonical_titles(
            section=section, cursor=cursor, limit=limit
        )

        for title in db_titles:
            if title.id not in seen_ids:
                seen_ids.add(title.id)
                titles_to_send.append(title)

        yield f"data: {
            json.dumps(
                {
                    'type': 'status',
                    'message': f'Loaded {len(titles_to_send)} titles from cache',
                }
            )
        }\n\n"

        # Phase 2: If we need more, fetch from sources
        if len(titles_to_send) < limit:
            needed = limit - len(titles_to_send)

            yield f"data: {
                json.dumps(
                    {
                        'type': 'status',
                        'message': f'Fetching {needed} more titles from sources...',
                    }
                )
            }\n\n"

            new_titles = await self._fetch_next_batch(
                section=section, limit=needed, seen_ids=seen_ids
            )

            titles_to_send.extend(new_titles)

        # Phase 3: Stream all titles
        for idx, title in enumerate(titles_to_send):
            yield f"data: {
                json.dumps(
                    {
                        'type': 'title',
                        'id': title.id,
                        'title': title.title,
                        'progress': {'current': idx + 1, 'total': len(titles_to_send)},
                    }
                )
            }\n\n"

        # Phase 4: Send completion with next cursor
        final_cursor = titles_to_send[-1].id if titles_to_send else cursor

        yield f"data: {
            json.dumps(
                {
                    'type': 'complete',
                    'cursor': final_cursor,
                    'has_more': len(titles_to_send)
                    == limit,  # If we got full limit, there might be more
                    'count': len(titles_to_send),
                }
            )
        }\n\n"

    async def stream_popular_titles(self, cursor: int = 0, limit: int = 20):
        """Stream popular titles with cursor-based pagination."""
        async for event in self.stream_titles("popular", cursor, limit):
            yield event

    async def stream_latest_titles(self, cursor: int = 0, limit: int = 20):
        """Stream latest titles with cursor-based pagination."""
        async for event in self.stream_titles("latest", cursor, limit):
            yield event
