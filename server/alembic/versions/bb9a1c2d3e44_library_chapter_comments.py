"""library chapter comments

Revision ID: bb9a1c2d3e44
Revises: aa7f3c9e4d11
Create Date: 2026-02-23 12:10:00.000000
"""

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision = "bb9a1c2d3e44"
down_revision = "aa7f3c9e4d11"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "library_chapter_comments",
        sa.Column("id", sa.Integer(), primary_key=True, nullable=False),
        sa.Column(
            "chapter_id",
            sa.Integer(),
            sa.ForeignKey("library_chapters.id"),
            nullable=False,
        ),
        sa.Column(
            "page_index", sa.Integer(), nullable=False, server_default=sa.text("0")
        ),
        sa.Column("message", sa.Text(), nullable=False),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.Column("updated_at", sa.DateTime(), nullable=False),
    )
    op.create_index(
        "ix_library_chapter_comments_chapter_id",
        "library_chapter_comments",
        ["chapter_id"],
        unique=False,
    )
    op.create_index(
        "ix_library_chapter_comments_created_at",
        "library_chapter_comments",
        ["created_at"],
        unique=False,
    )


def downgrade() -> None:
    op.drop_index(
        "ix_library_chapter_comments_created_at", table_name="library_chapter_comments"
    )
    op.drop_index(
        "ix_library_chapter_comments_chapter_id", table_name="library_chapter_comments"
    )
    op.drop_table("library_chapter_comments")
