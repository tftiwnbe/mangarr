from contextlib import asynccontextmanager
from time import time

import uvicorn
from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.middleware.gzip import GZipMiddleware
from fastapi.responses import JSONResponse
from loguru import logger as loguru_logger

from app.bridge import tachibridge
from app.config import settings
from app.core.database import run_migrations, sessionmanager
from app.core.errors import BridgeAPIError
from app.core.logging import setup_logger
from app.core.scheduler import scheduler
from app.features.auth import auth_router
from app.features.discover import discover_router
from app.features.downloads import downloads_router
from app.features.extensions import extensions_router
from app.features.health import health_router
from app.features.library import library_router
from app.features.web import web_router

setup_logger()
logger = loguru_logger.bind(module="fastapi")


@asynccontextmanager
async def lifespan(_app: FastAPI):
    logger.info(
        f"Starting {settings.app.project_name} - Version {settings.app.version}"
    )
    try:
        logger.info("Running database migrations...")
        await run_migrations()
        logger.info("Database migrations complete")
        await tachibridge.start()
        await scheduler.start()
        yield
    finally:
        await scheduler.stop()
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
app.include_router(extensions_router)
app.include_router(discover_router)
app.include_router(downloads_router)
app.include_router(health_router)
app.include_router(library_router)
app.include_router(web_router)


@app.exception_handler(BridgeAPIError)
async def handle_bridge_api_error(_: Request, exc: BridgeAPIError) -> JSONResponse:
    return JSONResponse(status_code=exc.status_code, content={"detail": exc.detail})

if settings.log.access:

    @app.middleware("http")
    async def log_requests(request: Request, call_next):
        start_time = time()
        response = await call_next(request)
        host = request.client.host if request.client else "unknown"
        process_time = (time() - start_time) * 1000
        logger.bind(access=True).info(
            f"{host} | {request.method} {request.url.path} "
            f"→ {response.status_code} ({process_time:.2f}ms)"
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
