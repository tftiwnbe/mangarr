from __future__ import annotations

import json
import shutil
import zipfile
from pathlib import Path

IMAGE_SUFFIXES = {".jpg", ".jpeg", ".png", ".webp", ".gif", ".avif"}
CHAPTER_ARCHIVE_SUFFIX = ".cbz"
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


def compress_chapter_pages(chapter_dir: Path, compression_level: int = 6) -> bool:
    if not chapter_dir.exists() or not chapter_dir.is_dir():
        return False

    image_files = list_chapter_image_files(chapter_dir)
    if not image_files:
        return False

    archive = chapter_archive_path(chapter_dir)
    tmp_archive = archive.with_suffix(archive.suffix + ".tmp")
    level = max(0, min(int(compression_level), 9))

    compression = zipfile.ZIP_STORED if level == 0 else zipfile.ZIP_DEFLATED
    compresslevel = None if compression == zipfile.ZIP_STORED else level

    try:
        with zipfile.ZipFile(
            tmp_archive,
            mode="w",
            compression=compression,
            compresslevel=compresslevel,
            allowZip64=True,
        ) as handle:
            for file_path in image_files:
                arcname = file_path.relative_to(chapter_dir).as_posix()
                handle.write(file_path, arcname=arcname)
            metadata_path = chapter_dir / CHAPTER_METADATA_FILENAME
            if metadata_path.is_file():
                handle.write(
                    metadata_path,
                    arcname=CHAPTER_METADATA_FILENAME,
                )
        tmp_archive.replace(archive)
    except Exception:
        tmp_archive.unlink(missing_ok=True)
        raise

    shutil.rmtree(chapter_dir, ignore_errors=True)
    return True


def extract_chapter_pages(chapter_dir: Path) -> bool:
    archive = find_chapter_archive_path(chapter_dir)
    if archive is None:
        return False

    resolved_dir = chapter_dir.resolve()
    chapter_dir.mkdir(parents=True, exist_ok=True)
    with zipfile.ZipFile(archive, mode="r") as handle:
        for info in handle.infolist():
            if info.is_dir():
                continue
            member = info.filename.lstrip("/\\")
            if not member:
                continue
            destination = (resolved_dir / member).resolve()
            try:
                destination.relative_to(resolved_dir)
            except ValueError as exc:
                raise ValueError(f"Unsafe archive member path: {info.filename}") from exc
            destination.parent.mkdir(parents=True, exist_ok=True)
            with handle.open(info, mode="r") as source, destination.open("wb") as target:
                shutil.copyfileobj(source, target, length=128 * 1024)

    archive.unlink(missing_ok=True)
    return True
