from app.core.utils import normalize_text
from app.models import SourceChapter

_normalize = normalize_text


def choose_replacement_chapter_url(
    *,
    current_url: str,
    current_name: str | None,
    current_number: float | None,
    current_scanlator: str | None,
    source_chapters: list[SourceChapter],
) -> str | None:
    current = (current_url or "").strip()
    if not source_chapters:
        return None

    target_number = float(current_number or 0.0)
    target_name = _normalize(current_name)
    target_scanlator = _normalize(current_scanlator)

    best_url: str | None = None
    best_score = 0.0

    for source_chapter in source_chapters:
        candidate_url = (source_chapter.url or "").strip()
        if not candidate_url or candidate_url == current:
            continue

        score = 0.0
        candidate_number = float(source_chapter.chapter_number or 0.0)
        if target_number > 0.0 and candidate_number > 0.0:
            delta = abs(candidate_number - target_number)
            if delta <= 1e-6:
                score += 6.0
            elif delta <= 0.05:
                score += 3.0
            elif delta <= 1.0:
                score += 0.5

        candidate_name = _normalize(source_chapter.name)
        if target_name and candidate_name:
            if target_name == candidate_name:
                score += 4.0
            elif target_name in candidate_name or candidate_name in target_name:
                score += 2.0

        candidate_scanlator = _normalize(source_chapter.scanlator)
        if target_scanlator and candidate_scanlator and target_scanlator == candidate_scanlator:
            score += 1.0

        if score > best_score:
            best_score = score
            best_url = candidate_url

    if best_score < 3.5:
        return None
    return best_url
