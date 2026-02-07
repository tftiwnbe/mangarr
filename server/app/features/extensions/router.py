from fastapi import APIRouter, Depends

from app.core.deps import DBSessionDep
from app.features.extensions.service import ExtensionService
from app.models import SourcePreference
from app.models.extensions import (
    ExtensionResource,
    RepoExtensionResource,
    RepositoryUpdate,
    SourcePreferencesResource,
)

router = APIRouter(prefix="/api/v2/extensions")


async def get_service(db: DBSessionDep) -> ExtensionService:
    return ExtensionService(db)


@router.get("/available", response_model=list[RepoExtensionResource])
async def get_available(
    service: ExtensionService = Depends(get_service),
):
    """Get all available extensions from the configured repository."""
    return await service.list_all_extensions()


@router.get("/installed", response_model=list[ExtensionResource])
async def get_installed(service: ExtensionService = Depends(get_service)):
    """Get all currently installed extensions."""
    return await service.list_installed_extensions()


@router.put("/repository", response_model=list[RepoExtensionResource], status_code=200)
async def change_repository(
    repo: RepositoryUpdate, service: ExtensionService = Depends(get_service)
):
    """Delete existing extensions/sources and use new repository URL."""
    return await service.change_extensions_repo(str(repo.url))


@router.post("/install/{extension_pkg}", response_model=ExtensionResource)
async def install_extension(
    extension_pkg: str, service: ExtensionService = Depends(get_service)
):
    """Install an extension by package name."""
    return await service.install_extension(extension_pkg)


@router.delete("/uninstall/{extension_pkg}", status_code=204)
async def uninstall_extension(
    extension_pkg: str, service: ExtensionService = Depends(get_service)
):
    """Uninstall an extension by package name."""
    await service.uninstall_extension(extension_pkg)


@router.put("/priority", status_code=204)
async def update_extensions_priority(
    extensions_by_priority: list[str],
    service: ExtensionService = Depends(get_service),
):
    """Update an extension's priority."""
    await service.update_extensions_priority(extensions_by_priority)


@router.put("/{extension_pkg}/proxy", status_code=204)
async def toggle_extension_proxy(
    extension_pkg: str,
    use_proxy: bool,
    service: ExtensionService = Depends(get_service),
):
    """Enable or disable proxy mode for an extension."""
    await service.toggle_extension_proxy(extension_pkg, use_proxy)


@router.get("/source/{source_id}/preferences", response_model=SourcePreferencesResource)
async def get_source_preferences(
    source_id: str, service: ExtensionService = Depends(get_service)
):
    """Get available preferences for source."""
    return await service.list_source_preferences(source_id)


@router.put("/source/{source_id}/enabled", status_code=204)
async def toggle_source(
    source_id: str,
    enabled: bool,
    service: ExtensionService = Depends(get_service),
):
    """Enable or disable a source."""
    await service.toggle_source(source_id, enabled)


@router.put("/source/{source_id}/preferences", status_code=204)
async def update_source_preferences(
    source_id: str,
    preferences: list[SourcePreference],
    service: ExtensionService = Depends(get_service),
):
    """Update source preferences"""
    await service.update_source_preferences(source_id, preferences)
