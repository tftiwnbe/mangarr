import re
from datetime import datetime, timezone
from urllib.parse import quote

from sqlmodel import delete, desc, func, select
from sqlmodel.ext.asyncio.session import AsyncSession

from app.bridge import tachibridge
from app.config import settings
from app.core.errors import BridgeAPIError
from app.features.extensions import ExtensionService
from app.models import (
    LibraryChapter,
    LibraryChapterPage,
    LibraryChapterPageResource,
    LibraryChapterResource,
    LibraryImportRequest,
    LibraryImportResponse,
    LibraryReaderChapterResource,
    LibraryTitle,
    LibraryTitleResource,
    LibraryTitleSummary,
    LibraryTitleVariant,
    LibraryTitleVariantResource,
    ReaderPageResource,
    SourceChapter,
    SourceSummary,
)

_NORMALIZE_RE = re.compile(r"[^a-z0-9]+")


def _normalize(value: str | None) -> str:
    if not value:
        return ""
    lowered = value.strip().lower()
    return _NORMALIZE_RE.sub(" ", lowered).strip()


def _canonical_key(title: str, author: str | None = None) -> str:
    base = _normalize(title)
    author_part = _normalize(author)
    return f"{base}|{author_part}" if author_part else base


def _status_value(value: object) -> int:
    raw = getattr(value, "value", value)
    return int(raw)


