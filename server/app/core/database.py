import contextlib
from collections.abc import AsyncIterator, Mapping
from pathlib import Path
from typing import Any

from alembic import command
from alembic.config import Config
from sqlalchemy.ext.asyncio import (
    AsyncConnection,
    AsyncEngine,
    async_sessionmaker,
    create_async_engine,
)
from sqlmodel.ext.asyncio.session import AsyncSession

from app.config import settings


class DatabaseSessionManager:
    """Create and manage shared async SQLAlchemy engine and session factories."""

    def __init__(self, host: str, engine_kwargs: Mapping[str, Any] | None = None):
        self._engine: AsyncEngine | None = create_async_engine(
            host, **(engine_kwargs) or {}
        )
        self._sessionmaker: async_sessionmaker[AsyncSession] | None = (
            async_sessionmaker(
                bind=self._engine,
                expire_on_commit=False,
                class_=AsyncSession,
            )
        )

    @property
    def engine(self):
        """Return the lazily-instantiated async engine."""
        return self._engine

    async def close(self):
        """Dispose the underlying engine and clear cached factories."""
        if self._engine is None:
            raise Exception("DatabaseSessionManager is not initialized")
        await self._engine.dispose()

        self._engine = None
        self._sessionmaker = None

    @contextlib.asynccontextmanager
    async def connect(self) -> AsyncIterator[AsyncConnection]:
        """Provide a transactional connection that rolls back if an error occurs."""
        if self._engine is None:
            raise Exception("DatabaseSessionManager is not initialized")

        async with self._engine.begin() as connection:
            yield connection

    @contextlib.asynccontextmanager
    async def session(self) -> AsyncIterator[AsyncSession]:
        """Yield an AsyncSession that automatically rolls back on error."""
        if self._sessionmaker is None:
            raise Exception("DatabaseSessionManager is not initialized")

        session = self._sessionmaker()
        try:
            yield session
        except Exception:
            await session.rollback()
            raise
        finally:
            await session.close()


sessionmanager = DatabaseSessionManager(
    settings.app.database_url, {"echo": settings.log.sql}
)


async def get_database_session():
    """FastAPI dependency that yields a managed AsyncSession."""
    async with sessionmanager.session() as session:
        yield session


async def run_migrations() -> None:
    """Run Alembic migrations to head."""
    from app import models  # noqa: F401

    if sessionmanager.engine is None:
        raise Exception("DatabaseSessionManager is not initialized")

    server_dir = Path(__file__).resolve().parent.parent.parent
    alembic_cfg = Config(str(server_dir / "alembic.ini"))
    alembic_cfg.set_main_option("script_location", str(server_dir / "alembic"))
    alembic_cfg.set_main_option("sqlalchemy.url", settings.app.database_url)

    def do_upgrade(sync_connection) -> None:
        alembic_cfg.attributes["connection"] = sync_connection
        command.upgrade(alembic_cfg, "head")

    async with sessionmanager.engine.connect() as connection:
        await connection.run_sync(do_upgrade)
        await connection.commit()
