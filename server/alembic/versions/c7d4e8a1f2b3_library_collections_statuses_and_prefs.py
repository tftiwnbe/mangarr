"""library collections, user statuses, and title preferences

Revision ID: c7d4e8a1f2b3
Revises: 9c6e2f4a7b31
Create Date: 2026-02-20 00:00:01.000000
"""

from collections.abc import Sequence
from datetime import datetime, timezone

from alembic import op
import sqlalchemy as sa
import sqlmodel


# revision identifiers, used by Alembic.
revision: str = "c7d4e8a1f2b3"
down_revision: str | Sequence[str] | None = "9c6e2f4a7b31"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "library_user_statuses",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("key", sqlmodel.sql.sqltypes.AutoString(), nullable=False),
        sa.Column("label", sqlmodel.sql.sqltypes.AutoString(), nullable=False),
        sa.Column("color", sqlmodel.sql.sqltypes.AutoString(), nullable=False),
        sa.Column("position", sa.Integer(), nullable=False),
        sa.Column("is_default", sa.Boolean(), nullable=False),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.Column("updated_at", sa.DateTime(), nullable=False),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("key"),
    )
    op.create_index(
        "ix_library_user_statuses_key",
        "library_user_statuses",
        ["key"],
        unique=True,
    )

    now = datetime.now(timezone.utc)
    statuses = sa.table(
        "library_user_statuses",
        sa.column("key", sa.String()),
        sa.column("label", sa.String()),
        sa.column("color", sa.String()),
        sa.column("position", sa.Integer()),
        sa.column("is_default", sa.Boolean()),
        sa.column("created_at", sa.DateTime()),
        sa.column("updated_at", sa.DateTime()),
    )
    op.bulk_insert(
        statuses,
        [
            {
                "key": "reading",
                "label": "Reading",
                "color": "#4ade80",
                "position": 1,
                "is_default": True,
                "created_at": now,
                "updated_at": now,
            },
            {
                "key": "completed",
                "label": "Completed",
                "color": "#a3a3a3",
                "position": 2,
                "is_default": True,
                "created_at": now,
                "updated_at": now,
            },
            {
                "key": "on_hold",
                "label": "On Hold",
                "color": "#facc15",
                "position": 3,
                "is_default": True,
                "created_at": now,
                "updated_at": now,
            },
            {
                "key": "dropped",
                "label": "Dropped",
                "color": "#f87171",
                "position": 4,
                "is_default": True,
                "created_at": now,
                "updated_at": now,
            },
            {
                "key": "plan_to_read",
                "label": "Plan to Read",
                "color": "#60a5fa",
                "position": 5,
                "is_default": True,
                "created_at": now,
                "updated_at": now,
            },
        ],
    )

    op.create_table(
        "library_collections",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("name", sqlmodel.sql.sqltypes.AutoString(), nullable=False),
        sa.Column("description", sqlmodel.sql.sqltypes.AutoString(), nullable=True),
        sa.Column("color", sqlmodel.sql.sqltypes.AutoString(), nullable=False),
        sa.Column("position", sa.Integer(), nullable=False),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.Column("updated_at", sa.DateTime(), nullable=False),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("name"),
    )
    op.create_index(
        "ix_library_collections_name",
        "library_collections",
        ["name"],
        unique=True,
    )

    op.create_table(
        "library_collection_titles",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("collection_id", sa.Integer(), nullable=False),
        sa.Column("library_title_id", sa.Integer(), nullable=False),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.ForeignKeyConstraint(["collection_id"], ["library_collections.id"]),
        sa.ForeignKeyConstraint(["library_title_id"], ["library_titles.id"]),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint(
            "collection_id", "library_title_id", name="uq_collection_title"
        ),
    )
    op.create_index(
        "ix_library_collection_titles_collection_id",
        "library_collection_titles",
        ["collection_id"],
        unique=False,
    )
    op.create_index(
        "ix_library_collection_titles_library_title_id",
        "library_collection_titles",
        ["library_title_id"],
        unique=False,
    )

    op.add_column(
        "library_titles",
        sa.Column("user_status_id", sa.Integer(), nullable=True),
    )
    op.add_column(
        "library_titles",
        sa.Column("user_rating", sa.Float(), nullable=True),
    )
    op.create_index(
        "ix_library_titles_user_status_id",
        "library_titles",
        ["user_status_id"],
        unique=False,
    )


def downgrade() -> None:
    op.drop_index("ix_library_titles_user_status_id", table_name="library_titles")
    op.drop_column("library_titles", "user_rating")
    op.drop_column("library_titles", "user_status_id")

    op.drop_index(
        "ix_library_collection_titles_library_title_id",
        table_name="library_collection_titles",
    )
    op.drop_index(
        "ix_library_collection_titles_collection_id",
        table_name="library_collection_titles",
    )
    op.drop_table("library_collection_titles")

    op.drop_index("ix_library_collections_name", table_name="library_collections")
    op.drop_table("library_collections")

    op.drop_index("ix_library_user_statuses_key", table_name="library_user_statuses")
    op.drop_table("library_user_statuses")
