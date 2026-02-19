"""split sessions and integration api keys

Revision ID: f58a6bc9d210
Revises: e3f9a1c62c7f
Create Date: 2026-02-19 00:00:00.000000
"""

from collections.abc import Sequence

from alembic import op
import sqlalchemy as sa
import sqlmodel


# revision identifiers, used by Alembic.
revision: str = "f58a6bc9d210"
down_revision: str | Sequence[str] | None = "e3f9a1c62c7f"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "auth_sessions",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("user_id", sa.Integer(), nullable=False),
        sa.Column("token_hash", sqlmodel.sql.sqltypes.AutoString(), nullable=False),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.Column("last_used_at", sa.DateTime(), nullable=True),
        sa.Column("revoked_at", sa.DateTime(), nullable=True),
        sa.Column("expires_at", sa.DateTime(), nullable=True),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"]),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_auth_sessions_user_id", "auth_sessions", ["user_id"], unique=False)
    op.create_index(
        "ix_auth_sessions_token_hash", "auth_sessions", ["token_hash"], unique=True
    )

    op.create_table(
        "integration_api_keys",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("user_id", sa.Integer(), nullable=False),
        sa.Column("name", sqlmodel.sql.sqltypes.AutoString(), nullable=False),
        sa.Column("key_hash", sqlmodel.sql.sqltypes.AutoString(), nullable=False),
        sa.Column("key_prefix", sqlmodel.sql.sqltypes.AutoString(), nullable=False),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.Column("last_used_at", sa.DateTime(), nullable=True),
        sa.Column("revoked_at", sa.DateTime(), nullable=True),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"]),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(
        "ix_integration_api_keys_user_id", "integration_api_keys", ["user_id"], unique=False
    )
    op.create_index(
        "ix_integration_api_keys_key_hash",
        "integration_api_keys",
        ["key_hash"],
        unique=True,
    )

    connection = op.get_bind()
    users_table = sa.table(
        "users",
        sa.column("id", sa.Integer()),
        sa.column("api_key_hash", sa.String()),
        sa.column("created_at", sa.DateTime()),
        sa.column("last_api_key_rotated_at", sa.DateTime()),
    )
    integration_keys_table = sa.table(
        "integration_api_keys",
        sa.column("user_id", sa.Integer()),
        sa.column("name", sa.String()),
        sa.column("key_hash", sa.String()),
        sa.column("key_prefix", sa.String()),
        sa.column("created_at", sa.DateTime()),
        sa.column("last_used_at", sa.DateTime()),
        sa.column("revoked_at", sa.DateTime()),
    )

    rows = connection.execute(
        sa.select(
            users_table.c.id,
            users_table.c.api_key_hash,
            users_table.c.created_at,
            users_table.c.last_api_key_rotated_at,
        )
    ).fetchall()

    for row in rows:
        if not row.api_key_hash:
            continue
        created_at = row.last_api_key_rotated_at or row.created_at
        connection.execute(
            sa.insert(integration_keys_table).values(
                user_id=row.id,
                name="migrated-legacy-key",
                key_hash=row.api_key_hash,
                key_prefix=f"legacy-{row.id}",
                created_at=created_at,
                last_used_at=None,
                revoked_at=None,
            )
        )


def downgrade() -> None:
    op.drop_index("ix_integration_api_keys_key_hash", table_name="integration_api_keys")
    op.drop_index("ix_integration_api_keys_user_id", table_name="integration_api_keys")
    op.drop_table("integration_api_keys")
    op.drop_index("ix_auth_sessions_token_hash", table_name="auth_sessions")
    op.drop_index("ix_auth_sessions_user_id", table_name="auth_sessions")
    op.drop_table("auth_sessions")
