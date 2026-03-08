import asyncio
import mimetypes
import re
import shutil
from pathlib import Path
from urllib.parse import urlparse

from app.config import settings

_SAFE_SEGMENT_RE = re.compile(r"[^a-zA-Z0-9._ -]+")


def _safe_segment(value: str | None, fallback: str) -> str:
    cleaned = _SAFE_SEGMENT_RE.sub("_", (value or "").strip()).strip(" ._")
    return cleaned[:80] or fallback


def _downloads_root_candidates() -> tuple[Path, ...]:
    configured = settings.downloads.root_dir.expanduser()
    fallback = settings.app.data_dir / "downloads"
    legacy_fallback = settings.app.config_dir / "downloads"
    return (configured, fallback, legacy_fallback)


def _active_downloads_root() -> Path:
    for candidate in _downloads_root_candidates():
        try:
            candidate.mkdir(parents=True, exist_ok=True)
            probe = candidate / ".write-check"
            probe.touch(exist_ok=True)
            probe.unlink(missing_ok=True)
            return candidate
        except Exception:
            continue
    return _downloads_root_candidates()[0]


def _legacy_covers_root() -> Path:
    return (settings.app.data_dir / "covers" / "library").resolve()


def is_downloaded_title_cover_path(local_cover_path: str | None) -> bool:
    relative_path = (local_cover_path or "").strip()
    if not relative_path:
        return False

    normalized = Path(relative_path).as_posix().strip("/")
    return normalized.endswith("/cover.jpg") or normalized.endswith("/cover.jpeg") or normalized.endswith(
        "/cover.png"
    ) or normalized.endswith("/cover.webp") or normalized.endswith("/cover.gif") or normalized.endswith(
        "/cover.avif"
    )


def library_cover_route(title_id: int | None, local_cover_path: str | None) -> str | None:
    if title_id is None or not (local_cover_path or "").strip():
        return None
    return f"/api/v2/covers/library/{int(title_id)}"


def resolve_library_cover_path(local_cover_path: str | None) -> Path | None:
    relative_path = (local_cover_path or "").strip()
    if not relative_path:
        return None

    candidate_path = Path(relative_path)
    if candidate_path.is_absolute():
        return None

    for root in _downloads_root_candidates():
        try:
            candidate = (root / candidate_path).resolve()
            candidate.relative_to(root.resolve())
            return candidate
        except ValueError:
            continue

    legacy_root = _legacy_covers_root()
    try:
        legacy_candidate = (settings.app.data_dir / candidate_path).resolve()
        legacy_candidate.relative_to(legacy_root)
        return legacy_candidate
    except ValueError:
        return None


async def persist_library_cover(
    remote_url: str | None,
    *,
    source_name: str | None,
    source_lang: str | None,
    title_name: str | None,
) -> str | None:
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

    downloads_root = _active_downloads_root()
    source_segment = f"{_safe_segment(source_name or 'source', 'source')} [{_safe_segment((source_lang or 'und').lower(), 'und')}]"
    title_segment = _safe_segment(title_name, "title")
    relative_path = Path(source_segment) / title_segment / f"cover{suffix}"
    destination = downloads_root / relative_path

    def _persist() -> None:
        destination.parent.mkdir(parents=True, exist_ok=True)
        for existing in destination.parent.glob("cover.*"):
            if existing != destination:
                existing.unlink(missing_ok=True)
        tmp_path = destination.with_suffix(f"{destination.suffix}.tmp")
        shutil.copyfile(cached_path, tmp_path)
        tmp_path.replace(destination)

    await asyncio.to_thread(_persist)
    return str(relative_path.as_posix())
