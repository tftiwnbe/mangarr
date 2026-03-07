from app.config import settings
from fastapi import APIRouter

from app.bridge.metrics import bridge_page_metrics
from app.bridge import tachibridge

router = APIRouter(prefix="/api/v2/health", tags=["health"])


@router.get("", summary="Health check")
async def health_check() -> dict[str, str | int | dict[str, int | str | None]]:
    """Simple health check endpoint suitable for readiness probes."""
    bridge_status = "ok" if await tachibridge.is_healthy(timeout=1.0) else "unavailable"
    metrics_snapshot = bridge_page_metrics.snapshot()
    return {
        "status": "ok",
        "bridge": bridge_status,
        "bridge_port": settings.tachibridge.port,
        "bridge_page_metrics": {
            "page_fetch_attempts": metrics_snapshot.page_fetch_attempts,
            "page_fetch_not_found": metrics_snapshot.page_fetch_not_found,
            "page_fetch_recovery_attempts": metrics_snapshot.page_fetch_recovery_attempts,
            "page_fetch_recovered": metrics_snapshot.page_fetch_recovered,
            "page_fetch_recovery_failed": metrics_snapshot.page_fetch_recovery_failed,
            "last_recovery_at": metrics_snapshot.last_recovery_at,
        },
    }
