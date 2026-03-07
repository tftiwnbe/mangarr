from mimetypes import guess_type

from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.responses import FileResponse, Response

from app.config import settings
from app.core.deps import DBSessionDep, require_authenticated_user
from app.features.downloads.storage import (
    read_chapter_archive_member,
    split_archive_member_virtual_path,
)
from app.features.library.service import LibraryService
from app.models import (
    LibraryCollectionCreate,
    LibraryCollectionResource,
    LibraryCollectionUpdate,
    LibraryChapterPageResource,
    LibraryChapterCommentCreate,
    LibraryChapterCommentResource,
    LibraryChapterCommentUpdate,
    LibraryChapterProgressResource,
    LibraryChapterProgressUpdate,
    LibraryChapterResource,
    LibraryImportRequest,
    LibraryImportResponse,
    LibraryLinkVariantRequest,
    LibraryLinkVariantResponse,
    LibraryMergeTitlesRequest,
    LibraryMergeTitlesResponse,
    LibraryReaderChapterResource,
    LibrarySourceMatchResource,
    LibraryTitlePreferencesUpdate,
    LibraryTitleResource,
    LibraryTitleSummary,
    LibraryUserStatusCreate,
    LibraryUserStatusResource,
    LibraryUserStatusUpdate,
)

router = APIRouter(
    prefix="/api/v2/library",
    tags=["library"],
    dependencies=[Depends(require_authenticated_user)],
)


async def get_service(db: DBSessionDep) -> LibraryService:
    return LibraryService(db)


@router.get("/titles", response_model=list[LibraryTitleSummary])
async def list_library_titles(
    offset: int = Query(0, ge=0),
    limit: int = Query(20, ge=1, le=100),
    assigned_only: bool = Query(
        True,
        description="Return only titles with an assigned user status",
    ),
    service: LibraryService = Depends(get_service),
):
    return await service.list_titles(
        offset=offset,
        limit=limit,
        assigned_only=assigned_only,
    )


@router.get("/titles/{title_id}", response_model=LibraryTitleResource)
async def get_library_title(
    title_id: int,
    service: LibraryService = Depends(get_service),
):
    return await service.get_title(title_id)


@router.patch("/titles/{title_id}/preferences", response_model=LibraryTitleResource)
async def update_library_title_preferences(
    title_id: int,
    payload: LibraryTitlePreferencesUpdate,
    service: LibraryService = Depends(get_service),
):
    return await service.update_title_preferences(title_id=title_id, payload=payload)


@router.post("/import", response_model=LibraryImportResponse, status_code=201)
async def import_library_title(
    request: LibraryImportRequest,
    service: LibraryService = Depends(get_service),
):
    return await service.import_title(request)


@router.get(
    "/titles/{title_id}/source-matches",
    response_model=list[LibrarySourceMatchResource],
)
async def list_library_title_source_matches(
    title_id: int,
    lang: str | None = Query(None, min_length=2, max_length=12),
    limit_sources: int = Query(24, ge=1, le=50),
    min_score: float = Query(0.84, ge=0.0, le=1.0),
    service: LibraryService = Depends(get_service),
):
    return await service.list_source_matches(
        title_id=title_id,
        lang=lang,
        limit_sources=limit_sources,
        min_score=min_score,
    )


@router.post(
    "/titles/{title_id}/variants/link",
    response_model=LibraryLinkVariantResponse,
    status_code=201,
)
async def link_library_title_variant(
    title_id: int,
    payload: LibraryLinkVariantRequest,
    service: LibraryService = Depends(get_service),
):
    return await service.link_variant(
        title_id=title_id,
        source_id=payload.source_id,
        title_url=payload.title_url,
    )


@router.post(
    "/titles/{title_id}/merge",
    response_model=LibraryMergeTitlesResponse,
)
async def merge_library_titles(
    title_id: int,
    payload: LibraryMergeTitlesRequest,
    service: LibraryService = Depends(get_service),
):
    return await service.merge_titles(
        target_title_id=title_id,
        source_title_id=payload.source_title_id,
    )


