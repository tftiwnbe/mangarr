from app.config import settings
from fastapi import APIRouter

from app.bridge import tachibridge

router = APIRouter(prefix="/api/v2/health", tags=["health"])


@router.get("", summary="Health check")
async def health_check() -> dict[str, str | int]:
    """Simple health check endpoint suitable for readiness probes."""
    bridge_status = "ok" if await tachibridge.is_healthy() else "unavailable"
    return {
        "status": "ok",
        "bridge": bridge_status,
        "bridge_port": settings.tachibridge.port,
    }
