"""download task attempt lineage

Revision ID: 4f1a9b6c7d82
Revises: bb9a1c2d3e44
Create Date: 2026-02-27 20:15:00.000000
"""

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision = "4f1a9b6c7d82"
down_revision = "bb9a1c2d3e44"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "download_tasks", sa.Column("attempt_group_id", sa.Integer(), nullable=True)
    )
    op.add_column(
        "download_tasks", sa.Column("retry_of_task_id", sa.Integer(), nullable=True)
    )

    op.execute(
        sa.text(
            "UPDATE download_tasks SET attempt_group_id = id WHERE attempt_group_id IS NULL"
        )
    )

    op.create_index(
        "ix_download_tasks_attempt_group_id",
        "download_tasks",
        ["attempt_group_id"],
        unique=False,
    )
    op.create_index(
        "ix_download_tasks_retry_of_task_id",
        "download_tasks",
        ["retry_of_task_id"],
        unique=False,
    )


def downgrade() -> None:
    op.drop_index("ix_download_tasks_retry_of_task_id", table_name="download_tasks")
    op.drop_index("ix_download_tasks_attempt_group_id", table_name="download_tasks")

    op.drop_column("download_tasks", "retry_of_task_id")
    op.drop_column("download_tasks", "attempt_group_id")
