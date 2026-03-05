import asyncio
import random
from contextlib import suppress
from contextlib import asynccontextmanager
from time import time

import uvicorn
from fastapi import FastAPI, Query, Request, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from fastapi.middleware.gzip import GZipMiddleware
from fastapi.responses import JSONResponse
from loguru import logger as loguru_logger
from sqlmodel import func, select

from app.bridge import tachibridge
from app.config import settings
from app.core.database import run_migrations, sessionmanager
from app.core.errors import BridgeAPIError
from app.core.logging import setup_logger
from app.core.scheduler import scheduler
from app.core.ws import ws_manager
from app.features.auth import AuthService, auth_router
from app.features.auth.router import ws_token_cache
from app.features.covers import covers_router
from app.features.explore import explore_router
from app.features.downloads import downloads_router
from app.features.extensions import extensions_router
from app.features.health import health_router
from app.features.library import library_router
from app.features.settings import settings_router
from app.features.web import web_router
from app.models import User

setup_logger()
logger = loguru_logger.bind(module="fastapi")
_bridge_start_task: asyncio.Task[None] | None = None


async def _start_bridge_in_background() -> None:
    try:
        await tachibridge.start()
    except Exception:
        logger.exception("Bridge startup failed in background")


async def backfill_initialized_state() -> None:
    if settings.public.initialized:
        return
    async with sessionmanager.session() as db:
        users_count = int(await db.scalar(select(func.count(User.id))) or 0)
    if users_count > 0:
        AuthService.mark_initialized()
        logger.info("Detected existing users; marked setup as initialized")


@asynccontextmanager
async def lifespan(_app: FastAPI):
    global _bridge_start_task
    logger.info(
        f"Starting {settings.app.project_name} - Version {settings.app.version}"
    )
    try:
        logger.info("Running database migrations...")
        await run_migrations()
        logger.info("Database migrations complete")
        await backfill_initialized_state()
        # Keep API startup responsive even when bridge/KCEF init is slow.
        _bridge_start_task = asyncio.create_task(_start_bridge_in_background())
        await scheduler.start()
        yield
    finally:
        await scheduler.stop()
        if _bridge_start_task is not None and not _bridge_start_task.done():
            _bridge_start_task.cancel()
            with suppress(asyncio.CancelledError):
                await _bridge_start_task
        _bridge_start_task = None
        try:
            await tachibridge.stop()
        finally:
            if sessionmanager.engine is not None:
                await sessionmanager.close()


app = FastAPI(
    title=settings.app.project_name,
    version=settings.app.version,
    lifespan=lifespan,
)

app.include_router(auth_router)
app.include_router(covers_router)
app.include_router(extensions_router)
app.include_router(explore_router)
app.include_router(downloads_router)
app.include_router(health_router)
app.include_router(library_router)
app.include_router(settings_router)
app.include_router(web_router)


@app.exception_handler(BridgeAPIError)
async def handle_bridge_api_error(_: Request, exc: BridgeAPIError) -> JSONResponse:
    return JSONResponse(status_code=exc.status_code, content={"detail": exc.detail})


@app.exception_handler(Exception)
async def handle_unexpected_error(_: Request, exc: Exception) -> JSONResponse:
    logger.exception("Unhandled application error")
    detail = str(exc).strip() or exc.__class__.__name__
    return JSONResponse(status_code=500, content={"detail": detail})


@app.websocket("/api/v2/ws")
async def websocket_endpoint(
    ws: WebSocket,
    api_key: str | None = Query(None),
):
    """Authenticated real-time event stream (JSON messages)."""
    user = None
    if api_key is not None:
        user_id = await ws_token_cache.get(api_key)
        if user_id is not None:
            await ws_token_cache.delete(api_key)  # one-time use
            async with sessionmanager.session() as db:
                user = await db.get(User, user_id)

    if user is None:
        logger.bind(reason="unauthorized").warning("ws.auth_failed")
        await ws.close(code=1008, reason="Unauthorized")
        return

    await ws_manager.connect(ws)
    try:
        # Keep the connection alive; clients may send pings but we don't require it.
        while True:
            await ws.receive_text()
    except WebSocketDisconnect:
        pass
    finally:
        await ws_manager.disconnect(ws)


_ACCESS_SAMPLE_RATE = 0.05   # fraction of normal requests to keep
_ACCESS_SLOW_MS = 1_000      # requests slower than this are always kept


@app.middleware("http")
async def log_requests(request: Request, call_next):
    start_time = time()
    response = await call_next(request)
    host = request.client.host if request.client else "unknown"
    process_time_ms = round((time() - start_time) * 1000)

    is_error = response.status_code >= 400
    is_slow = process_time_ms >= _ACCESS_SLOW_MS

    # Always keep errors and slow requests; sample the rest at 5%.
    # sample_rate field lets consumers reconstruct true counts (rate=1 → exact, rate=N → ×N).
    if is_error or is_slow:
        sample_rate = 1
    elif random.random() >= _ACCESS_SAMPLE_RATE:
        return response  # drop this request, not sampled
    else:
        sample_rate = round(1 / _ACCESS_SAMPLE_RATE)

    is_server_error = response.status_code >= 500
    level = "WARNING" if is_server_error else "INFO"
    # 5xx errors go to console/main log (no access tag); others are access-log-only
    log_extra: dict = dict(
        method=request.method,
        path=request.url.path,
        status=response.status_code,
        duration_ms=process_time_ms,
        client=host,
        sample_rate=sample_rate,
    )
    if not is_server_error:
        log_extra["access"] = True
    logger.bind(**log_extra).log(
        level, f"{request.method} {request.url.path} → {response.status_code} ({process_time_ms}ms)"
    )
    return response


app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.app.cors_allow_origins,
    allow_methods=settings.app.cors_allow_methods,
    allow_headers=settings.app.cors_allow_headers,
    allow_credentials=settings.app.cors_allow_credentials,
)
app.add_middleware(GZipMiddleware, minimum_size=1024)


if __name__ == "__main__":
    uvicorn.run(
        app="app.main:app",
        host=settings.server.host,
        port=settings.server.port,
    )
