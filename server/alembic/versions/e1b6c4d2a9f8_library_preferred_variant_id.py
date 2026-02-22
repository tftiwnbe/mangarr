"""add preferred reading variant on library titles

Revision ID: e1b6c4d2a9f8
Revises: c7d4e8a1f2b3
Create Date: 2026-02-22 00:00:02.000000
"""

from collections.abc import Sequence

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = "e1b6c4d2a9f8"
down_revision: str | Sequence[str] | None = "c7d4e8a1f2b3"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column(
        "library_titles",
        sa.Column("preferred_variant_id", sa.Integer(), nullable=True),
    )
    op.create_index(
        "ix_library_titles_preferred_variant_id",
        "library_titles",
        ["preferred_variant_id"],
        unique=False,
    )
    op.execute(
        """
        UPDATE library_titles
        SET preferred_variant_id = (
            SELECT v.id
            FROM library_title_variants AS v
            WHERE v.library_title_id = library_titles.id
            ORDER BY
                CASE WHEN v.last_synced_at IS NULL THEN 1 ELSE 0 END,
                v.last_synced_at DESC,
                v.id ASC
            LIMIT 1
        )
        WHERE preferred_variant_id IS NULL
        """
    )


def downgrade() -> None:
    op.drop_index(
        "ix_library_titles_preferred_variant_id",
        table_name="library_titles",
    )
    op.drop_column("library_titles", "preferred_variant_id")

