"""drop_user_api_key_hash

Revision ID: 001_drop_api_key
Revises: 000_initial
Create Date: 2026-03-09 00:00:00.000000

"""

from collections.abc import Sequence

from alembic import op


# revision identifiers, used by Alembic.
revision: str = "001_drop_api_key"
down_revision: str | Sequence[str] | None = "000_initial"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    # SQLite does not support DROP COLUMN natively before 3.35.0.
    # Use Alembic batch mode which recreates the table transparently.
    with op.batch_alter_table("users") as batch:
        batch.drop_index("ix_users_api_key_hash")
        batch.drop_column("api_key_hash")
        batch.drop_column("last_api_key_rotated_at")


def downgrade() -> None:
    raise NotImplementedError(
        "Downgrade is not supported: dropped API key hashes cannot be reconstructed."
    )
