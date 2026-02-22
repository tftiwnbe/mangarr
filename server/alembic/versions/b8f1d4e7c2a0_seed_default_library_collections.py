"""seed default library collections

Revision ID: b8f1d4e7c2a0
Revises: f2a4c8b1d9e3
Create Date: 2026-02-22 00:00:04.000000
"""

from collections.abc import Sequence
from datetime import datetime, timezone

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = "b8f1d4e7c2a0"
down_revision: str | Sequence[str] | None = "f2a4c8b1d9e3"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    conn = op.get_bind()
    total = conn.execute(sa.text("SELECT COUNT(1) FROM library_collections")).scalar()
    if int(total or 0) > 0:
        return

    now = datetime.now(timezone.utc)
    collections = sa.table(
        "library_collections",
        sa.column("name", sa.String()),
        sa.column("description", sa.String()),
        sa.column("color", sa.String()),
        sa.column("position", sa.Integer()),
        sa.column("created_at", sa.DateTime()),
        sa.column("updated_at", sa.DateTime()),
    )
    op.bulk_insert(
        collections,
        [
            {
                "name": "Favorites",
                "description": "Top picks",
                "color": "#71717a",
                "position": 1,
                "created_at": now,
                "updated_at": now,
            },
            {
                "name": "Queue",
                "description": "Read next",
                "color": "#71717a",
                "position": 2,
                "created_at": now,
                "updated_at": now,
            },
            {
                "name": "Archive",
                "description": "Saved for later",
                "color": "#71717a",
                "position": 3,
                "created_at": now,
                "updated_at": now,
            },
        ],
    )


def downgrade() -> None:
    op.execute(
        """
        DELETE FROM library_collection_titles
        WHERE collection_id IN (
            SELECT id
            FROM library_collections
            WHERE name IN ('Favorites', 'Queue', 'Archive')
        )
        """
    )
    op.execute(
        """
        DELETE FROM library_collections
        WHERE name IN ('Favorites', 'Queue', 'Archive')
        """
    )