class LibraryService:
    def __init__(self, session: AsyncSession):
        self.session = session
        self.extension_service = ExtensionService(session)

    async def list_titles(self, offset: int = 0, limit: int = 20) -> list[LibraryTitleSummary]:
        title_rows = (
            await self.session.exec(
                select(LibraryTitle)
                .order_by(desc(LibraryTitle.updated_at))
                .offset(offset)
                .limit(limit)
            )
        ).all()
        titles = list(title_rows)
        if not titles:
            return []

        title_ids = [title.id for title in titles if title.id is not None]

        variants_count_rows = (
            await self.session.exec(
                select(
                    LibraryTitleVariant.library_title_id,
                    func.count(LibraryTitleVariant.id),
                )
                .where(LibraryTitleVariant.library_title_id.in_(title_ids))
                .group_by(LibraryTitleVariant.library_title_id)
            )
        ).all()
        variants_count = {int(title_id): int(count) for title_id, count in variants_count_rows}

        chapters_count_rows = (
            await self.session.exec(
                select(
                    LibraryChapter.library_title_id,
                    func.count(LibraryChapter.id),
                )
                .where(LibraryChapter.library_title_id.in_(title_ids))
                .group_by(LibraryChapter.library_title_id)
            )
        ).all()
        chapters_count = {int(title_id): int(count) for title_id, count in chapters_count_rows}

        return [
            LibraryTitleSummary(
                id=int(title.id),
                title=title.title,
                thumbnail_url=title.thumbnail_url,
                status=title.status,
                variants_count=variants_count.get(int(title.id), 0),
                chapters_count=chapters_count.get(int(title.id), 0),
            )
            for title in titles
            if title.id is not None
        ]

    async def get_title(self, title_id: int) -> LibraryTitleResource:
        title = await self.session.get(LibraryTitle, title_id)
        if title is None:
            raise BridgeAPIError(404, f"Library title not found: {title_id}")

        variant_rows = (
            await self.session.exec(
                select(LibraryTitleVariant)
                .where(LibraryTitleVariant.library_title_id == title_id)
                .order_by(LibraryTitleVariant.id)
            )
        ).all()
        variants = list(variant_rows)

        return LibraryTitleResource(
            id=title_id,
            canonical_key=title.canonical_key,
            title=title.title,
            thumbnail_url=title.thumbnail_url,
            description=title.description,
            artist=title.artist,
            author=title.author,
            genre=title.genre,
            status=title.status,
            variants=[self._to_variant_resource(variant) for variant in variants],
        )

    async def import_title(self, request: LibraryImportRequest) -> LibraryImportResponse:
        source = await self._resolve_source(request.source_id)
        details = await tachibridge.fetch_title_details(
            source_id=request.source_id,
            title_url=request.title_url,
        )
        chapters = await tachibridge.fetch_title_chapters(
            source_id=request.source_id,
            title_url=request.title_url,
        )

        now = datetime.now(timezone.utc)
        key = _canonical_key(details.title, details.author)

        variant = (
            await self.session.exec(
                select(LibraryTitleVariant).where(
                    LibraryTitleVariant.source_id == request.source_id,
                    LibraryTitleVariant.title_url == request.title_url,
                )
            )
        ).first()

        created = False
        if variant is None:
            library_title = await self._find_or_create_library_title(key, details.title)
            if library_title.id is None:
                await self.session.flush()
                await self.session.refresh(library_title)

            variant = LibraryTitleVariant(
                library_title_id=int(library_title.id),
                source_id=request.source_id,
                source_name=source.name,
                source_lang=source.lang,
                title_url=request.title_url,
                title=details.title,
                thumbnail_url=details.thumbnail_url or "",
                description=details.description,
                artist=details.artist,
                author=details.author,
                genre=details.genre,
                status=_status_value(details.status),
                created_at=now,
                updated_at=now,
                last_synced_at=now,
            )
            self.session.add(variant)
            created = True
        else:
            library_title = await self.session.get(LibraryTitle, variant.library_title_id)
            if library_title is None:
                raise BridgeAPIError(500, f"Broken library variant: {variant.id}")
            variant.source_name = source.name
            variant.source_lang = source.lang
            variant.title = details.title
            variant.thumbnail_url = details.thumbnail_url or ""
            variant.description = details.description
            variant.artist = details.artist
            variant.author = details.author
            variant.genre = details.genre
            variant.status = _status_value(details.status)
            variant.updated_at = now
            variant.last_synced_at = now
            self.session.add(variant)

        self._sync_title_snapshot(library_title, details, now)
        self.session.add(library_title)

        await self.session.flush()
        await self.session.refresh(variant)

        await self._sync_variant_chapters(
            library_title_id=int(library_title.id),
            variant_id=int(variant.id),
            chapters=chapters,
            now=now,
        )

        await self.session.commit()

        return LibraryImportResponse(
            library_title_id=int(library_title.id),
            created=created,
        )

    async def list_chapters(
        self,
        title_id: int,
        variant_id: int | None = None,
        refresh: bool = False,
    ) -> list[LibraryChapterResource]:
        title = await self.session.get(LibraryTitle, title_id)
        if title is None:
            raise BridgeAPIError(404, f"Library title not found: {title_id}")

        variant = await self._resolve_variant(title_id=title_id, variant_id=variant_id)
        if refresh:
            await self._refresh_variant(title, variant)

        chapter_rows = (
            await self.session.exec(
                select(LibraryChapter)
                .where(LibraryChapter.variant_id == int(variant.id))
                .order_by(desc(LibraryChapter.chapter_number), desc(LibraryChapter.date_upload))
            )
        ).all()

        return [
            LibraryChapterResource(
                id=int(chapter.id),
                variant_id=int(chapter.variant_id),
                chapter_url=chapter.chapter_url,
                name=chapter.name,
                chapter_number=chapter.chapter_number,
                scanlator=chapter.scanlator,
                date_upload=chapter.date_upload,
                is_read=chapter.is_read,
                is_downloaded=chapter.is_downloaded,
                downloaded_at=chapter.downloaded_at,
                download_path=chapter.download_path,
                download_error=chapter.download_error,
            )
            for chapter in chapter_rows
            if chapter.id is not None
        ]

    async def get_chapter_pages(
        self,
        chapter_id: int,
        refresh: bool = False,
    ) -> list[LibraryChapterPageResource]:
        chapter = await self.session.get(LibraryChapter, chapter_id)
        if chapter is None:
            raise BridgeAPIError(404, f"Library chapter not found: {chapter_id}")

        variant = await self.session.get(LibraryTitleVariant, chapter.variant_id)
        if variant is None:
            raise BridgeAPIError(500, f"Library chapter has no variant: {chapter_id}")

        cached_rows = (
            await self.session.exec(
                select(LibraryChapterPage)
                .where(LibraryChapterPage.chapter_id == chapter_id)
                .order_by(LibraryChapterPage.page_index)
            )
        ).all()
        cached_pages = list(cached_rows)

        if refresh or not cached_pages:
            pages = await tachibridge.fetch_chapter_pages(
                source_id=variant.source_id,
                chapter_url=chapter.chapter_url,
            )

            existing_by_index = {item.page_index: item for item in cached_pages}
            seen_indexes: set[int] = set()
            now = datetime.now(timezone.utc)

            for page in pages:
                model = existing_by_index.get(page.index)
                if model is None:
                    model = LibraryChapterPage(
                        chapter_id=chapter_id,
                        page_index=page.index,
                    )

                model.url = page.url
                model.image_url = page.image_url
                model.fetched_at = now
                self.session.add(model)
                seen_indexes.add(page.index)

            stale_indexes = [
                item.page_index
                for item in cached_pages
                if item.page_index not in seen_indexes
            ]
            if stale_indexes:
                await self.session.exec(
                    delete(LibraryChapterPage).where(
                        LibraryChapterPage.chapter_id == chapter_id,
                        LibraryChapterPage.page_index.in_(stale_indexes),
                    )
                )

            chapter.updated_at = datetime.now(timezone.utc)
            self.session.add(chapter)
            await self.session.commit()

            cached_rows = (
                await self.session.exec(
                    select(LibraryChapterPage)
                    .where(LibraryChapterPage.chapter_id == chapter_id)
                    .order_by(LibraryChapterPage.page_index)
                )
            ).all()
            cached_pages = list(cached_rows)

        return [
            LibraryChapterPageResource(
                id=int(page.id),
                page_index=page.page_index,
                url=page.url,
                image_url=page.image_url,
                local_path=page.local_path,
                local_size=page.local_size,
            )
            for page in cached_pages
            if page.id is not None
        ]

    async def get_chapter_reader(
        self,
        chapter_id: int,
        refresh: bool = False,
    ) -> LibraryReaderChapterResource:
        chapter = await self.session.get(LibraryChapter, chapter_id)
        if chapter is None:
            raise BridgeAPIError(404, f"Library chapter not found: {chapter_id}")

        pages = await self.get_chapter_pages(chapter_id=chapter_id, refresh=refresh)
        chapter_ids_rows = (
            await self.session.exec(
                select(LibraryChapter.id)
                .where(LibraryChapter.variant_id == chapter.variant_id)
                .order_by(
                    LibraryChapter.chapter_number,
                    LibraryChapter.date_upload,
                    LibraryChapter.id,
                )
            )
        ).all()
        chapter_ids = [int(item) for item in chapter_ids_rows]

        prev_chapter_id: int | None = None
        next_chapter_id: int | None = None
        if chapter_id in chapter_ids:
            index = chapter_ids.index(chapter_id)
            if index > 0:
                prev_chapter_id = chapter_ids[index - 1]
            if index + 1 < len(chapter_ids):
                next_chapter_id = chapter_ids[index + 1]

        reader_pages: list[ReaderPageResource] = []
        for page in pages:
            remote = page.image_url or page.url
            local_url = self._local_page_url(page.local_path)
            src = local_url or remote
            reader_pages.append(
                ReaderPageResource(
                    id=page.id,
                    page_index=page.page_index,
                    src=src,
                    is_local=bool(local_url),
                    local_path=page.local_path,
                    remote_url=remote,
                    local_size=page.local_size,
                )
            )

        return LibraryReaderChapterResource(
            chapter_id=chapter_id,
            library_title_id=int(chapter.library_title_id),
            variant_id=int(chapter.variant_id),
            is_downloaded=chapter.is_downloaded,
            prev_chapter_id=prev_chapter_id,
            next_chapter_id=next_chapter_id,
            pages=reader_pages,
        )

    async def _resolve_source(self, source_id: str) -> SourceSummary:
        sources = await self.extension_service.list_sources(
            installed=True,
            enabled=None,
            supports_latest=None,
        )
        summaries = [SourceSummary.from_models(extension, source) for extension, source in sources]
        source = next((item for item in summaries if item.id == source_id), None)
        if source is None:
            raise BridgeAPIError(404, f"Source not found: {source_id}")
        return source

    async def _find_or_create_library_title(self, key: str, fallback_title: str) -> LibraryTitle:
        title = (
            await self.session.exec(
                select(LibraryTitle).where(LibraryTitle.canonical_key == key)
            )
        ).first()
        if title is not None:
            return title

        title = LibraryTitle(
            canonical_key=key,
            title=fallback_title,
            created_at=datetime.now(timezone.utc),
            updated_at=datetime.now(timezone.utc),
        )
        self.session.add(title)
        return title

    async def _resolve_variant(
        self, title_id: int, variant_id: int | None
    ) -> LibraryTitleVariant:
        if variant_id is not None:
            variant = await self.session.get(LibraryTitleVariant, variant_id)
            if variant is None or variant.library_title_id != title_id:
                raise BridgeAPIError(404, f"Variant not found: {variant_id}")
            return variant

        variant = (
            await self.session.exec(
                select(LibraryTitleVariant)
                .where(LibraryTitleVariant.library_title_id == title_id)
                .order_by(desc(LibraryTitleVariant.last_synced_at), LibraryTitleVariant.id)
                .limit(1)
            )
        ).first()
        if variant is None:
            raise BridgeAPIError(404, f"Library title has no source variants: {title_id}")
        return variant

    async def _refresh_variant(self, title: LibraryTitle, variant: LibraryTitleVariant) -> None:
        details = await tachibridge.fetch_title_details(
            source_id=variant.source_id,
            title_url=variant.title_url,
        )
        chapters = await tachibridge.fetch_title_chapters(
            source_id=variant.source_id,
            title_url=variant.title_url,
        )
        now = datetime.now(timezone.utc)

        variant.title = details.title
        variant.thumbnail_url = details.thumbnail_url or ""
        variant.description = details.description
        variant.artist = details.artist
        variant.author = details.author
        variant.genre = details.genre
        variant.status = _status_value(details.status)
        variant.updated_at = now
        variant.last_synced_at = now
        self.session.add(variant)

        self._sync_title_snapshot(title, details, now)
        self.session.add(title)

        await self._sync_variant_chapters(
            library_title_id=int(title.id),
            variant_id=int(variant.id),
            chapters=chapters,
            now=now,
        )
        await self.session.commit()

    async def _sync_variant_chapters(
        self,
        library_title_id: int,
        variant_id: int,
        chapters: list[SourceChapter],
        now: datetime,
    ) -> None:
        existing_rows = (
            await self.session.exec(
                select(LibraryChapter).where(LibraryChapter.variant_id == variant_id)
            )
        ).all()
        existing = list(existing_rows)
        by_url = {chapter.chapter_url: chapter for chapter in existing}
        seen_urls: set[str] = set()

        for position, chapter in enumerate(chapters, start=1):
            model = by_url.get(chapter.url)
            if model is None:
                model = LibraryChapter(
                    library_title_id=library_title_id,
                    variant_id=variant_id,
                    chapter_url=chapter.url,
                    name=chapter.name,
                    chapter_number=chapter.chapter_number,
                    scanlator=chapter.scanlator,
                    date_upload=chapter.date_upload,
                    position=position,
                    created_at=now,
                    updated_at=now,
                    last_synced_at=now,
                )
            else:
                model.name = chapter.name
                model.chapter_number = chapter.chapter_number
                model.scanlator = chapter.scanlator
                model.date_upload = chapter.date_upload
                model.position = position
                model.updated_at = now
                model.last_synced_at = now

            self.session.add(model)
            seen_urls.add(chapter.url)

        stale_ids = [
            int(chapter.id)
            for chapter in existing
            if chapter.chapter_url not in seen_urls and chapter.id is not None
        ]
        if stale_ids:
            await self.session.exec(
                delete(LibraryChapterPage).where(LibraryChapterPage.chapter_id.in_(stale_ids))
            )
            await self.session.exec(
                delete(LibraryChapter).where(LibraryChapter.id.in_(stale_ids))
            )

    @staticmethod
    def _sync_title_snapshot(library_title: LibraryTitle, details, now: datetime) -> None:
        library_title.title = details.title or library_title.title
        library_title.thumbnail_url = details.thumbnail_url or library_title.thumbnail_url
        library_title.description = details.description or library_title.description
        library_title.artist = details.artist or library_title.artist
        library_title.author = details.author or library_title.author
        library_title.genre = details.genre or library_title.genre
        library_title.status = _status_value(details.status)
        library_title.updated_at = now
        library_title.last_refreshed_at = now

    @staticmethod
    def _to_variant_resource(variant: LibraryTitleVariant) -> LibraryTitleVariantResource:
        return LibraryTitleVariantResource(
            id=int(variant.id),
            source_id=variant.source_id,
            source_name=variant.source_name,
            source_lang=variant.source_lang,
            title_url=variant.title_url,
            title=variant.title,
            thumbnail_url=variant.thumbnail_url,
        )

    @staticmethod
    def _local_page_url(local_path: str | None) -> str | None:
        if not local_path:
            return None
        candidate = (settings.downloads.root_dir / local_path).resolve()
        root = settings.downloads.root_dir.resolve()
        try:
            candidate.relative_to(root)
        except ValueError:
            return None
        if not candidate.is_file():
            return None
        return f"/api/v2/library/files/{quote(local_path, safe='/')}"
