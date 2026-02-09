"""add users auth schema

Revision ID: e3f9a1c62c7f
Revises: d4e1f6a2b8c0
Create Date: 2026-02-09 01:10:00.000000
"""

from collections.abc import Sequence

from alembic import op
import sqlalchemy as sa
import sqlmodel


# revision identifiers, used by Alembic.
revision: str = "e3f9a1c62c7f"
down_revision: str | Sequence[str] | None = "d4e1f6a2b8c0"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "users",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("username", sqlmodel.sql.sqltypes.AutoString(), nullable=False),
        sa.Column("password_hash", sqlmodel.sql.sqltypes.AutoString(), nullable=False),
        sa.Column("api_key_hash", sqlmodel.sql.sqltypes.AutoString(), nullable=False),
        sa.Column("is_admin", sa.Boolean(), nullable=False),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.Column("updated_at", sa.DateTime(), nullable=False),
        sa.Column("last_login_at", sa.DateTime(), nullable=True),
        sa.Column("last_api_key_rotated_at", sa.DateTime(), nullable=True),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_users_username", "users", ["username"], unique=True)
    op.create_index("ix_users_api_key_hash", "users", ["api_key_hash"], unique=True)


def downgrade() -> None:
    op.drop_index("ix_users_api_key_hash", table_name="users")
    op.drop_index("ix_users_username", table_name="users")
    op.drop_table("users")
