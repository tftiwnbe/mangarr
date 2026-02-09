"""add downloads monitoring and queue schema

Revision ID: d4e1f6a2b8c0
Revises: a5d6c9e72f01
Create Date: 2026-02-08 23:30:00.000000
"""

from collections.abc import Sequence

from alembic import op
import sqlalchemy as sa
import sqlmodel


# revision identifiers, used by Alembic.
revision: str = "d4e1f6a2b8c0"
down_revision: str | Sequence[str] | None = "a5d6c9e72f01"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column("library_chapters", sa.Column("downloaded_at", sa.DateTime(), nullable=True))
    op.add_column(
        "library_chapters",
        sa.Column("download_path", sqlmodel.sql.sqltypes.AutoString(), nullable=True),
    )
    op.add_column(
        "library_chapters",
        sa.Column("download_error", sqlmodel.sql.sqltypes.AutoString(), nullable=True),
    )

    op.add_column(
        "library_chapter_pages",
        sa.Column("local_path", sqlmodel.sql.sqltypes.AutoString(), nullable=True),
    )
    op.add_column("library_chapter_pages", sa.Column("local_size", sa.Integer(), nullable=True))

    op.create_table(
        "download_profiles",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("library_title_id", sa.Integer(), nullable=False),
        sa.Column("enabled", sa.Boolean(), nullable=False),
        sa.Column("auto_download", sa.Boolean(), nullable=False),
        sa.Column("strategy", sa.Enum("NEW_ONLY", "ALL_UNREAD", name="downloadstrategy"), nullable=False),
        sa.Column("preferred_variant_id", sa.Integer(), nullable=True),
        sa.Column("start_from", sa.DateTime(), nullable=True),
        sa.Column("last_checked_at", sa.DateTime(), nullable=True),
        sa.Column("last_success_at", sa.DateTime(), nullable=True),
        sa.Column("last_error", sqlmodel.sql.sqltypes.AutoString(), nullable=True),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.Column("updated_at", sa.DateTime(), nullable=False),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("library_title_id", name="uq_download_profile_title"),
    )
    op.create_index(
        "ix_download_profiles_library_title_id",
        "download_profiles",
        ["library_title_id"],
        unique=False,
    )
    op.create_index(
        "ix_download_profiles_enabled", "download_profiles", ["enabled"], unique=False
    )
    op.create_index(
        "ix_download_profiles_preferred_variant_id",
        "download_profiles",
        ["preferred_variant_id"],
        unique=False,
    )

    op.create_table(
        "download_tasks",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("library_title_id", sa.Integer(), nullable=False),
        sa.Column("variant_id", sa.Integer(), nullable=True),
        sa.Column("chapter_id", sa.Integer(), nullable=False),
        sa.Column("source_id", sqlmodel.sql.sqltypes.AutoString(), nullable=False),
        sa.Column("chapter_url", sqlmodel.sql.sqltypes.AutoString(), nullable=False),
        sa.Column("title_name", sqlmodel.sql.sqltypes.AutoString(), nullable=False),
        sa.Column("chapter_name", sqlmodel.sql.sqltypes.AutoString(), nullable=False),
        sa.Column(
            "status",
            sa.Enum(
                "QUEUED",
                "DOWNLOADING",
                "COMPLETED",
                "FAILED",
                "CANCELLED",
                name="downloadtaskstatus",
            ),
            nullable=False,
        ),
        sa.Column("trigger", sa.Enum("MONITOR", "MANUAL", name="downloadtrigger"), nullable=False),
        sa.Column("priority", sa.Integer(), nullable=False),
        sa.Column("attempts", sa.Integer(), nullable=False),
        sa.Column("max_attempts", sa.Integer(), nullable=False),
        sa.Column("available_at", sa.DateTime(), nullable=False),
        sa.Column("downloaded_pages", sa.Integer(), nullable=False),
        sa.Column("total_pages", sa.Integer(), nullable=False),
        sa.Column("output_dir", sqlmodel.sql.sqltypes.AutoString(), nullable=True),
        sa.Column("error", sqlmodel.sql.sqltypes.AutoString(), nullable=True),
        sa.Column("started_at", sa.DateTime(), nullable=True),
        sa.Column("finished_at", sa.DateTime(), nullable=True),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.Column("updated_at", sa.DateTime(), nullable=False),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_download_tasks_library_title_id", "download_tasks", ["library_title_id"], unique=False)
    op.create_index("ix_download_tasks_variant_id", "download_tasks", ["variant_id"], unique=False)
    op.create_index("ix_download_tasks_chapter_id", "download_tasks", ["chapter_id"], unique=False)
    op.create_index("ix_download_tasks_source_id", "download_tasks", ["source_id"], unique=False)
    op.create_index("ix_download_tasks_status", "download_tasks", ["status"], unique=False)
    op.create_index("ix_download_tasks_priority", "download_tasks", ["priority"], unique=False)
    op.create_index("ix_download_tasks_available_at", "download_tasks", ["available_at"], unique=False)


def downgrade() -> None:
    op.drop_index("ix_download_tasks_available_at", table_name="download_tasks")
    op.drop_index("ix_download_tasks_priority", table_name="download_tasks")
    op.drop_index("ix_download_tasks_status", table_name="download_tasks")
    op.drop_index("ix_download_tasks_source_id", table_name="download_tasks")
    op.drop_index("ix_download_tasks_chapter_id", table_name="download_tasks")
    op.drop_index("ix_download_tasks_variant_id", table_name="download_tasks")
    op.drop_index("ix_download_tasks_library_title_id", table_name="download_tasks")
    op.drop_table("download_tasks")

    op.drop_index("ix_download_profiles_preferred_variant_id", table_name="download_profiles")
    op.drop_index("ix_download_profiles_enabled", table_name="download_profiles")
    op.drop_index("ix_download_profiles_library_title_id", table_name="download_profiles")
    op.drop_table("download_profiles")

    op.drop_column("library_chapter_pages", "local_size")
    op.drop_column("library_chapter_pages", "local_path")

    op.drop_column("library_chapters", "download_error")
    op.drop_column("library_chapters", "download_path")
    op.drop_column("library_chapters", "downloaded_at")
