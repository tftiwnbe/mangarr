# from collections.abc import Iterable
# from typing import Any, TypeVar
#
# from loguru import logger
# from pydantic import ValidationError
# from sqlmodel import SQLModel
#
# from app.core.database import sessionmanager
# from app.core.scheduler import scheduler
# from app.extensions_bridge.daemon import bridge
# from app.extensions_bridge.storage import (
#     ExtensionStorage,
#     # RepoExtensionStorage,
# )
# from app.models import Extension, RepoExtension
#
#
# _logger = logger.bind(module="extensions.sync")
#
#
# def _parse_extensions(
#     payload: Iterable[dict[str, Any]],
#     model: type[RepoExtension],
#     *,
#     context: str,
# ) -> list[RepoExtension]:
#     parsed: list[RepoExtension] = []
#     for raw in payload:
#         try:
#             _logger.warning(raw)
#             parsed.append(model.model_validate(raw))
#         except ValidationError as exc:
#             package = raw.get("pkg") or raw.get("package") or raw.get("packageName")
#             _logger.bind(extension_package=package, extension_context=context).warning(
#                 "Skipping invalid %s extension payload: %s",
#                 context,
#                 exc,
#             )
#     return parsed


# @task.interval(10)
# async def sync_extensions() -> None:
#     async with sessionmanager.session() as session:
#         storage = ExtensionStorage(session)
#         _logger.warning(await storage.list())
# try:
#     payload = await bridge.list_repository_extensions()
# except Exception:
#     _logger.exception("Failed to fetch installed extensions from bridge.")
#     return
#
# extensions = _parse_extensions(payload, RepoExtension, context="installed")
# async with sessionmanager.session() as session:
#     storage = ExtensionStorage(session)
#     await storage.replace_all(extensions)


# @scheduler.interval(1800)
# async def sync_repository_extensions() -> None:
#     """Fetch repository extension metadata and persist it locally."""
#
#     try:
#         payload = await bridge.list_repository_extensions()
#     except Exception:
#         _logger.exception("Failed to fetch repository extensions from bridge.")
#         return
#
#     extensions = _parse_extensions(payload, RepoExtension, context="repository")
#     async with sessionmanager.session() as session:
#         storage = RepoExtensionStorage(session)
#         await storage.replace_all(extensions)
