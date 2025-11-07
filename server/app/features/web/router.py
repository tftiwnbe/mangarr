from fastapi import APIRouter

from app.config import settings
from fastapi.responses import FileResponse, JSONResponse
from fastapi.staticfiles import StaticFiles
from fastapi import HTTPException, Response

static_root = settings.app.static_root
index_file = static_root / "index.html"

router = APIRouter()

assets_dir = static_root / "_app"
router.mount(
    "/_app",
    StaticFiles(directory=assets_dir, check_dir=False),
    name="frontend-assets",
)


@router.get("/", include_in_schema=False, response_model=None)
async def serve_index() -> Response:
    """Serve the frontend single-page application entry point."""
    if index_file.exists():
        return FileResponse(index_file)
    return JSONResponse({"message": "Mangarr API"})


@router.get("/{full_path:path}", include_in_schema=False)
async def serve_spa(full_path: str):
    """Serve static assets or fall back to the SPA entry point for client-side routing."""
    candidate = (static_root / full_path).resolve()
    try:
        candidate.relative_to(static_root)
    except ValueError:
        candidate = None
    if candidate and candidate.is_file():
        return FileResponse(candidate)
    if index_file.exists():
        return FileResponse(index_file)
    raise HTTPException(status_code=404, detail="Not found")
