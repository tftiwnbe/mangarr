"""add explore title details cache

Revision ID: 9c6e2f4a7b31
Revises: f58a6bc9d210
Create Date: 2026-02-20 00:00:00.000000
"""

from collections.abc import Sequence

from alembic import op
import sqlalchemy as sa
import sqlmodel


# revision identifiers, used by Alembic.
revision: str = "9c6e2f4a7b31"
down_revision: str | Sequence[str] | None = "f58a6bc9d210"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "explore_title_details_cache",
        sa.Column("source_id", sqlmodel.sql.sqltypes.AutoString(), nullable=False),
        sa.Column("title_url", sqlmodel.sql.sqltypes.AutoString(), nullable=False),
        sa.Column("title", sqlmodel.sql.sqltypes.AutoString(), nullable=False),
        sa.Column("status", sa.Integer(), nullable=False),
        sa.Column("thumbnail_url", sqlmodel.sql.sqltypes.AutoString(), nullable=False),
        sa.Column("artist", sqlmodel.sql.sqltypes.AutoString(), nullable=True),
        sa.Column("author", sqlmodel.sql.sqltypes.AutoString(), nullable=True),
        sa.Column("description", sqlmodel.sql.sqltypes.AutoString(), nullable=True),
        sa.Column("genre", sqlmodel.sql.sqltypes.AutoString(), nullable=True),
        sa.Column("fetched_at", sa.DateTime(), nullable=False),
        sa.PrimaryKeyConstraint("source_id", "title_url"),
    )
    op.create_index(
        "ix_explore_title_details_cache_fetched_at",
        "explore_title_details_cache",
        ["fetched_at"],
        unique=False,
    )


def downgrade() -> None:
    op.drop_index(
        "ix_explore_title_details_cache_fetched_at",
        table_name="explore_title_details_cache",
    )
    op.drop_table("explore_title_details_cache")
