from fastapi import APIRouter

router = APIRouter(prefix="/api/v2/health", tags=["auth"])


@router.get("", summary="Health check")
async def health_check() -> dict[str, str]:
    """Simple health check endpoint suitable for readiness probes."""
    return {"status": "ok"}
