from logging.config import fileConfig

from sqlalchemy import pool
from sqlalchemy.engine import Connection
from sqlalchemy.ext.asyncio import async_engine_from_config
from sqlmodel import SQLModel

from alembic import context
from app import models  # noqa: F401
from app.config import settings

config = context.config
_models = models

# Interpret the config file for Python logging.
# This line sets up loggers basically.
if config.config_file_name is not None:
    fileConfig(config.config_file_name)

#  model's MetaData object
target_metadata = [SQLModel.metadata]
database_url = settings.app.database_url


def run_migrations_offline() -> None:
    """Run migrations in 'offline' mode.

    This configures the context with just a URL
    and not an Engine, though an Engine is acceptable
    here as well.  By skipping the Engine creation
    we don't even need a DBAPI to be available.

    Calls to context.execute() here emit the given string to the
    script output.

    """
    context.configure(
        url=database_url,
        target_metadata=target_metadata,
        literal_binds=True,
        dialect_opts={"paramstyle": "named"},
    )

    with context.begin_transaction():
        context.run_migrations()


def do_run_migrations(connection: Connection) -> None:
    context.configure(connection=connection, target_metadata=target_metadata)

    with context.begin_transaction():
        context.run_migrations()


def run_migrations_online() -> None:
    """Run migrations in 'online' mode.

    If a connection is provided via config.attributes (e.g. from tests),
    use it synchronously. Otherwise, create an async engine and run
    migrations using an async connection.

    """
    provided_connection = config.attributes.get("connection")
    if isinstance(provided_connection, Connection):
        # A synchronous connection was injected (e.g., via AsyncConnection.run_sync)
        do_run_migrations(provided_connection)
        return

    configuration = config.get_section(config.config_ini_section)
    if configuration is not None:
        configuration["sqlalchemy.url"] = database_url
        connectable = async_engine_from_config(
            configuration,
            prefix="sqlalchemy.",
            poolclass=pool.NullPool,
        )

        async def _run() -> None:
            async with connectable.connect() as connection:
                await connection.run_sync(do_run_migrations)

        try:
            import asyncio

            asyncio.run(_run())
        finally:
            # Dispose outside of the running loop
            import asyncio as _asyncio

            # Use a fresh loop to dispose if needed
            _asyncio.run(connectable.dispose())


if context.is_offline_mode():
    run_migrations_offline()
else:
    run_migrations_online()
