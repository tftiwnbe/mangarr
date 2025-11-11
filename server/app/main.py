from contextlib import asynccontextmanager
from time import time

import uvicorn
from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from loguru import logger as loguru_logger

from app.config import settings
from app.core.logging import setup_logger
from app.features.web import web_router
from app.features.health import health_router

setup_logger()
logger = loguru_logger.bind(module="fastapi")


@asynccontextmanager
async def lifespan(_app: FastAPI):
    logger.info(
        f"Starting {settings.app.project_name} - Version {settings.app.version}"
    )
    yield


app = FastAPI(
    title=settings.app.project_name,
    version=settings.app.version,
    lifespan=lifespan,
)

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
