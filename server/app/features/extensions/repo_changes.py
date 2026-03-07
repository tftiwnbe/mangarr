from __future__ import annotations

import asyncio
import json
import os
import re
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Awaitable
from urllib.parse import urlparse

import httpx

from app.config import settings
from app.models import RepoChangeStatus

DEFAULT_REPOSITORY_URL = (
    "https://raw.githubusercontent.com/keiyoushi/extensions/repo/index.min.json"
)
GITHUB_API_BASE_URL = "https://api.github.com"
REQUEST_TIMEOUT_SECONDS = 20.0

_APK_FILENAME_RE = re.compile(r"(?P<slug>.+?)(?:-v(?P<version>[^/]+))?\.apk$", re.IGNORECASE)
_SLUG_RE = re.compile(r".+-(?P<lang>[a-z0-9_]+)\.(?P<name>.+)$", re.IGNORECASE)


@dataclass(slots=True)
class RepositoryTrack:
    repo_url: str
    owner: str
    repo: str
    branch: str
    tracked_path: str


@dataclass(slots=True)
class ParsedExtensionFile:
    extension_pkg: str | None
    name: str
    lang: str | None
    version: str | None


def load_repository_url() -> str:
    bridge_config_path = settings.app.config_dir / "bridge.json"
    if bridge_config_path.is_file():
        try:
            loaded = json.loads(bridge_config_path.read_text(encoding="utf-8"))
            repo_url = str(loaded.get("repo_url") or "").strip()
            if repo_url:
                return repo_url
        except Exception:
            pass
    return DEFAULT_REPOSITORY_URL


def resolve_repository_track(repo_url: str) -> RepositoryTrack | None:
    parsed = urlparse(repo_url)
    if parsed.netloc.lower() != "raw.githubusercontent.com":
        return None
    parts = [part for part in parsed.path.split("/") if part]
    if len(parts) < 4:
        return None
    owner, repo, branch = parts[:3]
    relative_parts = parts[3:]
    if not relative_parts:
        return None
    relative_dir = Path(*relative_parts[:-1]) if len(relative_parts) > 1 else Path()
    tracked_path = (relative_dir / "apk").as_posix() if str(relative_dir) else "apk"
    return RepositoryTrack(
        repo_url=repo_url,
        owner=owner,
        repo=repo,
        branch=branch,
        tracked_path=tracked_path,
    )


def parse_extension_file(path: str | None) -> ParsedExtensionFile | None:
    if not path:
        return None
    base = path.split("/")[-1]
    match = _APK_FILENAME_RE.match(base)
    if match is None:
        return None
    slug = match.group("slug")
    version = match.group("version")
    slug_match = _SLUG_RE.match(slug)
    if slug_match is None:
        return ParsedExtensionFile(
            extension_pkg=None,
            name=slug,
            lang=None,
            version=version,
        )
    lang = slug_match.group("lang").lower()
    name = slug_match.group("name")
    extension_pkg = f"eu.kanade.tachiyomi.extension.{lang}.{name}"
    return ParsedExtensionFile(
        extension_pkg=extension_pkg,
        name=name,
        lang=lang,
        version=version,
    )


def _change_key(parsed: ParsedExtensionFile) -> str:
    if parsed.extension_pkg:
        return parsed.extension_pkg
    return f"{parsed.lang or 'unknown'}:{parsed.name}"


async def fetch_repository_changes(
    *,
    repo_url: str,
    days: int,
    limit: int,
) -> tuple[str | None, str, list[dict[str, object]]]:
    track = resolve_repository_track(repo_url)
    if track is None:
        return (
            "Repository updates are supported only for raw.githubusercontent.com indexes.",
            "apk",
            [],
        )

    since_dt = datetime.now(timezone.utc) - timedelta(days=days)
    headers = {"Accept": "application/vnd.github+json"}
    github_token = os.getenv("GITHUB_TOKEN", "").strip()
    if github_token:
        headers["Authorization"] = f"Bearer {github_token}"

    async with httpx.AsyncClient(
        base_url=GITHUB_API_BASE_URL,
        headers=headers,
        timeout=REQUEST_TIMEOUT_SECONDS,
        follow_redirects=True,
    ) as client:
        try:
            commits = await _fetch_commit_summaries(
                client=client,
                track=track,
                since_dt=since_dt,
                limit=limit,
            )
            changes = await _fetch_commit_changes(
                client=client,
                track=track,
                commits=commits,
                limit=limit,
            )
        except httpx.HTTPError as exc:
            message = str(exc).strip() or exc.__class__.__name__
            return (f"Unable to fetch repository changes: {message}", track.tracked_path, [])

    return (None, track.tracked_path, changes[:limit])


async def _fetch_commit_summaries(
    *,
    client: httpx.AsyncClient,
    track: RepositoryTrack,
    since_dt: datetime,
    limit: int,
) -> list[dict]:
    commits: list[dict] = []
    page = 1
    per_page = min(100, max(limit, 20))
    while len(commits) < limit:
        response = await client.get(
            f"/repos/{track.owner}/{track.repo}/commits",
            params={
                "path": track.tracked_path,
                "since": since_dt.isoformat(),
                "sha": track.branch,
                "per_page": per_page,
                "page": page,
            },
        )
        response.raise_for_status()
        batch = response.json()
        if not isinstance(batch, list) or not batch:
            break
        commits.extend(batch)
        if len(batch) < per_page:
            break
        page += 1
    return commits[:limit]