@router.get("/statuses", response_model=list[LibraryUserStatusResource])
async def list_library_statuses(
    service: LibraryService = Depends(get_service),
):
    return await service.list_user_statuses()


@router.post("/statuses", response_model=LibraryUserStatusResource, status_code=201)
async def create_library_status(
    payload: LibraryUserStatusCreate,
    service: LibraryService = Depends(get_service),
):
    return await service.create_user_status(payload)


@router.put("/statuses/{status_id}", response_model=LibraryUserStatusResource)
async def update_library_status(
    status_id: int,
    payload: LibraryUserStatusUpdate,
    service: LibraryService = Depends(get_service),
):
    return await service.update_user_status(status_id=status_id, payload=payload)


@router.delete("/statuses/{status_id}", status_code=204)
async def delete_library_status(
    status_id: int,
    service: LibraryService = Depends(get_service),
):
    await service.delete_user_status(status_id=status_id)


@router.get("/collections", response_model=list[LibraryCollectionResource])
async def list_library_collections(
    service: LibraryService = Depends(get_service),
):
    return await service.list_collections()


@router.post("/collections", response_model=LibraryCollectionResource, status_code=201)
async def create_library_collection(
    payload: LibraryCollectionCreate,
    service: LibraryService = Depends(get_service),
):
    return await service.create_collection(payload)


@router.put("/collections/{collection_id}", response_model=LibraryCollectionResource)
async def update_library_collection(
    collection_id: int,
    payload: LibraryCollectionUpdate,
    service: LibraryService = Depends(get_service),
):
    return await service.update_collection(collection_id=collection_id, payload=payload)


@router.delete("/collections/{collection_id}", status_code=204)
async def delete_library_collection(
    collection_id: int,
    service: LibraryService = Depends(get_service),
):
    await service.delete_collection(collection_id=collection_id)


@router.post("/collections/{collection_id}/titles/{title_id}", status_code=204)
async def add_library_title_to_collection(
    collection_id: int,
    title_id: int,
    service: LibraryService = Depends(get_service),
):
    await service.add_title_to_collection(collection_id=collection_id, title_id=title_id)


@router.delete("/collections/{collection_id}/titles/{title_id}", status_code=204)
async def remove_library_title_from_collection(
    collection_id: int,
    title_id: int,
    service: LibraryService = Depends(get_service),
):
    await service.remove_title_from_collection(collection_id=collection_id, title_id=title_id)


@router.get("/titles/{title_id}/chapters", response_model=list[LibraryChapterResource])
async def list_library_title_chapters(
    title_id: int,
    variant_id: int | None = Query(None),
    refresh: bool = Query(False),
    service: LibraryService = Depends(get_service),
):
    return await service.list_chapters(
        title_id=title_id,
        variant_id=variant_id,
        refresh=refresh,
    )


@router.get(
    "/chapters/{chapter_id}/pages",
    response_model=list[LibraryChapterPageResource],
)
async def get_library_chapter_pages(
    chapter_id: int,
    refresh: bool = Query(False),
    service: LibraryService = Depends(get_service),
):
    return await service.get_chapter_pages(chapter_id=chapter_id, refresh=refresh)


@router.get(
    "/chapters/{chapter_id}/reader",
    response_model=LibraryReaderChapterResource,
)
async def get_library_chapter_reader(
    chapter_id: int,
    refresh: bool = Query(False),
    service: LibraryService = Depends(get_service),
):
    return await service.get_chapter_reader(chapter_id=chapter_id, refresh=refresh)


@router.get(
    "/titles/{title_id}/chapter-progress",
    response_model=list[LibraryChapterProgressResource],
)
async def list_library_title_chapter_progress(
    title_id: int,
    variant_id: int | None = Query(None),
    service: LibraryService = Depends(get_service),
):
    return await service.list_title_chapter_progress(title_id=title_id, variant_id=variant_id)


