from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.responses import FileResponse

from app.config import settings
from app.core.deps import DBSessionDep
from app.features.library.service import LibraryService
from app.models import (
    LibraryChapterPageResource,
    LibraryChapterResource,
    LibraryImportRequest,
    LibraryImportResponse,
    LibraryReaderChapterResource,
    LibraryTitleResource,
    LibraryTitleSummary,
)

router = APIRouter(prefix="/api/v2/library", tags=["library"])


async def get_service(db: DBSessionDep) -> LibraryService:
    return LibraryService(db)


@router.get("/titles", response_model=list[LibraryTitleSummary])
async def list_library_titles(
    offset: int = Query(0, ge=0),
    limit: int = Query(20, ge=1, le=100),
    service: LibraryService = Depends(get_service),
):
    return await service.list_titles(offset=offset, limit=limit)


@router.get("/titles/{title_id}", response_model=LibraryTitleResource)
async def get_library_title(
    title_id: int,
    service: LibraryService = Depends(get_service),
):
    return await service.get_title(title_id)


@router.post("/import", response_model=LibraryImportResponse, status_code=201)
async def import_library_title(
    request: LibraryImportRequest,
    service: LibraryService = Depends(get_service),
):
    return await service.import_title(request)


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


@router.get("/files/{file_path:path}", include_in_schema=False)
async def get_library_downloaded_file(file_path: str):
    root = settings.downloads.root_dir.resolve()
    candidate = (root / file_path).resolve()
    try:
        candidate.relative_to(root)
    except ValueError as exc:
        raise HTTPException(status_code=404, detail="File not found") from exc
    if not candidate.is_file():
        raise HTTPException(status_code=404, detail="File not found")
    return FileResponse(candidate)
