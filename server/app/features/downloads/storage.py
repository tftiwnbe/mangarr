from __future__ import annotations

import json
import shutil
import zipfile
from pathlib import Path

IMAGE_SUFFIXES = {".jpg", ".jpeg", ".png", ".webp", ".gif", ".avif"}
CHAPTER_ARCHIVE_SUFFIX = ".cbz"
ARCHIVE_VIRTUAL_SEGMENT = ".mangarr-archive"
CHAPTER_METADATA_FILENAME = "mangarr-chapter-info.json"
TITLE_METADATA_FILENAME = "mangarr-title-info.json"


def chapter_archive_path(chapter_dir: Path) -> Path:
    name = chapter_dir.name
    if name.lower().endswith(CHAPTER_ARCHIVE_SUFFIX):
        return chapter_dir
    return chapter_dir.with_name(f"{name}{CHAPTER_ARCHIVE_SUFFIX}")


def find_chapter_archive_path(chapter_dir: Path) -> Path | None:
    preferred = chapter_archive_path(chapter_dir)
    if preferred.is_file():
        return preferred
    legacy = chapter_dir.with_suffix(CHAPTER_ARCHIVE_SUFFIX)
    if legacy != preferred and legacy.is_file():
        return legacy
    return None


def normalize_archive_member_path(member: str) -> str | None:
    normalized = member.replace("\\", "/").strip("/")
    if not normalized:
        return None
    parts = [part for part in normalized.split("/") if part not in {"", "."}]
    if not parts or any(part == ".." for part in parts):
        return None
    return "/".join(parts)


def archive_member_virtual_path(download_path: str, member: str) -> str | None:
    normalized_download_path = download_path.strip("/").strip()
    normalized_member = normalize_archive_member_path(member)
    if not normalized_download_path or normalized_member is None:
        return None
    return f"{normalized_download_path}/{ARCHIVE_VIRTUAL_SEGMENT}/{normalized_member}"


def split_archive_member_virtual_path(local_path: str) -> tuple[str, str] | None:
    marker = f"/{ARCHIVE_VIRTUAL_SEGMENT}/"
    if marker not in local_path:
        return None
    chapter_path, member = local_path.split(marker, 1)
    normalized_chapter_path = chapter_path.strip("/").strip()
    normalized_member = normalize_archive_member_path(member)
    if not normalized_chapter_path or normalized_member is None:
        return None
    return normalized_chapter_path, normalized_member


def write_chapter_metadata(chapter_dir: Path, payload: dict) -> None:
    chapter_dir.mkdir(parents=True, exist_ok=True)
    path = chapter_dir / CHAPTER_METADATA_FILENAME
    tmp_path = path.with_suffix(path.suffix + ".tmp")
    tmp_path.write_text(
        json.dumps(payload, ensure_ascii=True, indent=2),
        encoding="utf-8",
    )
    tmp_path.replace(path)


def write_title_metadata(title_dir: Path, payload: dict) -> None:
    title_dir.mkdir(parents=True, exist_ok=True)
    path = title_dir / TITLE_METADATA_FILENAME
    tmp_path = path.with_suffix(path.suffix + ".tmp")
    tmp_path.write_text(
        json.dumps(payload, ensure_ascii=True, indent=2),
        encoding="utf-8",
    )
    tmp_path.replace(path)


def read_chapter_metadata(chapter_dir: Path) -> dict | None:
    if chapter_dir.is_dir():
        path = chapter_dir / CHAPTER_METADATA_FILENAME
        if path.is_file():
            try:
                loaded = json.loads(path.read_text(encoding="utf-8"))
                if isinstance(loaded, dict):
                    return loaded
            except Exception:
                return None
            return None

    archive = find_chapter_archive_path(chapter_dir)
    if archive is None:
        return None
    try:
        with zipfile.ZipFile(archive, mode="r") as handle:
            with handle.open(CHAPTER_METADATA_FILENAME, mode="r") as stream:
                loaded = json.loads(stream.read().decode("utf-8"))
                if isinstance(loaded, dict):
                    return loaded
    except Exception:
        return None
    return None


