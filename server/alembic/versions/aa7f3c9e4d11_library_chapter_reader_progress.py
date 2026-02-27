"""library chapter reader progress and comments

Revision ID: aa7f3c9e4d11
Revises: b8f1d4e7c2a0
Create Date: 2026-02-23 11:10:00.000000
"""

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision = "aa7f3c9e4d11"
down_revision = "b8f1d4e7c2a0"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("library_chapters", sa.Column("reader_page_index", sa.Integer(), nullable=True))
    op.add_column("library_chapters", sa.Column("reader_comment", sa.Text(), nullable=True))
    op.add_column("library_chapters", sa.Column("reader_updated_at", sa.DateTime(), nullable=True))
    op.create_index(
        "ix_library_chapters_reader_page_index",
        "library_chapters",
        ["reader_page_index"],
        unique=False,
    )


def downgrade() -> None:
    op.drop_index("ix_library_chapters_reader_page_index", table_name="library_chapters")
    op.drop_column("library_chapters", "reader_updated_at")
    op.drop_column("library_chapters", "reader_comment")
    op.drop_column("library_chapters", "reader_page_index")
