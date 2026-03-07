import re
from difflib import SequenceMatcher
from urllib.parse import parse_qs, quote, urlparse

from app.core.utils import normalize_text

_UUID_RE = re.compile(
    r"[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}",
    re.IGNORECASE,
)
_LONG_HEX_RE = re.compile(r"^[0-9a-f]{16,}$", re.IGNORECASE)
_NUMERIC_ID_RE = re.compile(r"^\d{5,}$")
_STABLE_PATH_PREFIXES = {"title", "manga", "comic", "series", "work", "book"}

_normalize = normalize_text


def canonical_title_key(title: str, author: str | None = None) -> str:
    title_key = _normalize(title)
    author_key = _normalize(author)
    return f"{title_key}|{author_key}" if author_key else title_key


def title_only_key(canonical_key: str | None) -> str:
    normalized = (canonical_key or "").strip()
    if not normalized:
        return ""
    return normalized.split("|", 1)[0]


def title_url_group_key(title_url: str) -> str:
    raw = (title_url or "").strip()
    if not raw:
        return ""
    parsed = urlparse(raw)
    base_path = parsed.path or raw
    normalized = base_path.strip().lower().rstrip("/")
    if not normalized:
        return raw.lower()

    uuid_match = _UUID_RE.search(normalized)
    if uuid_match:
        return f"uuid:{uuid_match.group(0).lower()}"

    segments = [segment for segment in normalized.split("/") if segment]
    for segment in segments:
        if _NUMERIC_ID_RE.fullmatch(segment) or _LONG_HEX_RE.fullmatch(segment):
            return f"id:{segment}"

    if len(segments) >= 2 and segments[0] in _STABLE_PATH_PREFIXES:
        return f"{segments[0]}/{segments[1]}"

    return normalized


def fallback_title_from_url(title_url: str) -> str:
    slug = title_url.strip().strip("/")
    if "--" in slug:
        slug = slug.split("--", 1)[1]
    slug = slug.replace("-", " ").replace("_", " ").strip()
    if not slug:
        return title_url
    return " ".join(part.capitalize() for part in slug.split())


def resolve_libgroup_chapter_url(chapter_url: str) -> str:
    raw = (chapter_url or "").strip()
    prefix = "mangarr-libgroup://"
    if not raw.startswith(prefix):
        return raw

    payload = raw.removeprefix(prefix)
    slug, _, query = payload.partition("?")
    slug = slug.strip().lstrip("/")
    if not slug:
        return raw

    params = parse_qs(query, keep_blank_values=True)
    volume = (params.get("v", [None])[0] or "").strip()
    number = (params.get("n", [None])[0] or "").strip()
    if not volume or not number:
        return raw

    branch_id = (params.get("b", [None])[0] or "").strip()
    branch_part = f"&branch_id={quote(branch_id, safe='')}" if branch_id else ""
    return (
        f"/{slug}/chapter?"
        f"{branch_part}&volume={quote(volume, safe='')}&number={quote(number, safe='')}"
    )


def source_match_score(
    query_title: str,
    query_author: str | None,
    candidate_title: str,
    candidate_author: str | None,
) -> float:
    normalized_query_title = _normalize(query_title)
    normalized_candidate_title = _normalize(candidate_title)
    if not normalized_query_title or not normalized_candidate_title:
        return 0.0

    if normalized_query_title == normalized_candidate_title:
        score = 1.0
    else:
        score = SequenceMatcher(
            a=normalized_query_title,
            b=normalized_candidate_title,
        ).ratio()
        if (
            normalized_query_title in normalized_candidate_title
            or normalized_candidate_title in normalized_query_title
        ):
            score = max(score, 0.9)

    normalized_query_author = _normalize(query_author)
    normalized_candidate_author = _normalize(candidate_author)
    if (
        normalized_query_author
        and normalized_candidate_author
        and normalized_query_author == normalized_candidate_author
    ):
        score = min(1.0, score + 0.08)

    return score


def author_match_score(
    query_author: str | None,
    candidate_author: str | None,
) -> float:
    normalized_query_author = _normalize(query_author)
    normalized_candidate_author = _normalize(candidate_author)
    if not normalized_query_author or not normalized_candidate_author:
        return 0.0
    if normalized_query_author == normalized_candidate_author:
        return 1.0

    score = SequenceMatcher(
        a=normalized_query_author,
        b=normalized_candidate_author,
    ).ratio()
    if (
        normalized_query_author in normalized_candidate_author
        or normalized_candidate_author in normalized_query_author
    ):
        score = max(score, 0.9)
    return score