def read_title_metadata(title_dir: Path) -> dict | None:
    path = title_dir / TITLE_METADATA_FILENAME
    if not path.is_file():
        return None
    try:
        loaded = json.loads(path.read_text(encoding="utf-8"))
    except Exception:
        return None
    return loaded if isinstance(loaded, dict) else None


def list_chapter_image_files(chapter_dir: Path) -> list[Path]:
    if not chapter_dir.exists() or not chapter_dir.is_dir():
        return []
    return sorted(
        (
            item
            for item in chapter_dir.rglob("*")
            if item.is_file() and item.suffix.lower() in IMAGE_SUFFIXES
        ),
        key=lambda item: item.as_posix(),
    )


def chapter_has_payload(chapter_dir: Path) -> bool:
    if list_chapter_image_files(chapter_dir):
        return True
    return find_chapter_archive_path(chapter_dir) is not None


def chapter_payload_size_bytes(chapter_dir: Path) -> int:
    image_files = list_chapter_image_files(chapter_dir)
    if image_files:
        total = 0
        for file_path in image_files:
            try:
                total += int(file_path.stat().st_size)
            except OSError:
                continue
        return total

    archive = find_chapter_archive_path(chapter_dir)
    if archive is None:
        return 0
    try:
        return int(archive.stat().st_size)
    except OSError:
        return 0


def list_chapter_archive_images(chapter_dir: Path) -> list[tuple[str, int]]:
    archive = find_chapter_archive_path(chapter_dir)
    if archive is None:
        return []
    entries: list[tuple[str, int]] = []
    try:
        with zipfile.ZipFile(archive, mode="r") as handle:
            for info in handle.infolist():
                if info.is_dir():
                    continue
                normalized_member = normalize_archive_member_path(info.filename)
                if normalized_member is None:
                    continue
                if Path(normalized_member).suffix.lower() not in IMAGE_SUFFIXES:
                    continue
                entries.append((normalized_member, int(info.file_size)))
    except Exception:
        return []
    return sorted(entries, key=lambda item: item[0])


def read_chapter_archive_member(chapter_dir: Path, member: str) -> bytes | None:
    archive = find_chapter_archive_path(chapter_dir)
    normalized_member = normalize_archive_member_path(member)
    if archive is None or normalized_member is None:
        return None
    try:
        with zipfile.ZipFile(archive, mode="r") as handle:
            with handle.open(normalized_member, mode="r") as stream:
                return stream.read()
    except Exception:
        return None


def compress_chapter_pages(chapter_dir: Path) -> bool:
    if not chapter_dir.exists() or not chapter_dir.is_dir():
        return False

    image_files = list_chapter_image_files(chapter_dir)
    if not image_files:
        return False

    archive = chapter_archive_path(chapter_dir)
    tmp_archive = archive.with_suffix(archive.suffix + ".tmp")
    try:
        with zipfile.ZipFile(
            tmp_archive,
            mode="w",
            compression=zipfile.ZIP_STORED,
            allowZip64=True,
        ) as handle:
            for file_path in image_files:
                arcname = file_path.relative_to(chapter_dir).as_posix()
                handle.write(
                    file_path,
                    arcname=arcname,
                    compress_type=zipfile.ZIP_STORED,
                )
            metadata_path = chapter_dir / CHAPTER_METADATA_FILENAME
            if metadata_path.is_file():
                handle.write(
                    metadata_path,
                    arcname=CHAPTER_METADATA_FILENAME,
                    compress_type=zipfile.ZIP_STORED,
                )
        tmp_archive.replace(archive)
    except Exception:
        tmp_archive.unlink(missing_ok=True)
        raise

    shutil.rmtree(chapter_dir, ignore_errors=True)
    return True
