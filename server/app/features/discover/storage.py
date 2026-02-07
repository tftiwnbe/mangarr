from app.core.storage import Storage
from sqlmodel import select, and_, desc
from datetime import datetime, timedelta, timezone
from typing import Optional

from app.models import SourceTitle, CanonicalTitle, FetchedSectionPage
from loguru import logger as storage_logger

logger = storage_logger.bind(module="storage.title")


class TitleStorage(Storage[CanonicalTitle]):
    async def list_canonical_titles(
        self, section: str, cursor: int = 0, limit: int = 20
    ) -> tuple[list[CanonicalTitle], int, bool]:
        """
        Get canonical titles from database with cursor-based pagination.
        Returns (titles, next_cursor, has_more).
        """
        stmt = (
            select(CanonicalTitle)
            .where(CanonicalTitle.id > cursor)
            .order_by(CanonicalTitle.id)
            .limit(limit + 1)  # Fetch one extra to check if there's more
        )

        result = await self.session.exec(stmt)
        titles = list(result.all())

        has_more = len(titles) > limit
        if has_more:
            titles = titles[:limit]

        next_cursor = int(titles[-1].id) if titles else cursor
        return titles, next_cursor, has_more

    async def get_cached_page_titles(
        self, source_id: str, section: str, page: int
    ) -> Optional[list[CanonicalTitle]]:
        """
        Get titles from a specific cached page.
        Returns None if page wasn't fetched or is stale.
        """
        # Check if page exists and is fresh
        fetched = await self.session.get(
            FetchedSectionPage,
            {"source_id": source_id, "section": section, "page": page},
        )

        if not fetched:
            return None

        # Check if stale (older than 24 hours)
        age = datetime.now(timezone.utc) - fetched.fetched_at
        if age > timedelta(hours=24):
            return None

        # Get the source titles from this page
        # This assumes SourceTitle has a page field - if not, we need another approach
        stmt = (
            select(CanonicalTitle)
            .join(SourceTitle)
            .where(
                and_(
                    SourceTitle.source_id == source_id,
                    SourceTitle.canonical_title_id == CanonicalTitle.id,
                )
            )
            .distinct()
        )

        result = await self.session.exec(stmt)
        return list(result.all())

    async def get_last_fetched_page(self, source_id: str, section: str) -> int:
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

    async def get_next_page_to_fetch(
        self, source_id: str, section: str
    ) -> Optional[int]:
        """
        Get the next page number we should fetch.
        Returns None if source is exhausted.
        """
        last_page = await self.get_last_fetched_page(source_id, section)

        if last_page == 0:
            return 1  # Start from page 1

        # Check if last page had more
        last_fetched = await self.session.get(
            FetchedSectionPage,
            {"source_id": source_id, "section": section, "page": last_page},
        )

        if last_fetched and last_fetched.has_next_page:
            return last_page + 1

        return None  # Source is exhausted

    async def mark_page_fetched(
        self,
        source_id: str,
        section: str,
        page: int,
        title_count: int,
        has_next_page: bool,
    ):
        """Mark a page as fetched."""
        fetched = FetchedSectionPage(
            source_id=source_id,
            section=section,
            page=page,
            title_count=title_count,
            has_next_page=has_next_page,
            fetched_at=datetime.now(timezone.utc),
        )

        # Try to get existing
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
            self.session.add(fetched)

        await self.session.commit()

    async def link_or_create(self, source_title: SourceTitle) -> CanonicalTitle:
        """
        Link a single SourceTitle to existing CanonicalTitle or create new one.
        Returns the canonical title.
        """
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

        if existing_source:
            # Already exists, return its canonical title
            if existing_source.canonical_title_id:
                canonical = await self.session.get(
                    CanonicalTitle, existing_source.canonical_title_id
                )
                if canonical:
                    return canonical

        # Try to find existing CanonicalTitle by matching title/artist/author
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

        # Create new CanonicalTitle if none exists
        if not canonical_title:
            canonical_title = CanonicalTitle(title=source_title.title)
            self.session.add(canonical_title)
            await self.session.flush()
            await self.session.refresh(canonical_title)

        # Link SourceTitle to CanonicalTitle
        source_title.canonical_title_id = canonical_title.id
        self.session.add(source_title)
        await self.session.commit()

        await self.session.refresh(canonical_title)
        return canonical_title

    async def link_or_create_bulk(
        self, source_titles: list[SourceTitle]
    ) -> list[CanonicalTitle]:
        """
        Link multiple SourceTitles, processing them one by one.
        Returns list of canonical titles (may contain duplicates if multiple sources map to same canonical).
        """
        linked_canonical_titles = []

        for source_title in source_titles:
            try:
                canonical = await self.link_or_create(source_title)
                linked_canonical_titles.append(canonical)
            except Exception as e:
                # Log and skip this title, continue with others
                logger.error(f"Error linking title {source_title.title}: {e}")
                await self.session.rollback()
                continue

        return linked_canonical_titles
