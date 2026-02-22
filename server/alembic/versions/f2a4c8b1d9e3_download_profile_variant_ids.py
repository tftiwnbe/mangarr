"""add multi-variant selection for download profiles

Revision ID: f2a4c8b1d9e3
Revises: e1b6c4d2a9f8
Create Date: 2026-02-22 00:00:03.000000
"""

from collections.abc import Sequence

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = "f2a4c8b1d9e3"
down_revision: str | Sequence[str] | None = "e1b6c4d2a9f8"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def _has_column(table_name: str, column_name: str) -> bool:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    return any(
        str(column.get("name")) == column_name
        for column in inspector.get_columns(table_name)
    )


def _has_index(table_name: str, index_name: str) -> bool:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    return any(
        str(index.get("name")) == index_name
        for index in inspector.get_indexes(table_name)
    )


def upgrade() -> None:
    added_paused = False

    if not _has_column("download_profiles", "paused"):
        op.add_column(
            "download_profiles",
            sa.Column(
                "paused",
                sa.Boolean(),
                nullable=False,
                server_default=sa.text("0"),
            ),
        )
        added_paused = True

    if not _has_index("download_profiles", "ix_download_profiles_paused"):
        op.create_index(
            "ix_download_profiles_paused",
            "download_profiles",
            ["paused"],
            unique=False,
        )

    if not _has_column("download_profiles", "variant_ids_json"):
        op.add_column(
            "download_profiles",
            sa.Column("variant_ids_json", sa.Text(), nullable=True),
        )

    if _has_column("download_profiles", "variant_ids_json"):
        op.execute(
            """
            UPDATE download_profiles
            SET variant_ids_json = '[' || preferred_variant_id || ']'
            WHERE preferred_variant_id IS NOT NULL
              AND (variant_ids_json IS NULL OR TRIM(variant_ids_json) = '')
            """
        )

    if _has_column("download_profiles", "paused"):
        op.execute("UPDATE download_profiles SET paused = 0 WHERE paused IS NULL")

    if added_paused and op.get_bind().dialect.name != "sqlite":
        op.alter_column("download_profiles", "paused", server_default=None)


def downgrade() -> None:
    if _has_index("download_profiles", "ix_download_profiles_paused"):
        op.drop_index("ix_download_profiles_paused", table_name="download_profiles")
    if _has_column("download_profiles", "paused"):
        op.drop_column("download_profiles", "paused")
    if _has_column("download_profiles", "variant_ids_json"):
        op.drop_column("download_profiles", "variant_ids_json")
