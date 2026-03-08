import re
import time as _time
from datetime import datetime, timedelta, timezone
from pathlib import Path
from urllib.parse import quote, urljoin, urlparse

import httpx
from loguru import logger
from sqlalchemy import insert
from sqlmodel import delete, desc, func, select, update
from sqlmodel.ext.asyncio.session import AsyncSession

from app.bridge import tachibridge
from app.bridge.metrics import bridge_page_metrics
from app.config import settings
from app.core.errors import BridgeAPIError
from app.core.utils import (
    commit_with_sqlite_retry,
    normalize_positive_int_ids,
    normalize_text,
)
from app.domain.download_profiles import (
    parse_selected_variant_ids,
    serialize_selected_variant_ids,
)
from app.domain.chapter_matching import choose_replacement_chapter_url
from app.domain.title_identity import (
    author_match_score,
    canonical_title_key,
    fallback_title_from_url,
    source_match_score,
)
from app.features.downloads.storage import (
    archive_member_virtual_path,
    chapter_archive_path,
    list_chapter_archive_images,
)
from app.features.covers.local_store import (
    is_downloaded_title_cover_path,
    library_cover_route,
    persist_library_cover,
)
from app.features.extensions import ExtensionService
from app.models import (
    DownloadProfile,
    DownloadProfileVariant,
    DownloadTask,
    DownloadStrategy,
    ExploreCacheItem,
    ExploreTitleDetailsCache,
    ExtensionSourceTitle,
    LibraryCollection,
    LibraryCollectionCreate,
    LibraryCollectionResource,
    LibraryCollectionSummary,
    LibraryCollectionTitle,
    LibraryCollectionUpdate,
    LibraryChapter,
    LibraryChapterComment,
    LibraryChapterCommentCreate,
    LibraryChapterCommentResource,
    LibraryChapterCommentUpdate,
    LibraryChapterPage,
    LibraryChapterPageResource,
    LibraryChapterProgressResource,
    LibraryChapterProgressUpdate,
    LibraryChapterResource,
    LibraryImportRequest,
    LibraryImportResponse,
    LibraryLinkVariantResponse,
    LibraryMergeTitlesResponse,
    LibraryReaderChapterResource,
    LibrarySourceMatchResource,
    LibraryTitle,
    LibraryTitlePreferencesUpdate,
    LibraryTitleResource,
    LibraryTitleSummary,
    LibraryTitleVariant,
    LibraryVariantAvailabilityResource,
    LibraryTitleVariantResource,
    LibraryUserStatus,
    LibraryUserStatusCreate,
    LibraryUserStatusResource,
    LibraryUserStatusUpdate,
    Page,
    ReaderPageResource,
    Source,
    SourceChapter,
    SourcePreference,
    SourceSummary,
    Status,
)

_PAGE_INDEX_RE = re.compile(r"(\d+)")
_IMAGE_SUFFIXES = {".jpg", ".jpeg", ".png", ".webp", ".gif", ".avif"}
_MATCH_QUERY_TITLES_MAX = 8

DEFAULT_USER_STATUSES: tuple[tuple[str, str, str, int], ...] = (
    ("reading", "Reading", "#4ade80", 1),
    ("completed", "Completed", "#a3a3a3", 2),
    ("on_hold", "On Hold", "#facc15", 3),
    ("dropped", "Dropped", "#f87171", 4),
    ("plan_to_read", "Plan to Read", "#60a5fa", 5),
)


_normalize = normalize_text


def _status_value(value: object) -> int:
    raw = getattr(value, "value", value)
    return int(raw)


_library_logger = logger.bind(module="library.service")


