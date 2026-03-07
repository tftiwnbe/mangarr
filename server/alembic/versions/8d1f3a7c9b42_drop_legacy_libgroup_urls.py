"""normalize legacy mangarr-libgroup chapter urls

Revision ID: 8d1f3a7c9b42
Revises: 6b7f1d2e4c90
Create Date: 2026-03-08 13:20:00.000000
"""

from collections.abc import Sequence
from urllib.parse import parse_qs, quote

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = "8d1f3a7c9b42"
down_revision: str | Sequence[str] | None = "6b7f1d2e4c90"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

_LEGACY_PREFIX = "mangarr-libgroup://"


def _has_table(table_name: str) -> bool:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    return table_name in inspector.get_table_names()


def _normalize_legacy_url(chapter_url: str) -> str:
    raw = (chapter_url or "").strip()
    if not raw.startswith(_LEGACY_PREFIX):
        return raw

    payload = raw.removeprefix(_LEGACY_PREFIX)
    slug, _, query = payload.partition("?")
    slug = slug.strip().lstrip("/")
    if not slug:
        return raw

    params = parse_qs(query, keep_blank_values=True)
    volume = (params.get("volume", params.get("v", [None]))[0] or "").strip()
    number = (params.get("number", params.get("n", [None]))[0] or "").strip()
    if not volume or not number:
        return raw

    branch_id = (
        params.get("branch_id", params.get("b", [None]))[0] or ""
    ).strip()
    branch_part = f"&branch_id={quote(branch_id, safe='')}" if branch_id else ""
    return (
        f"/{slug}/chapter?"
        f"{branch_part}&volume={quote(volume, safe='')}&number={quote(number, safe='')}"
    )


def _migrate_table_urls(
    table_name: str,
    pk_column: str,
    url_column: str,
) -> None:
    if not _has_table(table_name):
        return

    bind = op.get_bind()
    rows = bind.execute(
        sa.text(
            f"""
            SELECT {pk_column}, {url_column}
            FROM {table_name}
            WHERE {url_column} LIKE :legacy_prefix
            """
        ),
        {"legacy_prefix": f"{_LEGACY_PREFIX}%"},
    ).fetchall()

    for row in rows:
        row_id = int(getattr(row, pk_column))
        chapter_url = str(getattr(row, url_column) or "")
        normalized = _normalize_legacy_url(chapter_url)
        if normalized == chapter_url:
            continue
        bind.execute(
            sa.text(
                f"""
                UPDATE {table_name}
                SET {url_column} = :chapter_url
                WHERE {pk_column} = :row_id
                """
            ),
            {"row_id": row_id, "chapter_url": normalized},
        )


def upgrade() -> None:
    _migrate_table_urls(
        table_name="library_chapters",
        pk_column="id",
        url_column="chapter_url",
    )
    _migrate_table_urls(
        table_name="download_tasks",
        pk_column="id",
        url_column="chapter_url",
    )


def downgrade() -> None:
    # Data migration is intentionally not reversed.
    pass

