"""add library local cover path

Revision ID: 6b7f1d2e4c90
Revises: 5f3c2a1b7e9d
Create Date: 2026-03-07 19:05:00.000000
"""

from collections.abc import Sequence

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = "6b7f1d2e4c90"
down_revision: str | Sequence[str] | None = "5f3c2a1b7e9d"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def _has_column(table_name: str, column_name: str) -> bool:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    return any(
        str(column.get("name")) == column_name
        for column in inspector.get_columns(table_name)
    )


def upgrade() -> None:
    if not _has_column("library_titles", "local_cover_path"):
        op.add_column(
            "library_titles",
            sa.Column("local_cover_path", sa.Text(), nullable=True),
        )


def downgrade() -> None:
    if _has_column("library_titles", "local_cover_path"):
        op.drop_column("library_titles", "local_cover_path")