class LibraryService:
    def __init__(self, session: AsyncSession):
        self.session = session
        self.extension_service = ExtensionService(session)

    async def _commit_with_sqlite_retry(self) -> None:
        await commit_with_sqlite_retry(self.session)

    async def list_titles(
        self,
        offset: int = 0,
        limit: int = 20,
        assigned_only: bool = True,
    ) -> list[LibraryTitleSummary]:
        await self._ensure_default_user_statuses()
        stmt = select(LibraryTitle)
        if assigned_only:
            stmt = stmt.where(LibraryTitle.user_status_id.is_not(None))
        title_rows = (
            await self.session.exec(
                stmt.order_by(desc(LibraryTitle.updated_at)).offset(offset).limit(limit)
            )
        ).all()
        titles = list(title_rows)
        if not titles:
            return []

        title_ids = [title.id for title in titles if title.id is not None]
        preferred_variant_ids = [
            int(title.preferred_variant_id)
            for title in titles
            if title.preferred_variant_id is not None
        ]
        preferred_variant_rows = (
            (
                await self.session.exec(
                    select(LibraryTitleVariant).where(
                        LibraryTitleVariant.id.in_(preferred_variant_ids)
                    )
                )
            ).all()
            if preferred_variant_ids
            else []
        )
        preferred_variant_by_id = {
            int(variant.id): variant
            for variant in preferred_variant_rows
            if variant.id is not None
        }
        user_statuses = await self._load_user_status_map(titles)
        collections_by_title_id = await self._load_collections_by_title_ids(title_ids)

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
        variants_count = {
            int(title_id): int(count) for title_id, count in variants_count_rows
        }

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
        chapters_count = {
            int(title_id): int(count) for title_id, count in chapters_count_rows
        }

        last_read_rows = (
            await self.session.exec(
                select(
                    LibraryChapter.library_title_id,
                    func.max(LibraryChapter.reader_updated_at),
                )
                .where(LibraryChapter.library_title_id.in_(title_ids))
                .where(LibraryChapter.reader_updated_at.is_not(None))
                .group_by(LibraryChapter.library_title_id)
            )
        ).all()
        last_read_at_by_title_id: dict[int, datetime] = {
            int(title_id): ts for title_id, ts in last_read_rows if ts is not None
        }

        summaries: list[LibraryTitleSummary] = []
        for title in titles:
            if title.id is None:
                continue
            preferred_variant = (
                preferred_variant_by_id.get(int(title.preferred_variant_id))
                if title.preferred_variant_id is not None
                else None
            )
            summaries.append(
                LibraryTitleSummary(
                    id=int(title.id),
                    title=(
                        preferred_variant.title
                        if preferred_variant is not None and preferred_variant.title
                        else title.title
                    ),
                    thumbnail_url=self._display_title_thumbnail(
                        title, preferred_variant
                    ),
                    status=(
                        int(preferred_variant.status)
                        if preferred_variant is not None and preferred_variant.status
                        else title.status
                    ),
                    user_status=self._to_user_status_resource(
                        user_statuses.get(title.user_status_id)
                    ),
                    user_rating=title.user_rating,
                    collections=collections_by_title_id.get(int(title.id), []),
                    variants_count=variants_count.get(int(title.id), 0),
                    chapters_count=chapters_count.get(int(title.id), 0),
                    added_at=title.created_at,
                    updated_at=title.updated_at,
                    last_read_at=last_read_at_by_title_id.get(int(title.id)),
                    genre=(
                        preferred_variant.genre
                        if preferred_variant is not None and preferred_variant.genre
                        else title.genre
                    ),
                )
            )
        return summaries

    async def get_title(self, title_id: int) -> LibraryTitleResource:
        await self._ensure_default_user_statuses()
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
        user_status = await self._get_user_status(title.user_status_id)
        collections = await self._list_title_collection_summaries(title_id)
        monitoring_enabled = await self._is_monitoring_enabled(title_id)
        monitoring_variant_ids = await self._get_monitoring_variant_ids(
            title_id=title_id,
            variants=variants,
        )
        variant_availability = await self._build_variant_availability(
            title_id=title_id,
            variants=variants,
        )
        preferred_variant = next(
            (
                variant
                for variant in variants
                if title.preferred_variant_id is not None
                and variant.id is not None
                and int(variant.id) == int(title.preferred_variant_id)
            ),
            None,
        )
        display_title = (
            preferred_variant.title
            if preferred_variant is not None and preferred_variant.title
            else title.title
        )
        display_thumbnail = self._display_title_thumbnail(title, preferred_variant)
        display_description = (
            preferred_variant.description
            if preferred_variant is not None and preferred_variant.description
            else title.description
        )
        display_artist = (
            preferred_variant.artist
            if preferred_variant is not None and preferred_variant.artist
            else title.artist
        )
        display_author = (
            preferred_variant.author
            if preferred_variant is not None and preferred_variant.author
            else title.author
        )
        display_genre = (
            preferred_variant.genre
            if preferred_variant is not None and preferred_variant.genre
            else title.genre
        )
        display_status = (
            int(preferred_variant.status)
            if preferred_variant is not None and preferred_variant.status
            else title.status
        )

        return LibraryTitleResource(
            id=title_id,
            canonical_key=title.canonical_key,
            title=display_title,
            thumbnail_url=display_thumbnail,
            description=display_description,
            artist=display_artist,
            author=display_author,
            genre=display_genre,
            status=display_status,
            preferred_variant_id=title.preferred_variant_id,
            user_status=self._to_user_status_resource(user_status),
            user_rating=title.user_rating,
            collections=collections,
            updates_enabled=monitoring_enabled,
            watched_variant_ids=monitoring_variant_ids,
            variants=[
                self._to_variant_resource(
                    variant,
                    availability=variant_availability.get(int(variant.id)),
                )
                for variant in variants
                if variant.id is not None
            ],
        )

    async def list_user_statuses(self) -> list[LibraryUserStatusResource]:
        await self._ensure_default_user_statuses()
        rows = (
            await self.session.exec(
                select(LibraryUserStatus).order_by(
                    LibraryUserStatus.position,
                    LibraryUserStatus.id,
                )
            )
        ).all()
        return [
            self._to_user_status_resource(status)
            for status in rows
            if status.id is not None
        ]

    async def create_user_status(
        self,
        payload: LibraryUserStatusCreate,
    ) -> LibraryUserStatusResource:
        await self._ensure_default_user_statuses()
        label = payload.label.strip()
        if not label:
            raise BridgeAPIError(400, "Status label is required")

        now = datetime.now(timezone.utc)
        key = await self._build_unique_status_key(payload.key or label)
        position = (
            payload.position
            if payload.position is not None
            else await self._next_user_status_position()
        )
        status = LibraryUserStatus(
            key=key,
            label=label,
            color=self._normalize_color(payload.color, default="#71717a"),
            position=position,
            is_default=False,
            created_at=now,
            updated_at=now,
        )
        self.session.add(status)
        await self.session.commit()
        await self.session.refresh(status)
        return self._to_user_status_resource(status)

    async def update_user_status(
        self,
        status_id: int,
        payload: LibraryUserStatusUpdate,
    ) -> LibraryUserStatusResource:
        await self._ensure_default_user_statuses()
        status = await self.session.get(LibraryUserStatus, status_id)
        if status is None:
            raise BridgeAPIError(404, f"Library status not found: {status_id}")

        updates = payload.model_dump(exclude_unset=True)
        if "label" in updates:
            label = (updates["label"] or "").strip()
            if not label:
                raise BridgeAPIError(400, "Status label cannot be empty")
            status.label = label
        if "key" in updates:
            key = (updates["key"] or "").strip()
            if not key:
                raise BridgeAPIError(400, "Status key cannot be empty")
            status.key = await self._build_unique_status_key(key, exclude_id=status_id)
        if "color" in updates and updates["color"] is not None:
            status.color = self._normalize_color(updates["color"], default=status.color)
        if "position" in updates and updates["position"] is not None:
            status.position = int(updates["position"])

        status.updated_at = datetime.now(timezone.utc)
        self.session.add(status)
        await self.session.commit()
        await self.session.refresh(status)
        return self._to_user_status_resource(status)

    async def delete_user_status(self, status_id: int) -> None:
        await self._ensure_default_user_statuses()
        status = await self.session.get(LibraryUserStatus, status_id)
        if status is None:
            raise BridgeAPIError(404, f"Library status not found: {status_id}")
        if status.is_default:
            raise BridgeAPIError(400, "Default statuses cannot be deleted")

        title_rows = (
            await self.session.exec(
                select(LibraryTitle).where(LibraryTitle.user_status_id == status_id)
            )
        ).all()
        for title in title_rows:
            title.user_status_id = None
            self.session.add(title)

        await self.session.delete(status)
        await self.session.commit()

    async def list_collections(self) -> list[LibraryCollectionResource]:
        rows = (
            await self.session.exec(
                select(LibraryCollection).order_by(
                    LibraryCollection.position,
                    LibraryCollection.name,
                )
            )
        ).all()
        collections = list(rows)
        if not collections:
            return []

        ids = [
            int(collection.id)
            for collection in collections
            if collection.id is not None
        ]
        count_rows = (
            await self.session.exec(
                select(
                    LibraryCollectionTitle.collection_id,
                    func.count(LibraryCollectionTitle.id),
                )
                .where(LibraryCollectionTitle.collection_id.in_(ids))
                .group_by(LibraryCollectionTitle.collection_id)
            )
        ).all()
        by_collection_id = {
            int(collection_id): int(count) for collection_id, count in count_rows
        }
        return [
            LibraryCollectionResource(
                id=int(collection.id),
                name=collection.name,
                description=collection.description,
                color=collection.color,
                position=collection.position,
                titles_count=by_collection_id.get(int(collection.id), 0),
            )
            for collection in collections
            if collection.id is not None
        ]

    async def create_collection(
        self,
        payload: LibraryCollectionCreate,
    ) -> LibraryCollectionResource:
        name = payload.name.strip()
        if not name:
            raise BridgeAPIError(400, "Collection name is required")

        await self._ensure_unique_collection_name(name)
        now = datetime.now(timezone.utc)
        position = (
            payload.position
            if payload.position is not None
            else await self._next_collection_position()
        )
        collection = LibraryCollection(
            name=name,
            description=(payload.description or "").strip() or None,
            color=self._normalize_color(payload.color, default="#6366f1"),
            position=position,
            created_at=now,
            updated_at=now,
        )
        self.session.add(collection)
        await self.session.commit()
        await self.session.refresh(collection)
        return LibraryCollectionResource(
            id=int(collection.id),
            name=collection.name,
            description=collection.description,
            color=collection.color,
            position=collection.position,
            titles_count=0,
        )

    async def update_collection(
        self,
        collection_id: int,
        payload: LibraryCollectionUpdate,
    ) -> LibraryCollectionResource:
        collection = await self.session.get(LibraryCollection, collection_id)
        if collection is None:
            raise BridgeAPIError(404, f"Collection not found: {collection_id}")

        updates = payload.model_dump(exclude_unset=True)
        if "name" in updates:
            name = (updates["name"] or "").strip()
            if not name:
                raise BridgeAPIError(400, "Collection name cannot be empty")
            await self._ensure_unique_collection_name(name, exclude_id=collection_id)
            collection.name = name
        if "description" in updates:
            collection.description = (updates["description"] or "").strip() or None
        if "color" in updates and updates["color"] is not None:
            collection.color = self._normalize_color(
                updates["color"], default=collection.color
            )
        if "position" in updates and updates["position"] is not None:
            collection.position = int(updates["position"])
        collection.updated_at = datetime.now(timezone.utc)

        self.session.add(collection)
        await self.session.commit()
        await self.session.refresh(collection)

        titles_count = int(
            (
                await self.session.exec(
                    select(func.count(LibraryCollectionTitle.id)).where(
                        LibraryCollectionTitle.collection_id == collection_id
                    )
                )
            ).one()
            or 0
        )
        return LibraryCollectionResource(
            id=int(collection.id),
            name=collection.name,
            description=collection.description,
            color=collection.color,
            position=collection.position,
            titles_count=titles_count,
        )

    async def delete_collection(self, collection_id: int) -> None:
        collection = await self.session.get(LibraryCollection, collection_id)
        if collection is None:
            raise BridgeAPIError(404, f"Collection not found: {collection_id}")

        await self.session.exec(
            delete(LibraryCollectionTitle).where(
                LibraryCollectionTitle.collection_id == collection_id
            )
        )
        await self.session.delete(collection)
        await self.session.commit()

    async def add_title_to_collection(self, collection_id: int, title_id: int) -> None:
        await self._get_library_title_or_404(title_id)
        await self._get_collection_or_404(collection_id)
        existing = (
            await self.session.exec(
                select(LibraryCollectionTitle).where(
                    LibraryCollectionTitle.collection_id == collection_id,
                    LibraryCollectionTitle.library_title_id == title_id,
                )
            )
        ).first()
        if existing is None:
            self.session.add(
                LibraryCollectionTitle(
                    collection_id=collection_id,
                    library_title_id=title_id,
                    created_at=datetime.now(timezone.utc),
                )
            )
            await self._commit_with_sqlite_retry()

    async def remove_title_from_collection(
        self, collection_id: int, title_id: int
    ) -> None:
        await self._get_collection_or_404(collection_id)
        await self.session.exec(
            delete(LibraryCollectionTitle).where(
                LibraryCollectionTitle.collection_id == collection_id,
                LibraryCollectionTitle.library_title_id == title_id,
            )
        )
        await self._commit_with_sqlite_retry()

    async def update_title_preferences(
        self,
        title_id: int,
        payload: LibraryTitlePreferencesUpdate,
    ) -> LibraryTitleResource:
        await self._ensure_default_user_statuses()
        title = await self._get_library_title_or_404(title_id)
        updates = payload.model_dump(exclude_unset=True)

        if "user_status_id" in updates:
            user_status_id = updates["user_status_id"]
            if user_status_id is not None:
                status = await self.session.get(LibraryUserStatus, int(user_status_id))
                if status is None:
                    raise BridgeAPIError(
                        404, f"Library status not found: {user_status_id}"
                    )
            title.user_status_id = user_status_id

        if "preferred_variant_id" in updates:
            preferred_variant_id = updates["preferred_variant_id"]
            if preferred_variant_id is not None:
                variant = await self.session.get(
                    LibraryTitleVariant, int(preferred_variant_id)
                )
                if variant is None or variant.library_title_id != title_id:
                    raise BridgeAPIError(
                        404, f"Library variant not found: {preferred_variant_id}"
                    )
            title.preferred_variant_id = preferred_variant_id

        if "user_rating" in updates:
            rating = updates["user_rating"]
            title.user_rating = None if rating is None else float(rating)

        if "collection_ids" in updates:
            ids = list(dict.fromkeys(updates["collection_ids"] or []))
            if ids:
                existing_rows = (
                    await self.session.exec(
                        select(LibraryCollection.id).where(
                            LibraryCollection.id.in_(ids)
                        )
                    )
                ).all()
                existing_ids = {int(item) for item in existing_rows}
                missing = [item for item in ids if item not in existing_ids]
                if missing:
                    raise BridgeAPIError(404, f"Collection not found: {missing[0]}")

            await self.session.exec(
                delete(LibraryCollectionTitle).where(
                    LibraryCollectionTitle.library_title_id == title_id
                )
            )
            for collection_id in ids:
                self.session.add(
                    LibraryCollectionTitle(
                        collection_id=int(collection_id),
                        library_title_id=title_id,
                        created_at=datetime.now(timezone.utc),
                    )
                )

        profile: DownloadProfile | None = None
        status_removed = "user_status_id" in updates and title.user_status_id is None
        if (
            "updates_enabled" in updates
            or "watched_variant_ids" in updates
            or status_removed
        ):
            now = datetime.now(timezone.utc)
            profile = (
                await self.session.exec(
                    select(DownloadProfile).where(
                        DownloadProfile.library_title_id == title_id
                    )
                )
            ).first()
            normalized_monitoring_variant_ids: list[int] | None = None
            if "watched_variant_ids" in updates:
                monitoring_variant_ids = self._normalize_positive_int_ids(
                    updates["watched_variant_ids"] or []
                )
                normalized_monitoring_variant_ids = (
                    await self._normalize_monitoring_variant_ids(
                        title_id=title_id,
                        variant_ids=monitoring_variant_ids,
                    )
                )
                if len(normalized_monitoring_variant_ids) != len(
                    monitoring_variant_ids
                ):
                    raise BridgeAPIError(
                        404, "One or more monitoring variants are not linked"
                    )

            if "updates_enabled" in updates:
                monitoring_enabled = bool(updates["updates_enabled"])
            elif normalized_monitoring_variant_ids is not None:
                monitoring_enabled = len(normalized_monitoring_variant_ids) > 0
            else:
                monitoring_enabled = (
                    bool(profile.enabled) if profile is not None else False
                )
            if title.user_status_id is None:
                monitoring_enabled = False

            if profile is None:
                if not monitoring_enabled:
                    # Keep titles without active monitoring profile rows.
                    pass
                else:
                    # Avoid duplicate-profile races when autosave sends concurrent requests.
                    await self.session.exec(
                        insert(DownloadProfile)
                        .values(
                            library_title_id=title_id,
                            enabled=monitoring_enabled,
                            paused=False,
                            auto_download=True,
                            strategy=DownloadStrategy.NEW_ONLY,
                            start_from=None,
                            created_at=now,
                            updated_at=now,
                        )
                        .prefix_with("OR IGNORE")
                    )
                    profile = (
                        await self.session.exec(
                            select(DownloadProfile).where(
                                DownloadProfile.library_title_id == title_id
                            )
                        )
                    ).first()
                    if profile is None:
                        raise BridgeAPIError(
                            500,
                            f"Failed to create monitoring profile for title: {title_id}",
                        )

            if profile is not None:
                # Update existing (or just-created) monitoring profile.
                profile.enabled = monitoring_enabled
                profile.updated_at = now
                if title.user_status_id is None:
                    await self._set_profile_variant_ids(profile=profile, variant_ids=[])
                if monitoring_enabled:
                    # Enabling monitoring from title page should resume monitoring immediately.
                    profile.paused = False
                if normalized_monitoring_variant_ids is not None:
                    await self._set_profile_variant_ids(
                        profile=profile,
                        variant_ids=normalized_monitoring_variant_ids,
                    )
                if monitoring_enabled and not await self._profile_variant_ids(profile):
                    await self._pin_monitoring_profile_variant_if_missing(
                        profile=profile,
                        title_id=title_id,
                        fallback_variant_id=title.preferred_variant_id,
                    )
                self.session.add(profile)

        title.updated_at = datetime.now(timezone.utc)
        self.session.add(title)
        await self.session.commit()
        await self._ensure_local_cover_for_monitoring(title_id=title_id)
        return await self.get_title(title_id)

    async def cleanup_unassigned_titles(
        self,
        older_than_days: int = 30,
        limit: int = 200,
    ) -> int:
        cutoff = datetime.now(timezone.utc) - timedelta(days=max(1, older_than_days))
        rows = (
            await self.session.exec(
                select(LibraryTitle)
                .where(
                    LibraryTitle.user_status_id.is_(None),
                    LibraryTitle.updated_at < cutoff,
                )
                .order_by(LibraryTitle.updated_at)
                .limit(max(1, limit))
            )
        ).all()
        candidates = list(rows)
        if not candidates:
            return 0

        candidate_ids = [int(t.id) for t in candidates if t.id is not None]

        # Bulk: which candidate titles belong to at least one collection?
        in_collection_ids: set[int] = {
            int(r)
            for r in (
                await self.session.exec(
                    select(LibraryCollectionTitle.library_title_id).where(
                        LibraryCollectionTitle.library_title_id.in_(candidate_ids)
                    )
                )
            ).all()
            if r is not None
        }

        # Bulk: which candidate titles have an *enabled* download profile?
        enabled_profile_ids: set[int] = {
            int(title_id)
            for title_id, enabled in (
                await self.session.exec(
                    select(
                        DownloadProfile.library_title_id,
                        DownloadProfile.enabled,
                    ).where(DownloadProfile.library_title_id.in_(candidate_ids))
                )
            ).all()
            if enabled and title_id is not None
        }

        deletable_ids: list[int] = []
        for title in candidates:
            if title.id is None:
                continue
            title_id = int(title.id)
            # Keep titles that user touched in another way.
            if title.user_rating is not None:
                continue
            if title_id in in_collection_ids:
                continue
            if title_id in enabled_profile_ids:
                continue
            deletable_ids.append(title_id)

        if not deletable_ids:
            return 0

        chapter_id_rows = (
            await self.session.exec(
                select(LibraryChapter.id).where(
                    LibraryChapter.library_title_id.in_(deletable_ids)
                )
            )
        ).all()
        chapter_ids = [int(item) for item in chapter_id_rows]
        now = datetime.now(timezone.utc)

        if chapter_ids:
            await self.session.exec(
                delete(LibraryChapterPage).where(
                    LibraryChapterPage.chapter_id.in_(chapter_ids)
                )
            )
            # Keep chapter rows (stable IDs + read state), but clear stale download markers.
            await self.session.exec(
                update(LibraryChapter)
                .where(LibraryChapter.id.in_(chapter_ids))
                .values(
                    is_downloaded=False,
                    downloaded_at=None,
                    download_path=None,
                    download_error=None,
                    updated_at=now,
                )
            )

        await self.session.exec(
            delete(DownloadTask).where(DownloadTask.library_title_id.in_(deletable_ids))
        )
        await self.session.exec(
            delete(DownloadProfile).where(
                DownloadProfile.library_title_id.in_(deletable_ids)
            )
        )
        # Keep minimal identity metadata so re-importing the same source title
        # resolves to the same library title ID.
        await self.session.exec(
            update(LibraryTitle)
            .where(LibraryTitle.id.in_(deletable_ids))
            .values(updated_at=now)
        )
        await self.session.commit()
        removed = len(deletable_ids)
        _library_logger.bind(removed=removed, older_than_days=older_than_days).info(
            "titles.cleanup"
        )
        return removed

    async def import_title(
        self, request: LibraryImportRequest
    ) -> LibraryImportResponse:
        _t0 = _time.monotonic()
        source = await self._resolve_source(request.source_id)
        details = await self._fetch_title_details_with_fallback(
            source_id=request.source_id,
            title_url=request.title_url,
        )
        chapters = await tachibridge.fetch_title_chapters(
            source_id=request.source_id,
            title_url=request.title_url,
        )

        now = datetime.now(timezone.utc)
        key = canonical_title_key(details.title, details.author)

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
            library_title = None
            same_extension_title_id = await self._find_same_extension_library_title_id(
                source_id=request.source_id,
                title_url=request.title_url,
            )
            if same_extension_title_id is not None:
                library_title = await self.session.get(
                    LibraryTitle, int(same_extension_title_id)
                )
            if library_title is None:
                library_title = await self._find_or_create_library_title(
                    key=key,
                    fallback_title=details.title,
                )
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
            library_title = await self.session.get(
                LibraryTitle, variant.library_title_id
            )
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
        primary_variant_id = int(variant.id)

        await self._sync_variant_chapters(
            library_title_id=int(library_title.id),
            variant_id=primary_variant_id,
            chapters=chapters,
            now=now,
        )
        if library_title.preferred_variant_id is None:
            library_title.preferred_variant_id = primary_variant_id
            library_title.updated_at = now
            self.session.add(library_title)

        profile = (
            await self.session.exec(
                select(DownloadProfile).where(
                    DownloadProfile.library_title_id == int(library_title.id)
                )
            )
        ).first()
        if profile is not None and profile.enabled:
            await self._pin_monitoring_profile_variant_if_missing(
                profile=profile,
                title_id=int(library_title.id),
                fallback_variant_id=primary_variant_id,
            )
            self.session.add(profile)

        await self.session.commit()

        # Best-effort auto-linking for alternate sources.
        try:
            await self._auto_link_same_extension_variants(
                title_id=int(library_title.id),
                source_id=request.source_id,
                title_url=request.title_url,
            )
        except Exception:
            _library_logger.opt(exception=True).warning(
                "auto_link_same_extension failed title_id={}", int(library_title.id)
            )

        result = LibraryImportResponse(
            library_title_id=int(library_title.id),
            created=created,
        )
        if profile is not None and profile.enabled:
            await self._ensure_local_cover(
                library_title, variant, details.thumbnail_url
            )
        _library_logger.bind(
            title_id=int(library_title.id),
            source_id=request.source_id,
            title=details.title,
            chapters=len(chapters),
            created=created,
            duration_ms=round((_time.monotonic() - _t0) * 1000),
        ).info("title.imported")
        return result

    async def _fetch_title_details_with_fallback(
        self, source_id: str, title_url: str
    ) -> ExtensionSourceTitle:
        try:
            return await tachibridge.fetch_title_details(
                source_id=source_id,
                title_url=title_url,
            )
        except BridgeAPIError:
            cache_row = await self.session.get(
                ExploreTitleDetailsCache,
                {"source_id": source_id, "title_url": title_url},
            )
            title = fallback_title_from_url(title_url)
            status = Status.UNKNOWN
            thumbnail_url = ""
            artist = None
            author = None
            description = None
            genre = None

            if cache_row is None:
                cache_row = (
                    await self.session.exec(
                        select(ExploreCacheItem)
                        .where(
                            ExploreCacheItem.source_id == source_id,
                            ExploreCacheItem.title_url == title_url,
                        )
                        .order_by(desc(ExploreCacheItem.fetched_at))
                        .limit(1)
                    )
                ).first()

            if cache_row is not None:
                title = cache_row.title or title
                raw_status = int(getattr(cache_row, "status", 0) or 0)
                status = (
                    Status(raw_status)
                    if raw_status in Status._value2member_map_
                    else Status.UNKNOWN
                )
                thumbnail_url = getattr(cache_row, "thumbnail_url", "") or ""
                artist = getattr(cache_row, "artist", None)
                author = getattr(cache_row, "author", None)
                description = getattr(cache_row, "description", None)
                genre = getattr(cache_row, "genre", None)

            return ExtensionSourceTitle(
                url=title_url,
                title=title,
                status=status,
                thumbnail_url=thumbnail_url,
                artist=artist,
                author=author,
                description=description,
                genre=genre,
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
                .order_by(
                    desc(LibraryChapter.chapter_number),
                    desc(LibraryChapter.date_upload),
                )
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
                reader_page_index=chapter.reader_page_index,
                reader_updated_at=chapter.reader_updated_at,
            )
            for chapter in chapter_rows
            if chapter.id is not None
        ]

    async def list_title_chapter_progress(
        self,
        title_id: int,
        variant_id: int | None = None,
    ) -> list[LibraryChapterProgressResource]:
        title = await self.session.get(LibraryTitle, title_id)
        if title is None:
            raise BridgeAPIError(404, f"Library title not found: {title_id}")

        variant = await self._resolve_variant(title_id=title_id, variant_id=variant_id)
        chapter_rows = (
            await self.session.exec(
                select(LibraryChapter)
                .where(LibraryChapter.variant_id == int(variant.id))
                .order_by(
                    LibraryChapter.chapter_number,
                    LibraryChapter.date_upload,
                    LibraryChapter.id,
                )
            )
        ).all()

        return [
            LibraryChapterProgressResource(
                chapter_id=int(chapter.id),
                page_index=chapter.reader_page_index,
                comment=chapter.reader_comment,
                updated_at=chapter.reader_updated_at,
            )
            for chapter in chapter_rows
            if chapter.id is not None
        ]

    @staticmethod
    def _to_chapter_comment_resource(
        comment: LibraryChapterComment, chapter: LibraryChapter
    ) -> LibraryChapterCommentResource:
        if comment.id is None:
            raise BridgeAPIError(500, "Library chapter comment id is missing")
        return LibraryChapterCommentResource(
            id=int(comment.id),
            chapter_id=int(comment.chapter_id),
            library_title_id=int(chapter.library_title_id),
            variant_id=int(chapter.variant_id),
            chapter_name=chapter.name,
            chapter_number=chapter.chapter_number,
            page_index=comment.page_index,
            message=comment.message,
            created_at=comment.created_at,
            updated_at=comment.updated_at,
        )

    async def list_chapter_comments(
        self,
        chapter_id: int,
        newest_first: bool = True,
    ) -> list[LibraryChapterCommentResource]:
        chapter = await self.session.get(LibraryChapter, chapter_id)
        if chapter is None:
            raise BridgeAPIError(404, f"Library chapter not found: {chapter_id}")

        order = (
            desc(LibraryChapterComment.created_at)
            if newest_first
            else LibraryChapterComment.created_at
        )
        rows = (
            await self.session.exec(
                select(LibraryChapterComment)
                .where(LibraryChapterComment.chapter_id == chapter_id)
                .order_by(order, desc(LibraryChapterComment.id))
            )
        ).all()
        comments = list(rows)
        return [
            self._to_chapter_comment_resource(comment, chapter) for comment in comments
        ]

    async def create_chapter_comment(
        self,
        chapter_id: int,
        payload: LibraryChapterCommentCreate,
    ) -> LibraryChapterCommentResource:
        chapter = await self.session.get(LibraryChapter, chapter_id)
        if chapter is None:
            raise BridgeAPIError(404, f"Library chapter not found: {chapter_id}")

        message = payload.message.strip()
        if not message:
            raise BridgeAPIError(422, "Comment message cannot be empty")

        now = datetime.now(timezone.utc)
        comment = LibraryChapterComment(
            chapter_id=chapter_id,
            page_index=payload.page_index,
            message=message,
            created_at=now,
            updated_at=now,
        )
        self.session.add(comment)
        await self.session.commit()
        await self.session.refresh(comment)
        return self._to_chapter_comment_resource(comment, chapter)

    async def update_chapter_comment(
        self,
        comment_id: int,
        payload: LibraryChapterCommentUpdate,
    ) -> LibraryChapterCommentResource:
        comment = await self.session.get(LibraryChapterComment, comment_id)
        if comment is None:
            raise BridgeAPIError(
                404, f"Library chapter comment not found: {comment_id}"
            )

        chapter = await self.session.get(LibraryChapter, int(comment.chapter_id))
        if chapter is None:
            raise BridgeAPIError(
                404, f"Library chapter not found: {comment.chapter_id}"
            )

        updates = payload.model_dump(exclude_unset=True)
        changed = False
        if "page_index" in updates:
            comment.page_index = int(updates["page_index"])
            changed = True
        if "message" in updates:
            message = updates["message"]
            if message is None:
                raise BridgeAPIError(422, "Comment message cannot be empty")
            message = message.strip()
            if not message:
                raise BridgeAPIError(422, "Comment message cannot be empty")
            comment.message = message
            changed = True

        if changed:
            comment.updated_at = datetime.now(timezone.utc)
            self.session.add(comment)
            await self._commit_with_sqlite_retry()
            await self.session.refresh(comment)

        return self._to_chapter_comment_resource(comment, chapter)

    async def delete_chapter_comment(self, comment_id: int) -> None:
        comment = await self.session.get(LibraryChapterComment, comment_id)
        if comment is None:
            return
        await self.session.delete(comment)
        await self._commit_with_sqlite_retry()

    async def list_title_comments(
        self,
        title_id: int,
        variant_id: int | None = None,
        newest_first: bool = True,
    ) -> list[LibraryChapterCommentResource]:
        title = await self.session.get(LibraryTitle, title_id)
        if title is None:
            raise BridgeAPIError(404, f"Library title not found: {title_id}")

        chapter_stmt = select(LibraryChapter).where(
            LibraryChapter.library_title_id == title_id
        )
        if variant_id is not None:
            chapter_stmt = chapter_stmt.where(LibraryChapter.variant_id == variant_id)

        chapter_rows = (await self.session.exec(chapter_stmt)).all()
        chapters = list(chapter_rows)
        if not chapters:
            return []
        chapter_by_id = {
            int(chapter.id): chapter for chapter in chapters if chapter.id is not None
        }
        chapter_ids = list(chapter_by_id.keys())
        if not chapter_ids:
            return []

        order = (
            desc(LibraryChapterComment.created_at)
            if newest_first
            else LibraryChapterComment.created_at
        )
        comment_rows = (
            await self.session.exec(
                select(LibraryChapterComment)
                .where(LibraryChapterComment.chapter_id.in_(chapter_ids))
                .order_by(order, desc(LibraryChapterComment.id))
            )
        ).all()
        comments = list(comment_rows)
        resources: list[LibraryChapterCommentResource] = []
        for comment in comments:
            chapter = chapter_by_id.get(int(comment.chapter_id))
            if chapter is None:
                continue
            resources.append(self._to_chapter_comment_resource(comment, chapter))
        return resources

    async def get_chapter_progress(
        self, chapter_id: int
    ) -> LibraryChapterProgressResource:
        chapter = await self.session.get(LibraryChapter, chapter_id)
        if chapter is None:
            raise BridgeAPIError(404, f"Library chapter not found: {chapter_id}")
        return LibraryChapterProgressResource(
            chapter_id=chapter_id,
            page_index=chapter.reader_page_index,
            comment=chapter.reader_comment,
            updated_at=chapter.reader_updated_at,
        )

    async def update_chapter_progress(
        self,
        chapter_id: int,
        payload: LibraryChapterProgressUpdate,
    ) -> LibraryChapterProgressResource:
        chapter = await self.session.get(LibraryChapter, chapter_id)
        if chapter is None:
            raise BridgeAPIError(404, f"Library chapter not found: {chapter_id}")

        updates = payload.model_dump(exclude_unset=True)
        changed = False
        now = datetime.now(timezone.utc)

        if "page_index" in updates:
            chapter.reader_page_index = updates["page_index"]
            changed = True

        if "comment" in updates:
            comment = updates["comment"]
            if comment is not None:
                comment = comment.strip()
                if comment == "":
                    comment = None
            chapter.reader_comment = comment
            changed = True

        if changed:
            chapter.reader_updated_at = now
            chapter.updated_at = now
            self.session.add(chapter)
            await self._commit_with_sqlite_retry()
            await self.session.refresh(chapter)

        return LibraryChapterProgressResource(
            chapter_id=chapter_id,
            page_index=chapter.reader_page_index,
            comment=chapter.reader_comment,
            updated_at=chapter.reader_updated_at,
        )

    async def reset_chapter_progress(self, chapter_id: int) -> None:
        chapter = await self.session.get(LibraryChapter, chapter_id)
        if chapter is None:
            raise BridgeAPIError(404, f"Library chapter not found: {chapter_id}")

        if (
            chapter.reader_page_index is None
            and chapter.reader_comment is None
            and chapter.reader_updated_at is None
            and not chapter.is_read
        ):
            return

        chapter.is_read = False
        chapter.reader_page_index = None
        chapter.reader_comment = None
        chapter.reader_updated_at = None
        chapter.updated_at = datetime.now(timezone.utc)
        self.session.add(chapter)
        await self._commit_with_sqlite_retry()

    async def reset_title_progress(self, title_id: int) -> None:
        title = await self.session.get(LibraryTitle, title_id)
        if title is None:
            raise BridgeAPIError(404, f"Library title not found: {title_id}")

        rows = (
            await self.session.exec(
                select(LibraryChapter).where(
                    LibraryChapter.library_title_id == title_id
                )
            )
        ).all()
        chapters = list(rows)
        if not chapters:
            return

        now = datetime.now(timezone.utc)
        changed = False
        for chapter in chapters:
            if (
                chapter.reader_page_index is None
                and chapter.reader_comment is None
                and chapter.reader_updated_at is None
                and not chapter.is_read
            ):
                continue
            chapter.is_read = False
            chapter.reader_page_index = None
            chapter.reader_comment = None
            chapter.reader_updated_at = None
            chapter.updated_at = now
            self.session.add(chapter)
            changed = True

        if changed:
            await self._commit_with_sqlite_retry()

    async def list_source_matches(
        self,
        title_id: int,
        lang: str | None = None,
        limit_sources: int = 24,
        min_score: float = 0.84,
    ) -> list[LibrarySourceMatchResource]:
        title = await self._get_library_title_or_404(title_id)
        variant_rows = (
            await self.session.exec(
                select(LibraryTitleVariant).where(
                    LibraryTitleVariant.library_title_id == title_id
                )
            )
        ).all()
        variants = list(variant_rows)
        linked_source_ids = {variant.source_id for variant in variants}
        linked_keys = {(variant.source_id, variant.title_url) for variant in variants}

        anchor_variant = max(
            variants,
            key=lambda item: (
                item.last_synced_at or datetime.fromtimestamp(0, tz=timezone.utc),
                int(item.id or 0),
            ),
            default=None,
        )
        query_titles: list[str] = []
        seen_query_titles: set[str] = set()
        for query_candidate in [
            anchor_variant.title if anchor_variant else None,
            title.title,
            *[variant.title for variant in variants],
        ]:
            trimmed = (query_candidate or "").strip()
            normalized = _normalize(trimmed)
            if not trimmed or not normalized or normalized in seen_query_titles:
                continue
            seen_query_titles.add(normalized)
            query_titles.append(trimmed)
        if not query_titles:
            query_titles = [title.title]

        query_author = (
            (anchor_variant.author if anchor_variant else None)
            or title.author
            or next(
                (
                    (variant.author or "").strip()
                    for variant in variants
                    if (variant.author or "").strip()
                ),
                "",
            )
        ).strip()

        source_summaries = await self._list_enabled_source_summaries()
        if lang:
            normalized_lang = lang.strip().lower()
            source_summaries = [
                source
                for source in source_summaries
                if (source.lang or "").strip().lower() == normalized_lang
            ]
        source_by_id = {source.id: source for source in source_summaries}
        missing_variant_source_ids = {
            variant.source_id
            for variant in variants
            if variant.source_id not in source_by_id
        }
        if missing_variant_source_ids:
            all_source_summaries = await self._list_source_summaries(enabled=None)
            for source in all_source_summaries:
                source_by_id.setdefault(source.id, source)

        anchor_extension_pkg = None
        if anchor_variant is not None:
            anchor_source = source_by_id.get(anchor_variant.source_id)
            anchor_extension_pkg = (
                anchor_source.extension_pkg if anchor_source else None
            )

        source_summaries.sort(
            key=lambda source: (
                0
                if anchor_extension_pkg is not None
                and source.extension_pkg == anchor_extension_pkg
                else 1,
                source.name.lower(),
                source.lang.lower(),
            )
        )

        matches: list[LibrarySourceMatchResource] = []
        match_keys: set[tuple[str, str]] = set()
        direct_matched_source_ids: set[str] = set()
        failed_sources: list[tuple[str, str]] = []

        preferred_variant_by_extension_pkg: dict[str, LibraryTitleVariant] = {}
        for variant in variants:
            source = source_by_id.get(variant.source_id)
            if source is None:
                continue
            extension_pkg = source.extension_pkg
            current = preferred_variant_by_extension_pkg.get(extension_pkg)
            if current is None:
                preferred_variant_by_extension_pkg[extension_pkg] = variant
                continue
            current_stamp = current.last_synced_at or datetime.fromtimestamp(
                0, tz=timezone.utc
            )
            variant_stamp = variant.last_synced_at or datetime.fromtimestamp(
                0, tz=timezone.utc
            )
            if (variant_stamp, int(variant.id or 0)) > (
                current_stamp,
                int(current.id or 0),
            ):
                preferred_variant_by_extension_pkg[extension_pkg] = variant

        # Same extension usually keeps stable title URL between language sources.
        # Prefer direct URL linking here and skip search.
        for source in source_summaries:
            if source.id in linked_source_ids:
                continue
            preferred_variant = preferred_variant_by_extension_pkg.get(
                source.extension_pkg
            )
            if preferred_variant is None:
                continue
            title_url = preferred_variant.title_url
            key = (source.id, title_url)
            if key in linked_keys or key in match_keys:
                continue

            existing_variant = (
                await self.session.exec(
                    select(LibraryTitleVariant).where(
                        LibraryTitleVariant.source_id == source.id,
                        LibraryTitleVariant.title_url == title_url,
                    )
                )
            ).first()
            linked_library_title_id = (
                int(existing_variant.library_title_id) if existing_variant else None
            )

            matches.append(
                LibrarySourceMatchResource(
                    source_id=source.id,
                    source_name=source.name,
                    source_lang=source.lang,
                    title_url=title_url,
                    title=(
                        existing_variant.title
                        if existing_variant is not None
                        else preferred_variant.title
                    ),
                    thumbnail_url=(
                        existing_variant.thumbnail_url
                        if existing_variant is not None
                        else (preferred_variant.thumbnail_url or "")
                    ),
                    artist=(
                        existing_variant.artist
                        if existing_variant is not None
                        else preferred_variant.artist
                    ),
                    author=(
                        existing_variant.author
                        if existing_variant is not None
                        else preferred_variant.author
                    ),
                    score=1.0,
                    already_linked=linked_library_title_id == title_id,
                    linked_library_title_id=linked_library_title_id,
                )
            )
            match_keys.add(key)
            direct_matched_source_ids.add(source.id)

        searched_sources = 0
        for source in source_summaries:
            if source.id in linked_source_ids:
                continue
            if source.id in direct_matched_source_ids:
                continue
            if searched_sources >= max(1, limit_sources):
                break
            searched_sources += 1

            candidate = None
            candidate_score = 0.0
            source_search_failures: list[str] = []
            for query_title in query_titles[:_MATCH_QUERY_TITLES_MAX]:
                try:
                    search_results, _ = await tachibridge.search_titles(
                        source_id=source.id,
                        query=query_title,
                        page=1,
                    )
                except BridgeAPIError as exc:
                    source_search_failures.append(
                        self._summarize_source_match_search_error(exc)
                    )
                    continue
                picked = self._pick_source_match_candidate(
                    query_title=query_title,
                    query_author=query_author,
                    results=search_results,
                    min_score=min_score,
                )
                if picked is None:
                    continue
                picked_title, picked_score = picked
                if picked_score > candidate_score:
                    candidate = picked_title
                    candidate_score = picked_score

            if candidate is None and query_author:
                try:
                    author_results, _ = await tachibridge.search_titles(
                        source_id=source.id,
                        query=query_author,
                        page=1,
                    )
                except BridgeAPIError as exc:
                    source_search_failures.append(
                        self._summarize_source_match_search_error(exc)
                    )
                    author_results = []
                if author_results:
                    picked = self._pick_source_match_candidate(
                        query_title=query_titles[0],
                        query_author=query_author,
                        results=author_results,
                        min_score=min_score,
                        allow_author_only=True,
                    )
                    if picked is not None:
                        candidate, candidate_score = picked

            if source_search_failures:
                deduped_failures = list(dict.fromkeys(source_search_failures))
                failure_preview = "; ".join(deduped_failures[:2])
                if len(deduped_failures) > 2:
                    failure_preview = (
                        f"{failure_preview}; +{len(deduped_failures) - 2} more"
                    )
                source_label = self._source_match_source_label(source)
                _library_logger.warning(
                    "Source match search failed for {}: {}",
                    source_label,
                    failure_preview,
                )
                failed_sources.append(
                    (
                        self._source_match_source_short_label(source),
                        deduped_failures[0],
                    )
                )

            if candidate is None:
                continue

            title_url = candidate.url
            if (source.id, title_url) in linked_keys:
                continue
            if (source.id, title_url) in match_keys:
                continue

            existing_variant = (
                await self.session.exec(
                    select(LibraryTitleVariant).where(
                        LibraryTitleVariant.source_id == source.id,
                        LibraryTitleVariant.title_url == title_url,
                    )
                )
            ).first()
            linked_library_title_id = (
                int(existing_variant.library_title_id) if existing_variant else None
            )

            matches.append(
                LibrarySourceMatchResource(
                    source_id=source.id,
                    source_name=source.name,
                    source_lang=source.lang,
                    title_url=title_url,
                    title=candidate.title,
                    thumbnail_url=candidate.thumbnail_url or "",
                    artist=candidate.artist,
                    author=candidate.author,
                    score=round(candidate_score, 4),
                    already_linked=linked_library_title_id == title_id,
                    linked_library_title_id=linked_library_title_id,
                )
            )
            match_keys.add((source.id, title_url))

        if query_author:
            candidate_source_ids = [
                source.id
                for source in source_summaries
                if source.id not in linked_source_ids
                and source.id not in direct_matched_source_ids
            ]
            if candidate_source_ids:
                existing_variant_rows = (
                    await self.session.exec(
                        select(LibraryTitleVariant).where(
                            LibraryTitleVariant.source_id.in_(candidate_source_ids),
                            LibraryTitleVariant.library_title_id != title_id,
                        )
                    )
                ).all()
                author_fallback_by_source: dict[str, list[LibraryTitleVariant]] = {}
                normalized_query_author = _normalize(query_author)
                for variant in existing_variant_rows:
                    key = (variant.source_id, variant.title_url)
                    if key in linked_keys or key in match_keys:
                        continue
                    if _normalize(variant.author) != normalized_query_author:
                        continue
                    author_fallback_by_source.setdefault(variant.source_id, []).append(
                        variant
                    )

                by_source_summary = {source.id: source for source in source_summaries}
                for source_id, fallback_variants in author_fallback_by_source.items():
                    # Author-only fallback is intentionally conservative:
                    # use only unambiguous single candidates per source.
                    if len(fallback_variants) != 1:
                        continue
                    variant = fallback_variants[0]
                    key = (variant.source_id, variant.title_url)
                    if key in linked_keys or key in match_keys:
                        continue

                    score = max(
                        (
                            self._source_match_score(
                                query_title=query_title,
                                query_author=query_author,
                                candidate_title=variant.title,
                                candidate_author=variant.author,
                            )
                            for query_title in query_titles[:_MATCH_QUERY_TITLES_MAX]
                        ),
                        default=0.0,
                    )
                    score = max(score, min_score + 0.001)
                    source_summary = by_source_summary.get(source_id)

                    matches.append(
                        LibrarySourceMatchResource(
                            source_id=variant.source_id,
                            source_name=(
                                source_summary.name
                                if source_summary
                                else (variant.source_name or variant.source_id)
                            ),
                            source_lang=(
                                source_summary.lang
                                if source_summary
                                else variant.source_lang
                            ),
                            title_url=variant.title_url,
                            title=variant.title,
                            thumbnail_url=variant.thumbnail_url or "",
                            artist=variant.artist,
                            author=variant.author,
                            score=round(score, 4),
                            already_linked=False,
                            linked_library_title_id=int(variant.library_title_id),
                        )
                    )
                    match_keys.add(key)

        matches.sort(
            key=lambda item: (
                item.linked_library_title_id is not None
                and item.linked_library_title_id != title_id,
                -item.score,
                item.source_name.lower(),
            )
        )
        if not matches and failed_sources:
            failure_preview = "; ".join(
                f"{source_label}: {reason}"
                for source_label, reason in failed_sources[:3]
            )
            if len(failed_sources) > 3:
                failure_preview = f"{failure_preview}; +{len(failed_sources) - 3} more"
            raise BridgeAPIError(
                502,
                "Source match search unavailable for "
                f"{len(failed_sources)} source(s): {failure_preview}",
            )
        return matches

    async def link_variant(
        self,
        title_id: int,
        source_id: str,
        title_url: str,
    ) -> LibraryLinkVariantResponse:
        library_title = await self._get_library_title_or_404(title_id)
        normalized_source_id = source_id.strip()
        normalized_title_url = title_url.strip()
        if not normalized_source_id:
            raise BridgeAPIError(400, "source_id is required")
        if not normalized_title_url:
            raise BridgeAPIError(400, "title_url is required")

        profile = (
            await self.session.exec(
                select(DownloadProfile).where(
                    DownloadProfile.library_title_id == title_id
                )
            )
        ).first()
        pin_variant_id: int | None = None
        if (
            profile is not None
            and profile.enabled
            and not await self._profile_variant_ids(profile)
        ):
            try:
                current_variant = await self._resolve_variant(
                    title_id=title_id, variant_id=None
                )
                if current_variant.id is not None:
                    pin_variant_id = int(current_variant.id)
            except BridgeAPIError:
                pin_variant_id = None

        existing_variant = (
            await self.session.exec(
                select(LibraryTitleVariant).where(
                    LibraryTitleVariant.source_id == normalized_source_id,
                    LibraryTitleVariant.title_url == normalized_title_url,
                )
            )
        ).first()
        if existing_variant is not None:
            if existing_variant.library_title_id != title_id:
                raise BridgeAPIError(
                    409,
                    "Source title is already linked to another library title",
                )
            if existing_variant.id is None:
                raise BridgeAPIError(500, "Linked variant is missing id")
            if library_title.preferred_variant_id is None:
                library_title.preferred_variant_id = int(existing_variant.id)
                library_title.updated_at = datetime.now(timezone.utc)
                self.session.add(library_title)
                await self.session.commit()
            return LibraryLinkVariantResponse(
                library_title_id=title_id,
                variant=self._to_variant_resource(existing_variant),
                created=False,
            )

        source = await self._resolve_source(normalized_source_id)
        details = await tachibridge.fetch_title_details(
            source_id=normalized_source_id,
            title_url=normalized_title_url,
        )
        chapters = await tachibridge.fetch_title_chapters(
            source_id=normalized_source_id,
            title_url=normalized_title_url,
        )
        now = datetime.now(timezone.utc)

        variant = LibraryTitleVariant(
            library_title_id=title_id,
            source_id=normalized_source_id,
            source_name=source.name,
            source_lang=source.lang,
            title_url=normalized_title_url,
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
        await self.session.flush()
        await self.session.refresh(variant)
        if variant.id is None:
            raise BridgeAPIError(500, "Failed to create variant")

        await self._sync_variant_chapters(
            library_title_id=title_id,
            variant_id=int(variant.id),
            chapters=chapters,
            now=now,
        )
        if library_title.preferred_variant_id is None:
            library_title.preferred_variant_id = int(variant.id)
            library_title.updated_at = now
            self.session.add(library_title)
        if (
            profile is not None
            and profile.enabled
            and not await self._profile_variant_ids(profile)
            and pin_variant_id is not None
        ):
            await self._set_profile_variant_ids(profile, [pin_variant_id])
            profile.updated_at = now
            self.session.add(profile)
        await self._commit_with_sqlite_retry()

        return LibraryLinkVariantResponse(
            library_title_id=title_id,
            variant=self._to_variant_resource(variant),
            created=True,
        )

    async def merge_titles(
        self,
        target_title_id: int,
        source_title_id: int,
    ) -> LibraryMergeTitlesResponse:
        if target_title_id == source_title_id:
            raise BridgeAPIError(400, "Cannot merge a title into itself")

        target = await self._get_library_title_or_404(target_title_id)
        source = await self._get_library_title_or_404(source_title_id)
        now = datetime.now(timezone.utc)

        target_variant_rows = (
            await self.session.exec(
                select(LibraryTitleVariant).where(
                    LibraryTitleVariant.library_title_id == target_title_id
                )
            )
        ).all()
        source_variant_rows = (
            await self.session.exec(
                select(LibraryTitleVariant).where(
                    LibraryTitleVariant.library_title_id == source_title_id
                )
            )
        ).all()

        target_variant_by_key = {
            (variant.source_id, variant.title_url): variant
            for variant in target_variant_rows
            if variant.id is not None
        }

        moved_variants = 0
        moved_chapters = 0
        variant_id_remap: dict[int, int] = {}

        for source_variant in source_variant_rows:
            if source_variant.id is None:
                continue
            source_variant_id = int(source_variant.id)
            source_key = (source_variant.source_id, source_variant.title_url)
            target_variant = target_variant_by_key.get(source_key)

            if target_variant is None:
                source_variant.library_title_id = target_title_id
                source_variant.updated_at = now
                self.session.add(source_variant)

                chapter_count = int(
                    (
                        await self.session.exec(
                            select(func.count(LibraryChapter.id)).where(
                                LibraryChapter.variant_id == source_variant_id
                            )
                        )
                    ).one()
                    or 0
                )
                if chapter_count:
                    await self.session.exec(
                        update(LibraryChapter)
                        .where(LibraryChapter.variant_id == source_variant_id)
                        .values(
                            library_title_id=target_title_id,
                            updated_at=now,
                        )
                    )
                    await self.session.exec(
                        update(DownloadTask)
                        .where(DownloadTask.variant_id == source_variant_id)
                        .values(
                            library_title_id=target_title_id,
                            updated_at=now,
                        )
                    )
                moved_variants += 1
                moved_chapters += chapter_count
                variant_id_remap[source_variant_id] = source_variant_id
                target_variant_by_key[source_key] = source_variant
                continue

            if target_variant.id is None:
                raise BridgeAPIError(500, f"Broken target variant: {source_key[0]}")

            target_variant_id = int(target_variant.id)
            variant_id_remap[source_variant_id] = target_variant_id

            target_chapter_rows = (
                await self.session.exec(
                    select(LibraryChapter).where(
                        LibraryChapter.variant_id == target_variant_id
                    )
                )
            ).all()
            source_chapter_rows = (
                await self.session.exec(
                    select(LibraryChapter).where(
                        LibraryChapter.variant_id == source_variant_id
                    )
                )
            ).all()
            target_chapters_by_url = {
                chapter.chapter_url: chapter
                for chapter in target_chapter_rows
                if chapter.id is not None
            }

            for source_chapter in source_chapter_rows:
                if source_chapter.id is None:
                    continue
                source_chapter_id = int(source_chapter.id)
                moved_chapters += 1

                matched = target_chapters_by_url.get(source_chapter.chapter_url)
                if matched is None:
                    source_chapter.library_title_id = target_title_id
                    source_chapter.variant_id = target_variant_id
                    source_chapter.updated_at = now
                    self.session.add(source_chapter)
                    await self.session.exec(
                        update(DownloadTask)
                        .where(DownloadTask.chapter_id == source_chapter_id)
                        .values(
                            library_title_id=target_title_id,
                            variant_id=target_variant_id,
                            updated_at=now,
                        )
                    )
                    continue

                if matched.id is None:
                    raise BridgeAPIError(500, "Broken merged chapter")
                matched_id = int(matched.id)

                if not matched.name and source_chapter.name:
                    matched.name = source_chapter.name
                if matched.chapter_number <= 0 and source_chapter.chapter_number > 0:
                    matched.chapter_number = source_chapter.chapter_number
                if not matched.scanlator and source_chapter.scanlator:
                    matched.scanlator = source_chapter.scanlator
                if source_chapter.date_upload > matched.date_upload:
                    matched.date_upload = source_chapter.date_upload
                if source_chapter.position > 0 and (
                    matched.position <= 0 or source_chapter.position < matched.position
                ):
                    matched.position = source_chapter.position
                matched.is_read = matched.is_read or source_chapter.is_read

                if source_chapter.is_downloaded and not matched.is_downloaded:
                    matched.is_downloaded = True
                    matched.downloaded_at = source_chapter.downloaded_at
                    matched.download_path = source_chapter.download_path
                    matched.download_error = source_chapter.download_error
                elif source_chapter.is_downloaded and matched.is_downloaded:
                    if source_chapter.downloaded_at and (
                        matched.downloaded_at is None
                        or source_chapter.downloaded_at > matched.downloaded_at
                    ):
                        matched.downloaded_at = source_chapter.downloaded_at
                    if source_chapter.download_path and not matched.download_path:
                        matched.download_path = source_chapter.download_path
                    if source_chapter.download_error and not matched.download_error:
                        matched.download_error = source_chapter.download_error
                elif source_chapter.download_error and not matched.download_error:
                    matched.download_error = source_chapter.download_error

                matched.updated_at = now
                self.session.add(matched)

                source_page_rows = (
                    await self.session.exec(
                        select(LibraryChapterPage).where(
                            LibraryChapterPage.chapter_id == source_chapter_id
                        )
                    )
                ).all()
                target_page_rows = (
                    await self.session.exec(
                        select(LibraryChapterPage).where(
                            LibraryChapterPage.chapter_id == matched_id
                        )
                    )
                ).all()
                target_page_by_index = {
                    page.page_index: page
                    for page in target_page_rows
                    if page.id is not None
                }

                for source_page in source_page_rows:
                    merged_page = target_page_by_index.get(source_page.page_index)
                    if merged_page is None:
                        source_page.chapter_id = matched_id
                        self.session.add(source_page)
                        continue

                    if not merged_page.url and source_page.url:
                        merged_page.url = source_page.url
                    if not merged_page.image_url and source_page.image_url:
                        merged_page.image_url = source_page.image_url
                    if source_page.local_path and not merged_page.local_path:
                        merged_page.local_path = source_page.local_path
                        merged_page.local_size = source_page.local_size
                    elif (
                        source_page.local_path
                        and merged_page.local_path
                        and source_page.local_size is not None
                        and (merged_page.local_size or 0) < source_page.local_size
                    ):
                        merged_page.local_size = source_page.local_size
                    if source_page.fetched_at > merged_page.fetched_at:
                        merged_page.fetched_at = source_page.fetched_at

                    self.session.add(merged_page)
                    if source_page.id is not None:
                        await self.session.delete(source_page)

                await self.session.exec(
                    update(DownloadTask)
                    .where(DownloadTask.chapter_id == source_chapter_id)
                    .values(
                        library_title_id=target_title_id,
                        variant_id=target_variant_id,
                        chapter_id=matched_id,
                        updated_at=now,
                    )
                )
                await self.session.delete(source_chapter)

            await self.session.delete(source_variant)

        source_collection_rows = (
            await self.session.exec(
                select(LibraryCollectionTitle).where(
                    LibraryCollectionTitle.library_title_id == source_title_id
                )
            )
        ).all()
        target_collection_rows = (
            await self.session.exec(
                select(LibraryCollectionTitle).where(
                    LibraryCollectionTitle.library_title_id == target_title_id
                )
            )
        ).all()
        target_collection_ids = {
            int(item.collection_id)
            for item in target_collection_rows
            if item.id is not None
        }
        for row in source_collection_rows:
            if row.id is None:
                continue
            if int(row.collection_id) in target_collection_ids:
                await self.session.delete(row)
                continue
            row.library_title_id = target_title_id
            self.session.add(row)
            target_collection_ids.add(int(row.collection_id))

        target_profile = (
            await self.session.exec(
                select(DownloadProfile).where(
                    DownloadProfile.library_title_id == target_title_id
                )
            )
        ).first()
        source_profile = (
            await self.session.exec(
                select(DownloadProfile).where(
                    DownloadProfile.library_title_id == source_title_id
                )
            )
        ).first()

        async def remap_preferred_variant(variant_id: int | None) -> int | None:
            if variant_id is None:
                return None
            remapped = int(variant_id_remap.get(int(variant_id), int(variant_id)))
            variant = await self.session.get(LibraryTitleVariant, remapped)
            if variant is None or variant.library_title_id != target_title_id:
                return None
            if variant.id is None:
                return None
            return int(variant.id)

        async def remap_profile_variant_ids(
            profile: DownloadProfile | None,
        ) -> list[int]:
            if profile is None:
                return []
            remapped_ids = [
                int(variant_id_remap.get(int(variant_id), int(variant_id)))
                for variant_id in await self._profile_variant_ids(profile)
            ]
            return await self._normalize_monitoring_variant_ids(
                title_id=target_title_id,
                variant_ids=remapped_ids,
            )

        source_preferred_variant_id = await remap_preferred_variant(
            source_profile.preferred_variant_id if source_profile else None
        )
        source_variant_ids = await remap_profile_variant_ids(source_profile)
        target_variant_ids = await remap_profile_variant_ids(target_profile)

        if source_profile is not None and target_profile is None:
            source_profile.library_title_id = target_title_id
            if source_variant_ids:
                await self._set_profile_variant_ids(source_profile, source_variant_ids)
            elif source_preferred_variant_id is not None:
                await self._set_profile_variant_ids(
                    source_profile, [source_preferred_variant_id]
                )
            else:
                await self._set_profile_variant_ids(source_profile, [])
            source_profile.updated_at = now
            self.session.add(source_profile)
            target_profile = source_profile
        elif source_profile is not None and target_profile is not None:
            target_profile.enabled = target_profile.enabled or source_profile.enabled
            target_profile.auto_download = (
                target_profile.auto_download or source_profile.auto_download
            )

            if target_profile.start_from is None:
                target_profile.start_from = source_profile.start_from
            elif source_profile.start_from is not None:
                target_profile.start_from = min(
                    target_profile.start_from,
                    source_profile.start_from,
                )

            merged_variant_ids = list(
                dict.fromkeys([*target_variant_ids, *source_variant_ids])
            )
            if merged_variant_ids:
                await self._set_profile_variant_ids(target_profile, merged_variant_ids)
            elif (
                target_profile.preferred_variant_id is None
                and source_preferred_variant_id is not None
            ):
                await self._set_profile_variant_ids(
                    target_profile, [source_preferred_variant_id]
                )

            if source_profile.last_checked_at and (
                target_profile.last_checked_at is None
                or source_profile.last_checked_at > target_profile.last_checked_at
            ):
                target_profile.last_checked_at = source_profile.last_checked_at
            if source_profile.last_success_at and (
                target_profile.last_success_at is None
                or source_profile.last_success_at > target_profile.last_success_at
            ):
                target_profile.last_success_at = source_profile.last_success_at
            if not target_profile.last_error and source_profile.last_error:
                target_profile.last_error = source_profile.last_error

            target_profile.updated_at = now
            self.session.add(target_profile)
            await self.session.delete(source_profile)

        if target_profile is not None:
            target_preferred_variant_id = await remap_preferred_variant(
                target_profile.preferred_variant_id
            )
            if target_preferred_variant_id != target_profile.preferred_variant_id:
                selected_variant_ids = await remap_profile_variant_ids(target_profile)
                if target_preferred_variant_id is not None:
                    reordered_ids = [target_preferred_variant_id] + [
                        item
                        for item in selected_variant_ids
                        if item != target_preferred_variant_id
                    ]
                    await self._set_profile_variant_ids(target_profile, reordered_ids)
                else:
                    await self._set_profile_variant_ids(
                        target_profile, selected_variant_ids
                    )
                target_profile.updated_at = now
                self.session.add(target_profile)

        target_preferred_title_variant_id = await remap_preferred_variant(
            target.preferred_variant_id
        )
        source_preferred_title_variant_id = await remap_preferred_variant(
            source.preferred_variant_id
        )
        if target_preferred_title_variant_id is not None:
            target.preferred_variant_id = target_preferred_title_variant_id
        elif source_preferred_title_variant_id is not None:
            target.preferred_variant_id = source_preferred_title_variant_id

        if target.user_status_id is None and source.user_status_id is not None:
            target.user_status_id = source.user_status_id
        if target.user_rating is None and source.user_rating is not None:
            target.user_rating = source.user_rating
        if not target.thumbnail_url and source.thumbnail_url:
            target.thumbnail_url = source.thumbnail_url
        if not target.description and source.description:
            target.description = source.description
        if not target.artist and source.artist:
            target.artist = source.artist
        if not target.author and source.author:
            target.author = source.author
        if not target.genre and source.genre:
            target.genre = source.genre
        if target.status == 0 and source.status != 0:
            target.status = source.status
        if target.preferred_variant_id is None:
            fallback_variant_id = (
                await self.session.exec(
                    select(LibraryTitleVariant.id)
                    .where(LibraryTitleVariant.library_title_id == target_title_id)
                    .order_by(
                        desc(LibraryTitleVariant.last_synced_at), LibraryTitleVariant.id
                    )
                    .limit(1)
                )
            ).first()
            if fallback_variant_id is not None:
                target.preferred_variant_id = int(fallback_variant_id)
        target.updated_at = now
        self.session.add(target)

        await self.session.exec(
            update(DownloadTask)
            .where(DownloadTask.library_title_id == source_title_id)
            .values(
                library_title_id=target_title_id,
                updated_at=now,
            )
        )
        await self.session.exec(
            update(LibraryChapter)
            .where(LibraryChapter.library_title_id == source_title_id)
            .values(
                library_title_id=target_title_id,
                updated_at=now,
            )
        )
        await self.session.exec(
            update(LibraryTitleVariant)
            .where(LibraryTitleVariant.library_title_id == source_title_id)
            .values(
                library_title_id=target_title_id,
                updated_at=now,
            )
        )

        remaining_source_chapter_id_rows = (
            await self.session.exec(
                select(LibraryChapter.id).where(
                    LibraryChapter.library_title_id == source_title_id
                )
            )
        ).all()
        remaining_source_chapter_ids = [
            int(item) for item in remaining_source_chapter_id_rows
        ]
        if remaining_source_chapter_ids:
            await self.session.exec(
                delete(LibraryChapterPage).where(
                    LibraryChapterPage.chapter_id.in_(remaining_source_chapter_ids)
                )
            )
            await self.session.exec(
                delete(LibraryChapter).where(
                    LibraryChapter.id.in_(remaining_source_chapter_ids)
                )
            )

        await self.session.exec(
            delete(LibraryCollectionTitle).where(
                LibraryCollectionTitle.library_title_id == source_title_id
            )
        )
        await self.session.exec(
            delete(DownloadProfile).where(
                DownloadProfile.library_title_id == source_title_id
            )
        )
        await self.session.exec(
            delete(DownloadTask).where(DownloadTask.library_title_id == source_title_id)
        )
        await self.session.exec(
            delete(LibraryTitleVariant).where(
                LibraryTitleVariant.library_title_id == source_title_id
            )
        )
        await self.session.delete(source)
        await self.session.commit()

        return LibraryMergeTitlesResponse(
            library_title_id=target_title_id,
            merged_title_id=source_title_id,
            moved_variants=moved_variants,
            moved_chapters=moved_chapters,
        )

    async def get_chapter_pages(
        self,
        chapter_id: int,
        refresh: bool = False,
    ) -> list[LibraryChapterPageResource]:
        chapter = await self.session.get(LibraryChapter, chapter_id)
        if chapter is None:
            raise BridgeAPIError(404, f"Library chapter not found: {chapter_id}")

        cached_rows = (
            await self.session.exec(
                select(LibraryChapterPage)
                .where(LibraryChapterPage.chapter_id == chapter_id)
                .order_by(LibraryChapterPage.page_index)
            )
        ).all()
        cached_pages = list(cached_rows)

        if chapter.is_downloaded:
            cached_pages = await self._ensure_downloaded_pages_cache(
                chapter=chapter,
                cached_pages=cached_pages,
            )
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

        if refresh or not cached_pages:
            variant = await self.session.get(LibraryTitleVariant, chapter.variant_id)
            if variant is None:
                raise BridgeAPIError(
                    500, f"Library chapter has no variant: {chapter_id}"
                )
            bridge_chapter_url = chapter.chapter_url
            preflight_error = await self._preflight_mangalib_chapter_pages_unavailable(
                source_id=variant.source_id,
                chapter_url=bridge_chapter_url,
            )
            if preflight_error:
                raise BridgeAPIError(409, preflight_error)
            try:
                bridge_page_metrics.record_fetch_attempt()
                pages = await tachibridge.fetch_chapter_pages(
                    source_id=variant.source_id,
                    chapter_url=bridge_chapter_url,
                )
            except BridgeAPIError as exc:
                if exc.status_code == 404:
                    bridge_page_metrics.record_not_found()
                    recovered_pages = await self._recover_chapter_pages_from_fresh_url(
                        chapter=chapter,
                        variant=variant,
                        attempted_chapter_url=bridge_chapter_url,
                    )
                    if recovered_pages is not None:
                        bridge_page_metrics.record_recovered()
                        pages = recovered_pages
                    else:
                        bridge_page_metrics.record_recovery_failed()
                        normalized = await self._normalize_mangalib_pages_error(
                            source_id=variant.source_id,
                            chapter_url=bridge_chapter_url,
                            error_text=str(exc),
                        )
                        if normalized:
                            raise BridgeAPIError(409, normalized) from exc
                        raise
                else:
                    normalized = await self._normalize_mangalib_pages_error(
                        source_id=variant.source_id,
                        chapter_url=bridge_chapter_url,
                        error_text=str(exc),
                    )
                    if normalized:
                        raise BridgeAPIError(409, normalized) from exc
                    raise
            if not pages:
                raise BridgeAPIError(
                    409,
                    "Chapter pages are unavailable from source API (empty response).",
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
            await self._commit_with_sqlite_retry()

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

    async def _recover_chapter_pages_from_fresh_url(
        self,
        chapter: LibraryChapter,
        variant: LibraryTitleVariant,
        attempted_chapter_url: str,
    ) -> list[Page] | None:
        bridge_page_metrics.record_recovery_attempt()
        try:
            source_chapters = await tachibridge.fetch_title_chapters(
                source_id=variant.source_id,
                title_url=variant.title_url,
            )
        except BridgeAPIError:
            return None

        replacement_url = choose_replacement_chapter_url(
            current_url=chapter.chapter_url,
            current_name=chapter.name,
            current_number=chapter.chapter_number,
            current_scanlator=chapter.scanlator,
            source_chapters=source_chapters,
        )
        if not replacement_url:
            return None

        resolved_replacement = replacement_url
        if not resolved_replacement or resolved_replacement == attempted_chapter_url:
            return None

        try:
            bridge_page_metrics.record_fetch_attempt()
            pages = await tachibridge.fetch_chapter_pages(
                source_id=variant.source_id,
                chapter_url=resolved_replacement,
            )
        except BridgeAPIError:
            return None

        if not pages:
            return None

        previous_url = chapter.chapter_url
        chapter.chapter_url = replacement_url
        chapter.updated_at = datetime.now(timezone.utc)
        self.session.add(chapter)
        await self._commit_with_sqlite_retry()

        _library_logger.bind(
            chapter_id=chapter.id,
            source_id=variant.source_id,
            previous_url=previous_url,
            recovered_url=replacement_url,
        ).info("chapter.pages_recovered")
        return pages

    async def _ensure_downloaded_pages_cache(
        self,
        chapter: LibraryChapter,
        cached_pages: list[LibraryChapterPage],
    ) -> list[LibraryChapterPage]:
        if chapter.id is None:
            return cached_pages
        if not chapter.download_path:
            return cached_pages

        needs_local_paths = not cached_pages or any(
            not (page.local_path and page.local_path.strip()) for page in cached_pages
        )
        if not needs_local_paths:
            return cached_pages

        chapter_dir = self._resolve_chapter_download_dir(chapter.download_path)
        if chapter_dir is None:
            return cached_pages

        files = self._list_downloaded_page_files(chapter_dir)
        archive_members = list_chapter_archive_images(chapter_dir) if not files else []
        if not files and not archive_members:
            return cached_pages

        now = datetime.now(timezone.utc)
        existing_by_index = {page.page_index: page for page in cached_pages}
        normalized_download_path = chapter.download_path.strip("/").strip()
        if not normalized_download_path:
            return cached_pages

        for fallback_index, entry in enumerate(files or archive_members, start=1):
            if files:
                file_path = entry
                filename = file_path.name
                local_path = f"{normalized_download_path}/{filename}"
                local_size = file_path.stat().st_size
            else:
                member_path, local_size = entry
                filename = Path(member_path).name
                local_path = archive_member_virtual_path(
                    normalized_download_path,
                    member_path,
                )
                if local_path is None:
                    continue
            page_index = self._page_index_from_filename(filename, fallback_index)
            model = existing_by_index.get(page_index)
            if model is None:
                model = LibraryChapterPage(
                    chapter_id=int(chapter.id),
                    page_index=page_index,
                    url="",
                    image_url="",
                )
            model.local_path = local_path
            model.local_size = local_size
            model.fetched_at = now
            self.session.add(model)

        await self._commit_with_sqlite_retry()
        rows = (
            await self.session.exec(
                select(LibraryChapterPage)
                .where(LibraryChapterPage.chapter_id == int(chapter.id))
                .order_by(LibraryChapterPage.page_index)
            )
        ).all()
        return list(rows)

    @staticmethod
    def _resolve_chapter_download_dir(download_path: str) -> Path | None:
        normalized = download_path.strip("/").strip()
        if not normalized:
            return None
        roots = [
            settings.downloads.root_dir,
            settings.app.data_dir / "downloads",
            settings.app.config_dir / "downloads",
        ]
        for root in roots:
            resolved_root = root.resolve()
            candidate = (resolved_root / normalized).resolve()
            try:
                candidate.relative_to(resolved_root)
            except ValueError:
                continue
            if candidate.is_dir():
                return candidate
            if chapter_archive_path(candidate).is_file():
                return candidate
            if candidate.is_file() and candidate.suffix.lower() == ".cbz":
                return candidate.with_suffix("")
        return None

    @staticmethod
    def _list_downloaded_page_files(chapter_dir: Path) -> list[Path]:
        if not chapter_dir.exists() or not chapter_dir.is_dir():
            return []
        files = [
            path
            for path in chapter_dir.iterdir()
            if path.is_file() and path.suffix.lower() in _IMAGE_SUFFIXES
        ]

        def _sort_key(path: Path) -> tuple[int, str]:
            stem = path.stem
            match = _PAGE_INDEX_RE.search(stem)
            if match:
                return int(match.group(1)), path.name
            return 10**9, path.name

        return sorted(files, key=_sort_key)

    @staticmethod
    def _page_index_from_filename(filename: str, fallback: int) -> int:
        stem = Path(filename).stem
        match = _PAGE_INDEX_RE.search(stem)
        if match:
            return int(match.group(1))
        return fallback

    async def get_chapter_reader(
        self,
        chapter_id: int,
        refresh: bool = False,
    ) -> LibraryReaderChapterResource:
        chapter = await self.session.get(LibraryChapter, chapter_id)
        if chapter is None:
            raise BridgeAPIError(404, f"Library chapter not found: {chapter_id}")

        variant = await self.session.get(LibraryTitleVariant, chapter.variant_id)
        source_id = variant.source_id if variant is not None else None
        source_url_base = await self._resolve_source_image_base_url(source_id)
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

        pages = await self.get_chapter_pages(chapter_id=chapter_id, refresh=refresh)

        reader_pages: list[ReaderPageResource] = []
        for page in pages:
            remote = self._resolve_remote_page_url(
                image_url=page.image_url,
                page_url=page.url,
                chapter_url=chapter.chapter_url,
            )
            remote = self._prefer_source_page_image_path(
                remote_url=remote,
                page_url=page.url,
                source_url_base=source_url_base,
            )
            remote = self._resolve_source_relative_url(
                remote_url=remote,
                source_url_base=source_url_base,
            )
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
            reader_page_index=chapter.reader_page_index,
            reader_comment=chapter.reader_comment,
            reader_updated_at=chapter.reader_updated_at,
            pages=reader_pages,
        )

    async def _resolve_source(self, source_id: str) -> SourceSummary:
        sources = await self.extension_service.list_sources(
            installed=True,
            enabled=None,
            supports_latest=None,
        )
        summaries = [
            SourceSummary.from_models(extension, source)
            for extension, source in sources
        ]
        source = next((item for item in summaries if item.id == source_id), None)
        if source is None:
            raise BridgeAPIError(404, f"Source not found: {source_id}")
        return source

    async def _ensure_default_user_statuses(self) -> None:
        existing_count = int(
            (await self.session.exec(select(func.count(LibraryUserStatus.id)))).one()
            or 0
        )
        if existing_count > 0:
            return

        now = datetime.now(timezone.utc)
        for key, label, color, position in DEFAULT_USER_STATUSES:
            self.session.add(
                LibraryUserStatus(
                    key=key,
                    label=label,
                    color=color,
                    position=position,
                    is_default=True,
                    created_at=now,
                    updated_at=now,
                )
            )
        await self.session.commit()

    async def _next_user_status_position(self) -> int:
        max_position = (
            await self.session.exec(select(func.max(LibraryUserStatus.position)))
        ).one()
        return int(max_position or 0) + 1

    async def _next_collection_position(self) -> int:
        max_position = (
            await self.session.exec(select(func.max(LibraryCollection.position)))
        ).one()
        return int(max_position or 0) + 1

    async def _build_unique_status_key(
        self,
        candidate: str,
        exclude_id: int | None = None,
    ) -> str:
        base = self._slugify_key(candidate)
        key = base
        suffix = 2
        while True:
            stmt = select(LibraryUserStatus).where(LibraryUserStatus.key == key)
            if exclude_id is not None:
                stmt = stmt.where(LibraryUserStatus.id != exclude_id)
            existing = (await self.session.exec(stmt)).first()
            if existing is None:
                return key
            key = f"{base}_{suffix}"
            suffix += 1

    async def _ensure_unique_collection_name(
        self,
        name: str,
        exclude_id: int | None = None,
    ) -> None:
        stmt = select(LibraryCollection).where(
            func.lower(LibraryCollection.name) == name.lower()
        )
        if exclude_id is not None:
            stmt = stmt.where(LibraryCollection.id != exclude_id)
        existing = (await self.session.exec(stmt)).first()
        if existing is not None:
            raise BridgeAPIError(409, "Collection with this name already exists")

    async def _load_user_status_map(
        self,
        titles: list[LibraryTitle],
    ) -> dict[int, LibraryUserStatus]:
        status_ids = sorted(
            {
                int(title.user_status_id)
                for title in titles
                if title.user_status_id is not None
            }
        )
        if not status_ids:
            return {}
        rows = (
            await self.session.exec(
                select(LibraryUserStatus).where(LibraryUserStatus.id.in_(status_ids))
            )
        ).all()
        return {int(status.id): status for status in rows if status.id is not None}

    async def _load_collections_by_title_ids(
        self,
        title_ids: list[int | None],
    ) -> dict[int, list[LibraryCollectionSummary]]:
        ids = [int(item) for item in title_ids if item is not None]
        if not ids:
            return {}
        rows = (
            await self.session.exec(
                select(
                    LibraryCollectionTitle.library_title_id,
                    LibraryCollection.id,
                    LibraryCollection.name,
                    LibraryCollection.color,
                    LibraryCollection.position,
                )
                .join(
                    LibraryCollection,
                    LibraryCollection.id == LibraryCollectionTitle.collection_id,
                )
                .where(LibraryCollectionTitle.library_title_id.in_(ids))
                .order_by(
                    LibraryCollectionTitle.library_title_id,
                    LibraryCollection.position,
                    LibraryCollection.name,
                )
            )
        ).all()

        result: dict[int, list[LibraryCollectionSummary]] = {}
        for title_id, collection_id, name, color, _position in rows:
            mapped = LibraryCollectionSummary(
                id=int(collection_id),
                name=str(name),
                color=str(color),
            )
            bucket = result.setdefault(int(title_id), [])
            bucket.append(mapped)
        return result

    async def _get_user_status(self, status_id: int | None) -> LibraryUserStatus | None:
        if status_id is None:
            return None
        return await self.session.get(LibraryUserStatus, status_id)

    async def _list_title_collection_summaries(
        self,
        title_id: int,
    ) -> list[LibraryCollectionSummary]:
        rows = (
            await self.session.exec(
                select(LibraryCollection)
                .join(
                    LibraryCollectionTitle,
                    LibraryCollectionTitle.collection_id == LibraryCollection.id,
                )
                .where(LibraryCollectionTitle.library_title_id == title_id)
                .order_by(LibraryCollection.position, LibraryCollection.name)
            )
        ).all()
        return [
            LibraryCollectionSummary(
                id=int(collection.id),
                name=collection.name,
                color=collection.color,
            )
            for collection in rows
            if collection.id is not None
        ]

    async def _is_monitoring_enabled(self, title_id: int) -> bool:
        profile = (
            await self.session.exec(
                select(DownloadProfile).where(
                    DownloadProfile.library_title_id == title_id
                )
            )
        ).first()
        return bool(profile.enabled) if profile is not None else False

    async def _profile_variant_ids(self, profile: DownloadProfile | None) -> list[int]:
        if profile is None:
            return []
        if profile.id is not None:
            rows = (
                await self.session.exec(
                    select(DownloadProfileVariant.variant_id)
                    .where(DownloadProfileVariant.profile_id == int(profile.id))
                    .order_by(
                        DownloadProfileVariant.position, DownloadProfileVariant.id
                    )
                )
            ).all()
            normalized = normalize_positive_int_ids(rows)
            if normalized:
                return normalized
        return parse_selected_variant_ids(
            profile.variant_ids_json,
            profile.preferred_variant_id,
        )

    async def _set_profile_variant_ids(
        self,
        profile: DownloadProfile,
        variant_ids: list[int],
    ) -> None:
        unique_ids = LibraryService._normalize_positive_int_ids(variant_ids)
        profile.variant_ids_json = serialize_selected_variant_ids(unique_ids)
        profile.preferred_variant_id = unique_ids[0] if unique_ids else None
        self.session.add(profile)
        await self.session.flush()
        if profile.id is None:
            return

        await self.session.exec(
            delete(DownloadProfileVariant).where(
                DownloadProfileVariant.profile_id == int(profile.id)
            )
        )
        for position, variant_id in enumerate(unique_ids):
            self.session.add(
                DownloadProfileVariant(
                    profile_id=int(profile.id),
                    variant_id=variant_id,
                    position=position,
                    created_at=datetime.now(timezone.utc),
                )
            )

    @staticmethod
    def _normalize_positive_int_ids(values: list[object]) -> list[int]:
        return normalize_positive_int_ids(values)

    async def _normalize_monitoring_variant_ids(
        self,
        title_id: int,
        variant_ids: list[int],
    ) -> list[int]:
        unique_ids = self._normalize_positive_int_ids(variant_ids)
        if not unique_ids:
            return []
        rows = (
            await self.session.exec(
                select(LibraryTitleVariant.id).where(
                    LibraryTitleVariant.library_title_id == title_id,
                    LibraryTitleVariant.id.in_(unique_ids),
                )
            )
        ).all()
        allowed_ids = {int(item) for item in rows}
        return [item for item in unique_ids if item in allowed_ids]

    async def _get_monitoring_variant_ids(
        self,
        title_id: int,
        variants: list[LibraryTitleVariant] | None = None,
    ) -> list[int]:
        profile = (
            await self.session.exec(
                select(DownloadProfile).where(
                    DownloadProfile.library_title_id == title_id
                )
            )
        ).first()
        if profile is None:
            return []
        selected_ids = await self._profile_variant_ids(profile)
        if not selected_ids:
            return []

        allowed_ids = (
            {int(variant.id) for variant in variants if variant.id is not None}
            if variants is not None
            else {
                int(item)
                for item in (
                    await self.session.exec(
                        select(LibraryTitleVariant.id).where(
                            LibraryTitleVariant.library_title_id == title_id
                        )
                    )
                ).all()
            }
        )
        return [item for item in selected_ids if item in allowed_ids]

    async def _get_library_title_or_404(self, title_id: int) -> LibraryTitle:
        title = await self.session.get(LibraryTitle, title_id)
        if title is None:
            raise BridgeAPIError(404, f"Library title not found: {title_id}")
        return title

    @staticmethod
    def _display_title_thumbnail(
        title: LibraryTitle,
        preferred_variant: LibraryTitleVariant | None = None,
    ) -> str:
        local_cover = library_cover_route(title.id, title.local_cover_path)
        if local_cover:
            return local_cover
        if preferred_variant is not None and preferred_variant.thumbnail_url:
            return preferred_variant.thumbnail_url
        return title.thumbnail_url

    async def _get_collection_or_404(self, collection_id: int) -> LibraryCollection:
        collection = await self.session.get(LibraryCollection, collection_id)
        if collection is None:
            raise BridgeAPIError(404, f"Collection not found: {collection_id}")
        return collection

    @staticmethod
    def _slugify_key(value: str) -> str:
        normalized = _normalize(value).replace(" ", "_")
        sanitized = re.sub(r"[^a-z0-9_]+", "", normalized)
        return sanitized or "status"

    @staticmethod
    def _normalize_color(value: str, default: str) -> str:
        candidate = value.strip()
        if re.fullmatch(r"#[0-9a-fA-F]{6}", candidate):
            return candidate.lower()
        if re.fullmatch(r"#[0-9a-fA-F]{3}", candidate):
            return candidate.lower()
        return default

    async def _pin_monitoring_profile_variant_if_missing(
        self,
        profile: DownloadProfile,
        title_id: int,
        fallback_variant_id: int | None,
    ) -> None:
        selected_ids = await self._profile_variant_ids(profile)
        if selected_ids:
            if profile.preferred_variant_id is None:
                profile.preferred_variant_id = selected_ids[0]
            return

        if fallback_variant_id is not None:
            fallback_variant = await self.session.get(
                LibraryTitleVariant, fallback_variant_id
            )
            if (
                fallback_variant is not None
                and fallback_variant.library_title_id == title_id
            ):
                await self._set_profile_variant_ids(profile, [int(fallback_variant.id)])
                return

        title = await self.session.get(LibraryTitle, title_id)
        if title is not None and title.preferred_variant_id is not None:
            preferred_variant = await self.session.get(
                LibraryTitleVariant, int(title.preferred_variant_id)
            )
            if (
                preferred_variant is not None
                and preferred_variant.library_title_id == title_id
            ):
                await self._set_profile_variant_ids(
                    profile, [int(preferred_variant.id)]
                )
                return

        variant_id = (
            await self.session.exec(
                select(LibraryTitleVariant.id)
                .where(LibraryTitleVariant.library_title_id == title_id)
                .order_by(
                    desc(LibraryTitleVariant.last_synced_at), LibraryTitleVariant.id
                )
                .limit(1)
            )
        ).first()
        if variant_id is not None:
            await self._set_profile_variant_ids(profile, [int(variant_id)])

    async def _ensure_local_cover_for_monitoring(self, title_id: int) -> None:
        profile = (
            await self.session.exec(
                select(DownloadProfile).where(
                    DownloadProfile.library_title_id == title_id
                )
            )
        ).first()
        if profile is None or not profile.enabled:
            return

        title = await self.session.get(LibraryTitle, title_id)
        if title is None:
            return

        preferred_variant = await self._resolve_variant(
            title_id=title_id, variant_id=None
        )
        await self._ensure_local_cover(
            title,
            preferred_variant,
            preferred_variant.thumbnail_url or title.thumbnail_url,
        )

    async def _ensure_local_cover(
        self,
        title: LibraryTitle,
        variant: LibraryTitleVariant,
        remote_url: str | None,
    ) -> None:
        if title.id is None:
            return
        if is_downloaded_title_cover_path(title.local_cover_path):
            return
        cover_path = await persist_library_cover(
            remote_url,
            source_name=variant.source_name,
            source_lang=variant.source_lang,
            title_name=variant.title or title.title,
        )
        if not cover_path:
            return
        title.local_cover_path = cover_path
        title.updated_at = datetime.now(timezone.utc)
        self.session.add(title)
        await self._commit_with_sqlite_retry()

    async def _list_enabled_source_summaries(self) -> list[SourceSummary]:
        return await self._list_source_summaries(enabled=True)

    async def _list_source_summaries(
        self,
        enabled: bool | None,
    ) -> list[SourceSummary]:
        rows = await self.extension_service.list_sources(
            installed=True,
            enabled=enabled,
            supports_latest=None,
        )
        return [
            SourceSummary.from_models(extension, source) for extension, source in rows
        ]

    def _pick_source_match_candidate(
        self,
        query_title: str,
        query_author: str | None,
        results: list,
        min_score: float,
        allow_author_only: bool = False,
    ) -> tuple | None:
        best = None
        best_score = 0.0
        for item in results:
            candidate_title = (getattr(item, "title", "") or "").strip()
            candidate_url = (getattr(item, "url", "") or "").strip()
            if not candidate_title or not candidate_url:
                continue

            score = source_match_score(
                query_title=query_title,
                query_author=query_author,
                candidate_title=candidate_title,
                candidate_author=(getattr(item, "author", "") or "").strip(),
            )
            if score < min_score and allow_author_only:
                author_score = author_match_score(
                    query_author=query_author,
                    candidate_author=(getattr(item, "author", "") or "").strip(),
                )
                if author_score < 0.97:
                    continue
                title_only_score = source_match_score(
                    query_title=query_title,
                    query_author=None,
                    candidate_title=candidate_title,
                    candidate_author=None,
                )
                score = max(min_score + 0.001, 0.8 + (0.1 * title_only_score))

            if score < min_score:
                continue
            if score > best_score:
                best = item
                best_score = score

        if best is None:
            return None
        return best, best_score

    @staticmethod
    def _source_match_source_label(source: SourceSummary) -> str:
        source_lang = (source.lang or "").strip()
        lang_segment = f" [{source_lang}]" if source_lang else ""
        return (
            f"{source.extension_name}/{source.name}{lang_segment} "
            f"({source.extension_pkg}:{source.id})"
        )

    @staticmethod
    def _source_match_source_short_label(source: SourceSummary) -> str:
        source_lang = (source.lang or "").strip()
        lang_segment = f" [{source_lang}]" if source_lang else ""
        source_name = (source.name or "").strip() or source.id
        extension_name = (source.extension_name or "").strip()
        if extension_name and extension_name.lower() != source_name.lower():
            return f"{extension_name}/{source_name}{lang_segment}"
        return f"{source_name}{lang_segment}"

    @staticmethod
    def _summarize_source_match_search_error(exc: BridgeAPIError) -> str:
        if exc.status_code == 401:
            return "unauthorized (401)"
        if exc.status_code == 403:
            return "access denied (403)"
        if exc.status_code == 404:
            return "not found (404)"
        if exc.status_code == 429:
            return "rate limited (429)"
        if exc.status_code == 503:
            return "bridge unavailable (503)"
        if exc.status_code == 504:
            return "timeout (504)"

        details = (exc.detail or "").strip()
        if details:
            compact = details
            compact = re.sub(
                r"^search_titles source_id=\d+ failed \([A-Z_]+\):\s*",
                "",
                compact,
                flags=re.IGNORECASE,
            )
            compact = re.sub(
                r"^search_title failed:\s*",
                "",
                compact,
                flags=re.IGNORECASE,
            )
            if len(compact) > 96:
                return f"{compact[:93]}..."
            return compact
        return f"HTTP {exc.status_code}"

    async def _auto_link_same_extension_variants(
        self,
        title_id: int,
        source_id: str,
        title_url: str,
    ) -> None:
        source = await self.session.get(Source, source_id)
        if source is None:
            return

        source_rows = (
            await self.session.exec(
                select(Source.id).where(
                    Source.extension_pkg == source.extension_pkg,
                    Source.enabled == True,  # noqa: E712
                )
            )
        ).all()
        sibling_source_ids = [str(item) for item in source_rows if item is not None]
        if not sibling_source_ids:
            return

        linked_source_rows = (
            await self.session.exec(
                select(LibraryTitleVariant.source_id).where(
                    LibraryTitleVariant.library_title_id == title_id
                )
            )
        ).all()
        linked_source_ids = {
            str(item) for item in linked_source_rows if item is not None
        }

        for sibling_source_id in sibling_source_ids:
            if sibling_source_id in linked_source_ids:
                continue
            try:
                await self.link_variant(
                    title_id=title_id,
                    source_id=sibling_source_id,
                    title_url=title_url,
                )
            except BridgeAPIError:
                continue

    async def _find_same_extension_library_title_id(
        self,
        source_id: str,
        title_url: str,
    ) -> int | None:
        source = await self.session.get(Source, source_id)
        if source is None:
            return None

        sibling_source_id_rows = (
            await self.session.exec(
                select(Source.id).where(Source.extension_pkg == source.extension_pkg)
            )
        ).all()
        sibling_source_ids = [
            str(item) for item in sibling_source_id_rows if item is not None
        ]
        if not sibling_source_ids:
            return None

        existing = (
            await self.session.exec(
                select(LibraryTitleVariant.library_title_id)
                .where(
                    LibraryTitleVariant.source_id.in_(sibling_source_ids),
                    LibraryTitleVariant.title_url == title_url,
                )
                .order_by(
                    desc(LibraryTitleVariant.last_synced_at), LibraryTitleVariant.id
                )
                .limit(1)
            )
        ).first()
        return int(existing) if existing is not None else None

    async def _find_or_create_library_title(
        self, key: str, fallback_title: str
    ) -> LibraryTitle:
        title = (
            await self.session.exec(
                select(LibraryTitle).where(LibraryTitle.canonical_key == key)
            )
        ).first()
        if title is not None:
            return title

        # Handle sources that inconsistently provide author:
        # if an author-qualified key is missing, reuse title-only key.
        if "|" in key:
            title_only_key = key.split("|", 1)[0].strip()
            if title_only_key:
                title = (
                    await self.session.exec(
                        select(LibraryTitle).where(
                            LibraryTitle.canonical_key == title_only_key
                        )
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

        title = await self.session.get(LibraryTitle, title_id)
        if title is not None and title.preferred_variant_id is not None:
            preferred_variant = await self.session.get(
                LibraryTitleVariant, int(title.preferred_variant_id)
            )
            if (
                preferred_variant is not None
                and preferred_variant.library_title_id == title_id
            ):
                return preferred_variant

        variant = (
            await self.session.exec(
                select(LibraryTitleVariant)
                .where(LibraryTitleVariant.library_title_id == title_id)
                .order_by(
                    desc(LibraryTitleVariant.last_synced_at), LibraryTitleVariant.id
                )
                .limit(1)
            )
        ).first()
        if variant is None:
            raise BridgeAPIError(
                404, f"Library title has no source variants: {title_id}"
            )
        return variant

    async def _refresh_variant(
        self, title: LibraryTitle, variant: LibraryTitleVariant
    ) -> None:
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
                delete(LibraryChapterPage).where(
                    LibraryChapterPage.chapter_id.in_(stale_ids)
                )
            )
            await self.session.exec(
                delete(LibraryChapter).where(LibraryChapter.id.in_(stale_ids))
            )

    @staticmethod
    def _sync_title_snapshot(
        library_title: LibraryTitle, details, now: datetime
    ) -> None:
        library_title.title = details.title or library_title.title
        library_title.thumbnail_url = (
            details.thumbnail_url or library_title.thumbnail_url
        )
        library_title.description = details.description or library_title.description
        library_title.artist = details.artist or library_title.artist
        library_title.author = details.author or library_title.author
        library_title.genre = details.genre or library_title.genre
        library_title.status = _status_value(details.status)
        library_title.updated_at = now
        library_title.last_refreshed_at = now

    @staticmethod
    def _to_user_status_resource(
        status: LibraryUserStatus | None,
    ) -> LibraryUserStatusResource | None:
        if status is None or status.id is None:
            return None
        return LibraryUserStatusResource(
            id=int(status.id),
            key=status.key,
            label=status.label,
            color=status.color,
            position=status.position,
            is_default=status.is_default,
        )

    async def _build_variant_availability(
        self,
        title_id: int,
        variants: list[LibraryTitleVariant],
    ) -> dict[int, LibraryVariantAvailabilityResource]:
        variant_ids = [
            int(variant.id) for variant in variants if variant.id is not None
        ]
        if not variant_ids:
            return {}

        rows = (
            await self.session.exec(
                select(
                    LibraryChapter.variant_id,
                    LibraryChapter.chapter_number,
                ).where(
                    LibraryChapter.library_title_id == title_id,
                    LibraryChapter.variant_id.in_(variant_ids),
                )
            )
        ).all()

        chapter_count_by_variant = {variant_id: 0 for variant_id in variant_ids}
        chapter_numbers_by_variant: dict[int, list[float]] = {
            variant_id: [] for variant_id in variant_ids
        }

        for variant_id, chapter_number in rows:
            normalized_variant_id = int(variant_id)
            chapter_count_by_variant[normalized_variant_id] = (
                chapter_count_by_variant.get(normalized_variant_id, 0) + 1
            )
            number = float(chapter_number or 0.0)
            if number > 0.0:
                chapter_numbers_by_variant.setdefault(normalized_variant_id, []).append(
                    number
                )

        highest_by_variant = {
            variant_id: (max(numbers) if numbers else None)
            for variant_id, numbers in chapter_numbers_by_variant.items()
        }
        global_highest = max(
            (value for value in highest_by_variant.values() if value is not None),
            default=None,
        )

        availability_by_variant: dict[int, LibraryVariantAvailabilityResource] = {}
        for variant_id in variant_ids:
            chapter_count = chapter_count_by_variant.get(variant_id, 0)
            unique_numbers = sorted(set(chapter_numbers_by_variant.get(variant_id, [])))

            first_number = unique_numbers[0] if unique_numbers else None
            last_number = unique_numbers[-1] if unique_numbers else None
            starts_from_chapter_one = first_number is not None and first_number <= 1.05
            has_major_gaps = any(
                (next_number - current_number) > 1.25
                for current_number, next_number in zip(
                    unique_numbers, unique_numbers[1:]
                )
            )

            if chapter_count == 0:
                state = "unknown"
            elif not unique_numbers:
                state = "partial"
            elif not starts_from_chapter_one or has_major_gaps:
                state = "partial"
            elif (
                global_highest is not None
                and last_number is not None
                and (last_number + 0.05) < global_highest
            ):
                state = "behind"
            else:
                state = "full"

            availability_by_variant[variant_id] = LibraryVariantAvailabilityResource(
                state=state,
                chapter_count=chapter_count,
                starts_from_chapter_one=starts_from_chapter_one,
                has_major_gaps=has_major_gaps,
                first_chapter_number=first_number,
                last_chapter_number=last_number,
                global_last_chapter_number=global_highest,
            )

        return availability_by_variant

    @staticmethod
    def _to_variant_resource(
        variant: LibraryTitleVariant,
        availability: LibraryVariantAvailabilityResource | None = None,
    ) -> LibraryTitleVariantResource:
        return LibraryTitleVariantResource(
            id=int(variant.id),
            source_id=variant.source_id,
            source_name=variant.source_name,
            source_lang=variant.source_lang,
            title_url=variant.title_url,
            title=variant.title,
            thumbnail_url=variant.thumbnail_url,
            description=variant.description,
            artist=variant.artist,
            author=variant.author,
            genre=variant.genre,
            status=variant.status,
            availability=availability,
        )

    @staticmethod
    def _local_page_url(local_path: str | None) -> str | None:
        if not local_path:
            return None
        roots = [
            settings.downloads.root_dir,
            settings.app.data_dir / "downloads",
            settings.app.config_dir / "downloads",
        ]
        for root in roots:
            resolved_root = root.resolve()
            candidate = (resolved_root / local_path).resolve()
            try:
                candidate.relative_to(resolved_root)
            except ValueError:
                continue
            if candidate.is_file():
                return f"/api/v2/library/files/{quote(local_path, safe='/')}"
        return None

    @staticmethod
    def _resolve_remote_page_url(
        image_url: str | None,
        page_url: str | None,
        chapter_url: str | None = None,
    ) -> str:
        image_candidate = (image_url or "").strip()
        page_candidate = (page_url or "").strip()
        chapter_candidate = (chapter_url or "").strip()
        if not image_candidate:
            parsed_page = LibraryService._sanitize_comma_encoded_url(page_candidate)
            if parsed_page:
                return parsed_page
            return page_candidate or chapter_candidate

        parsed_image = LibraryService._sanitize_comma_encoded_url(image_candidate)
        if parsed_image:
            return parsed_image

        parsed = urlparse(image_candidate)
        if parsed.scheme or image_candidate.startswith("//"):
            return image_candidate

        page_base = LibraryService._extract_base_url(page_candidate)
        if page_base:
            return urljoin(page_base, image_candidate)

        chapter_base = LibraryService._extract_base_url(chapter_candidate)
        if chapter_base:
            return urljoin(chapter_base, image_candidate)

        return image_candidate

    async def _resolve_source_image_base_url(self, source_id: str | None) -> str | None:
        if not source_id:
            return None

        try:
            prefs = await self.extension_service.list_source_preferences(source_id)
        except Exception:
            return None

        pref_by_key = {pref.key: pref.current_value for pref in prefs.preferences}
        site_id = self._infer_mangalib_site_id(
            source_name=prefs.name,
            preferences=prefs.preferences,
        )
        bases = self._extract_url_preference_bases(prefs.preferences)
        selected_base = bases[0] if bases else None
        if "MangaLibImageServer" in pref_by_key:
            image_server = str(
                pref_by_key.get("MangaLibImageServer") or "compress"
            ).strip()
            if not image_server:
                image_server = "compress"
            api_domain = str(
                pref_by_key.get("MangaLibApiDomain") or "https://api.cdnlibs.org"
            ).strip()
            if not api_domain:
                api_domain = "https://api.cdnlibs.org"
            mangalib = await self._fetch_mangalib_image_server_url(
                api_domain=api_domain,
                image_server=image_server,
                site_id=site_id,
            )
            if mangalib:
                selected_base = mangalib

        if not selected_base:
            return None
        return selected_base.strip().rstrip("/") or None

    async def _preflight_mangalib_chapter_pages_unavailable(
        self,
        source_id: str | None,
        chapter_url: str | None,
    ) -> str | None:
        if not source_id or not chapter_url:
            return None

        try:
            prefs = await self.extension_service.list_source_preferences(source_id)
        except Exception:
            return None

        pref_by_key = {pref.key: pref.current_value for pref in prefs.preferences}
        if (
            "MangaLibApiDomain" not in pref_by_key
            and "MangaLibImageServer" not in pref_by_key
        ):
            return None

        api_domain = str(
            pref_by_key.get("MangaLibApiDomain") or "https://api.cdnlibs.org"
        ).strip()
        if not api_domain:
            api_domain = "https://api.cdnlibs.org"
        endpoint = f"{api_domain.rstrip('/')}/api/manga{chapter_url}"

        try:
            timeout = httpx.Timeout(15.0)
            async with httpx.AsyncClient(
                timeout=timeout, follow_redirects=True
            ) as client:
                response = await client.get(endpoint)
                response.raise_for_status()
        except Exception:
            return None

        payload = response.json()
        data = payload.get("data")
        if not isinstance(data, dict):
            return None

        pages = data.get("pages")
        if isinstance(pages, list) and pages:
            return None

        expired_at = str(data.get("expired_at") or "").strip()
        expired_type = data.get("expired_type")
        if expired_at:
            return f"Chapter pages are unavailable in MangaLib API (locked until {expired_at})"
        if expired_type == 1:
            return (
                "Chapter pages are unavailable in MangaLib API (chapter is time-locked)"
            )
        return "Chapter pages are unavailable in MangaLib API"

    async def _normalize_mangalib_pages_error(
        self,
        source_id: str | None,
        chapter_url: str | None,
        error_text: str | None,
    ) -> str | None:
        source_key = (source_id or "").lower()
        if "mangalib" not in source_key:
            return None

        text = (error_text or "").lower()
        looks_like_unavailable = (
            "missingfieldexception" in text
            or "libgroup.pages" in text
            or "path: $.data" in text
            or "fetch_chapter_pages failed (unknown)" in text
        )
        if not looks_like_unavailable:
            return None

        preflight_error = await self._preflight_mangalib_chapter_pages_unavailable(
            source_id=source_id,
            chapter_url=chapter_url,
        )
        return preflight_error or "Chapter pages are unavailable in MangaLib API"

    @staticmethod
    async def _fetch_mangalib_image_server_url(
        *,
        api_domain: str,
        image_server: str,
        site_id: int | None = None,
    ) -> str | None:
        api_base = api_domain.rstrip("/")
        constants_url = f"{api_base}/api/constants"
        try:
            timeout = httpx.Timeout(10.0)
            async with httpx.AsyncClient(
                timeout=timeout, follow_redirects=True
            ) as client:
                response = await client.get(
                    constants_url,
                    params=[("fields[]", "imageServers")],
                )
                response.raise_for_status()
        except Exception:
            return None

        payload = response.json()
        servers = payload.get("data", {}).get("imageServers", [])
        if not isinstance(servers, list):
            return None

        normalized_server = image_server.strip().lower()
        fallback_match: str | None = None
        for entry in servers:
            if not isinstance(entry, dict):
                continue
            raw_url = str(entry.get("url") or "").strip()
            if not raw_url:
                continue
            parsed = urlparse(raw_url)
            if not (parsed.scheme and parsed.netloc):
                continue
            entry_id = str(entry.get("id") or "").strip().lower()
            if entry_id != normalized_server:
                continue

            resolved_base = f"{parsed.scheme}://{parsed.netloc}"
            site_ids = entry.get("site_ids")
            if (
                site_id is not None
                and isinstance(site_ids, list)
                and any(
                    str(item).strip().isdigit() and int(str(item).strip()) == site_id
                    for item in site_ids
                    if isinstance(item, int | str)
                )
            ):
                return resolved_base
            if fallback_match is None:
                fallback_match = resolved_base
        return fallback_match

    @staticmethod
    def _infer_mangalib_site_id(
        source_name: str | None,
        preferences: list[SourcePreference],
    ) -> int | None:
        name = (source_name or "").strip().lower()
        if "hentai" in name:
            return 4
        if "yaoi" in name:
            return 3
        if "manga" in name:
            return 1

        domain_value = ""
        for pref in preferences:
            key = (pref.key or "").strip().lower()
            if key == "домен":
                domain_value = (
                    str(pref.current_value or pref.default_value or "").strip().lower()
                )
                break

        if "hentai" in domain_value:
            return 4
        if "slashlib" in domain_value or "yaoi" in domain_value:
            return 3
        if "mangalib" in domain_value:
            return 1
        return None

    @staticmethod
    def _extract_url_preference_bases(preferences: list[SourcePreference]) -> list[str]:
        bases: list[str] = []
        seen: set[str] = set()

        def push(value: object | None) -> None:
            if value is None:
                return
            if isinstance(value, list | tuple | set):
                for item in value:
                    push(item)
                return

            candidate = str(value).strip()
            parsed = urlparse(candidate)
            if not (parsed.scheme and parsed.netloc):
                return
            base = f"{parsed.scheme}://{parsed.netloc}"
            if base in seen:
                return
            seen.add(base)
            bases.append(base)

        for pref in preferences:
            push(pref.current_value)
            push(pref.default_value)

            selected_indexes: list[int] = []
            if pref.entry_values:
                if isinstance(pref.current_value, list):
                    selected_values = {str(value) for value in pref.current_value}
                    for idx, entry_value in enumerate(pref.entry_values):
                        if str(entry_value) in selected_values:
                            selected_indexes.append(idx)
                else:
                    selected_value = str(pref.current_value or "")
                    for idx, entry_value in enumerate(pref.entry_values):
                        if str(entry_value) == selected_value:
                            selected_indexes.append(idx)
            elif isinstance(pref.current_value, int | float):
                selected_indexes.append(int(pref.current_value))

            for idx in selected_indexes:
                if pref.entry_values and 0 <= idx < len(pref.entry_values):
                    push(pref.entry_values[idx])
                if pref.entries and 0 <= idx < len(pref.entries):
                    push(pref.entries[idx])

        return bases

    @staticmethod
    def _resolve_source_relative_url(
        remote_url: str,
        source_url_base: str | None,
    ) -> str:
        if not remote_url or not source_url_base:
            return remote_url

        if remote_url.startswith("//"):
            parsed = urlparse(f"https:{remote_url}")
            host = parsed.netloc.strip().lower()
            if host and ("." in host or ":" in host):
                return remote_url
            return urljoin(
                source_url_base.rstrip("/") + "/",
                "/" + remote_url.lstrip("/"),
            )
        if remote_url.startswith("/"):
            return urljoin(source_url_base.rstrip("/") + "/", remote_url)
        return remote_url

    @staticmethod
    def _prefer_source_page_image_path(
        remote_url: str,
        page_url: str | None,
        source_url_base: str | None,
    ) -> str:
        if not source_url_base:
            return remote_url

        candidate = (
            LibraryService._sanitize_comma_encoded_url((page_url or "").strip())
            or (page_url or "").strip()
        )
        if not candidate:
            return remote_url

        parsed_remote = urlparse(remote_url)
        remote_is_absolute = bool(parsed_remote.scheme and parsed_remote.netloc)
        if remote_is_absolute and (
            candidate.startswith("/") or candidate.startswith("//")
        ):
            return remote_url

        parsed = urlparse(
            f"https:{candidate}" if candidate.startswith("//") else candidate
        )
        path = (parsed.path or "").lower()
        if path and any(path.endswith(suffix) for suffix in _IMAGE_SUFFIXES):
            return candidate
        return remote_url

    @staticmethod
    def _sanitize_comma_encoded_url(value: str) -> str | None:
        candidate = value.strip()
        if not candidate or "," not in candidate:
            return None

        parts = [part.strip() for part in candidate.split(",") if part.strip()]
        if not parts:
            return None

        absolute_parts: list[str] = []
        path_parts: list[str] = []
        for part in parts:
            parsed_part = urlparse(part)
            if parsed_part.scheme and parsed_part.netloc:
                absolute_parts.append(part)
                continue
            if parsed_part.scheme and parsed_part.path:
                path_parts.append(f"/{parsed_part.path.lstrip('/')}")
                continue
            if not parsed_part.scheme:
                normalized_part = part
                if normalized_part.startswith("https/") or normalized_part.startswith(
                    "http/"
                ):
                    normalized_part = (
                        normalized_part.split("/", 1)[1]
                        if "/" in normalized_part
                        else ""
                    )
                path_parts.append(
                    normalized_part
                    if normalized_part.startswith("/")
                    else f"/{normalized_part.lstrip('/')}"
                )

        if len(absolute_parts) >= 2:
            return absolute_parts[-1]

        base = LibraryService._extract_base_url(candidate)
        if not base:
            return absolute_parts[0] if absolute_parts else None

        if path_parts:
            parsed_base = urlparse(base)
            base_origin = (
                f"{parsed_base.scheme}://{parsed_base.netloc}"
                if parsed_base.scheme and parsed_base.netloc
                else base
            )
            return urljoin(base_origin, path_parts[-1])

        return base

    @staticmethod
    def _extract_base_url(value: str) -> str | None:
        candidate = value.strip()
        if not candidate:
            return None

        # Some sources encode extra metadata into page URLs via comma-separated values.
        # Example: "https://cdn.host,https://api.host/...,timestamp"
        for piece in [part.strip() for part in candidate.split(",") if part.strip()]:
            parsed_piece = urlparse(piece)
            if parsed_piece.scheme and parsed_piece.netloc:
                return urljoin(
                    f"{parsed_piece.scheme}://{parsed_piece.netloc}",
                    parsed_piece.path or "/",
                )

        parsed = urlparse(candidate)
        if parsed.scheme and parsed.netloc:
            host = parsed.netloc.split(",", 1)[0].strip()
            if host:
                return urljoin(f"{parsed.scheme}://{host}", parsed.path or "/")

        return None
