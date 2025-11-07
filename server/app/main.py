import uvicorn
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.config import settings
from app.features.health import health_router
from app.features.web import web_router


app = FastAPI(title=settings.app.project_name, version=settings.app.version)

app.include_router(health_router)
app.include_router(web_router)

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
        host="0.0.0.0",
        port=settings.server.port,
    )
