import asyncio
import mimetypes
import shutil
from pathlib import Path
from urllib.parse import urlparse

from app.config import settings


def library_cover_route(title_id: int | None, local_cover_path: str | None) -> str | None:
    if title_id is None or not (local_cover_path or "").strip():
        return None
    return f"/api/v2/covers/library/{int(title_id)}"


def resolve_library_cover_path(local_cover_path: str | None) -> Path | None:
    relative_path = (local_cover_path or "").strip()
    if not relative_path:
        return None
    root = (settings.app.data_dir / "covers" / "library").resolve()
    candidate = (settings.app.data_dir / relative_path).resolve()
    try:
        candidate.relative_to(root)
    except ValueError:
        return None
    return candidate


async def persist_library_cover(title_id: int, remote_url: str | None) -> str | None:
    normalized_url = (remote_url or "").strip()
    if not normalized_url:
        return None

    from app.features.covers.router import cover_cache  # noqa: PLC0415

    cached_path, meta = await cover_cache.get_cover(normalized_url)
    parsed = urlparse(meta.url)
    suffix = Path(parsed.path).suffix.lower()
    if not suffix:
        guessed = mimetypes.guess_extension(meta.content_type or "")
        suffix = (guessed or ".img").lower()

    covers_root = settings.app.data_dir / "covers" / "library"
    destination = covers_root / f"{int(title_id)}{suffix}"

    def _persist() -> None:
        covers_root.mkdir(parents=True, exist_ok=True)
        for existing in covers_root.glob(f"{int(title_id)}.*"):
            if existing == destination:
                continue
            existing.unlink(missing_ok=True)
        tmp_path = destination.with_suffix(f"{destination.suffix}.tmp")
        shutil.copyfile(cached_path, tmp_path)
        tmp_path.replace(destination)

    await asyncio.to_thread(_persist)
    return str(destination.relative_to(settings.app.data_dir).as_posix())
