from contextlib import asynccontextmanager
from time import time

import uvicorn
from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from loguru import logger as loguru_logger

from app.bridge import tachibridge
from app.config import settings
from app.core.database import sessionmanager
from app.core.logging import setup_logger
from app.core.scheduler import scheduler
from app.features.discover import discover_router
from app.features.extensions import extensions_router
from app.features.health import health_router
from app.features.web import web_router

setup_logger()
logger = loguru_logger.bind(module="fastapi")

title = {
    # "source_id": 2098905203823335614,
    "url": "/manga/2a62fa7f-ff92-4b2b-9073-049cdfff464c",
    "title": "Перейти черту",
    "artist": None,
    "author": None,
    "description": None,
    "genre": None,
    "status": 0,
    "thumbnail_url": "https://uploads.mangadex.org/covers/2a62fa7f-ff92-4b2b-9073-049cdfff464c/cc649567-8612-40ce-9c55-a13a6f6e63ce.png.512.jpg",
}


@asynccontextmanager
async def lifespan(_app: FastAPI):
    logger.info(
        f"Starting {settings.app.project_name} - Version {settings.app.version}"
    )
    try:
        await tachibridge.start()
        await scheduler.start()
        # logger.warning(await tachibridge.set_repository_url("https://raw.githubusercontent.com/keiyoushi/extensions/repo/index.min.json"))
        logger.warning(
            await tachibridge.uninstall_extension(
                "eu.kanade.tachiyomi.extension.all.ahottie"
            )
        )
        logger.warning(
            await tachibridge.install_extension(
                "eu.kanade.tachiyomi.extension.all.ahottie"
            )
        )
        # logger.warning(await tachibridge.fetch_repository_extensions())
        # logger.warning(await bridge.fetch_title_details(2499283573021220255, title))
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

app.include_router(extensions_router)
app.include_router(discover_router)
app.include_router(health_router)
app.include_router(web_router)

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


if __name__ == "__main__":
    uvicorn.run(
        app="app.main:app",
        host=settings.server.host,
        port=settings.server.port,
    )