@router.get(
    "/chapters/{chapter_id}/progress",
    response_model=LibraryChapterProgressResource,
)
async def get_library_chapter_progress(
    chapter_id: int,
    service: LibraryService = Depends(get_service),
):
    return await service.get_chapter_progress(chapter_id=chapter_id)


@router.patch(
    "/chapters/{chapter_id}/progress",
    response_model=LibraryChapterProgressResource,
)
async def update_library_chapter_progress(
    chapter_id: int,
    payload: LibraryChapterProgressUpdate,
    service: LibraryService = Depends(get_service),
):
    return await service.update_chapter_progress(chapter_id=chapter_id, payload=payload)


@router.delete("/chapters/{chapter_id}/progress", status_code=204)
async def reset_library_chapter_progress(
    chapter_id: int,
    service: LibraryService = Depends(get_service),
):
    await service.reset_chapter_progress(chapter_id=chapter_id)


@router.delete("/titles/{title_id}/chapter-progress", status_code=204)
async def reset_library_title_progress(
    title_id: int,
    service: LibraryService = Depends(get_service),
):
    await service.reset_title_progress(title_id=title_id)


@router.get(
    "/titles/{title_id}/comments",
    response_model=list[LibraryChapterCommentResource],
)
async def list_library_title_comments(
    title_id: int,
    variant_id: int | None = Query(None),
    newest_first: bool = Query(True),
    service: LibraryService = Depends(get_service),
):
    return await service.list_title_comments(
        title_id=title_id,
        variant_id=variant_id,
        newest_first=newest_first,
    )


@router.get(
    "/chapters/{chapter_id}/comments",
    response_model=list[LibraryChapterCommentResource],
)
async def list_library_chapter_comments(
    chapter_id: int,
    newest_first: bool = Query(True),
    service: LibraryService = Depends(get_service),
):
    return await service.list_chapter_comments(chapter_id=chapter_id, newest_first=newest_first)


@router.post(
    "/chapters/{chapter_id}/comments",
    response_model=LibraryChapterCommentResource,
    status_code=201,
)
async def create_library_chapter_comment(
    chapter_id: int,
    payload: LibraryChapterCommentCreate,
    service: LibraryService = Depends(get_service),
):
    return await service.create_chapter_comment(chapter_id=chapter_id, payload=payload)


@router.put(
    "/chapter-comments/{comment_id}",
    response_model=LibraryChapterCommentResource,
)
async def update_library_chapter_comment(
    comment_id: int,
    payload: LibraryChapterCommentUpdate,
    service: LibraryService = Depends(get_service),
):
    return await service.update_chapter_comment(comment_id=comment_id, payload=payload)


@router.delete("/chapter-comments/{comment_id}", status_code=204)
async def delete_library_chapter_comment(
    comment_id: int,
    service: LibraryService = Depends(get_service),
):
    await service.delete_chapter_comment(comment_id=comment_id)


@router.get("/files/{file_path:path}", include_in_schema=False)
async def get_library_downloaded_file(file_path: str):
    archive_member_path = split_archive_member_virtual_path(file_path)
    roots = [
        settings.downloads.root_dir,
        settings.app.data_dir / "downloads",
        settings.app.config_dir / "downloads",
    ]
    for root in roots:
        resolved_root = root.resolve()
        candidate_path = archive_member_path[0] if archive_member_path is not None else file_path
        candidate = (resolved_root / candidate_path).resolve()
        try:
            candidate.relative_to(resolved_root)
        except ValueError:
            continue
        if archive_member_path is not None:
            archive_bytes = read_chapter_archive_member(candidate, archive_member_path[1])
            if archive_bytes is None:
                continue
            media_type = guess_type(archive_member_path[1])[0] or "application/octet-stream"
            return Response(content=archive_bytes, media_type=media_type)
        if candidate.is_file():
            return FileResponse(candidate)
    raise HTTPException(status_code=404, detail="File not found")