async def _fetch_commit_changes(
    *,
    client: httpx.AsyncClient,
    track: RepositoryTrack,
    commits: list[dict],
    limit: int,
) -> list[dict[str, object]]:
    tasks = [
        _fetch_single_commit_changes(client=client, track=track, commit=commit)
        for commit in commits[:limit]
    ]
    results = await _gather_changes(tasks)
    changes: list[dict[str, object]] = []
    for batch in results:
        changes.extend(batch)
    return changes[:limit]


async def _gather_changes(
    tasks: list[Awaitable[list[dict[str, object]]]]
) -> list[list[dict[str, object]]]:
    semaphore = asyncio.Semaphore(6)

    async def run_one(task_coro: Awaitable[list[dict[str, object]]]) -> list[dict[str, object]]:
        async with semaphore:
            return await task_coro

    return await asyncio.gather(*(run_one(task) for task in tasks))


async def _fetch_single_commit_changes(
    *,
    client: httpx.AsyncClient,
    track: RepositoryTrack,
    commit: dict,
) -> list[dict[str, object]]:
    sha = str(commit.get("sha") or "").strip()
    if not sha:
        return []

    response = await client.get(f"/repos/{track.owner}/{track.repo}/commits/{sha}")
    response.raise_for_status()
    payload = response.json()
    files = payload.get("files") or []
    if not isinstance(files, list):
        return []

    committed_at = str(payload.get("commit", {}).get("committer", {}).get("date") or "").strip()
    commit_message = str(payload.get("commit", {}).get("message") or "").strip()
    commit_title = commit_message.splitlines()[0] if commit_message else None

    added: dict[str, ParsedExtensionFile] = {}
    removed: dict[str, ParsedExtensionFile] = {}
    changes: list[dict[str, object]] = []

    for file_entry in files:
        filename = str(file_entry.get("filename") or "")
        if not filename.startswith(f"{track.tracked_path}/"):
            continue
        status = str(file_entry.get("status") or "").lower()
        parsed = parse_extension_file(filename)
        if parsed is None:
            continue

        if status == "renamed":
            previous = parse_extension_file(file_entry.get("previous_filename"))
            if previous is None:
                continue
            if previous.extension_pkg == parsed.extension_pkg and previous.name == parsed.name:
                changes.append(
                    _build_change(
                        status=RepoChangeStatus.UPDATED,
                        current=parsed,
                        sha=sha,
                        committed_at=committed_at,
                        commit_message=commit_title,
                        version=previous.version,
                        new_version=parsed.version,
                    )
                )
            else:
                changes.append(
                    _build_change(
                        status=RepoChangeStatus.RENAMED,
                        current=previous,
                        sha=sha,
                        committed_at=committed_at,
                        commit_message=commit_title,
                        new_version=parsed.version,
                        renamed_to=parsed.name,
                        renamed_to_pkg=parsed.extension_pkg,
                    )
                )
            continue

        key = _change_key(parsed)
        if status == "added":
            added[key] = parsed
        elif status == "removed":
            removed[key] = parsed
        elif status == "modified":
            changes.append(
                _build_change(
                    status=RepoChangeStatus.UPDATED,
                    current=parsed,
                    sha=sha,
                    committed_at=committed_at,
                    commit_message=commit_title,
                    version=parsed.version,
                    new_version=parsed.version,
                )
            )

    all_keys = list(dict.fromkeys([*added.keys(), *removed.keys()]))
    for key in all_keys:
        added_item = added.get(key)
        removed_item = removed.get(key)
        if added_item is not None and removed_item is not None:
            changes.append(
                _build_change(
                    status=RepoChangeStatus.UPDATED,
                    current=added_item,
                    sha=sha,
                    committed_at=committed_at,
                    commit_message=commit_title,
                    version=removed_item.version,
                    new_version=added_item.version,
                )
            )
            continue
        item = added_item or removed_item
        if item is None:
            continue
        changes.append(
            _build_change(
                status=RepoChangeStatus.ADDED if added_item is not None else RepoChangeStatus.REMOVED,
                current=item,
                sha=sha,
                committed_at=committed_at,
                commit_message=commit_title,
                version=item.version,
            )
        )

    return changes


def _build_change(
    *,
    status: RepoChangeStatus,
    current: ParsedExtensionFile,
    sha: str,
    committed_at: str,
    commit_message: str | None,
    version: str | None = None,
    new_version: str | None = None,
    renamed_to: str | None = None,
    renamed_to_pkg: str | None = None,
) -> dict[str, object]:
    return {
        "status": status,
        "extension_pkg": current.extension_pkg,
        "name": current.name,
        "lang": current.lang,
        "version": version,
        "new_version": new_version,
        "renamed_to": renamed_to,
        "renamed_to_pkg": renamed_to_pkg,
        "commit_sha": sha,
        "commit_message": commit_message,
        "committed_at": committed_at,
    }
