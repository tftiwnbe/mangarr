"""normalize selected download profile variants

Revision ID: 5f3c2a1b7e9d
Revises: 4f1a9b6c7d82
Create Date: 2026-03-07 18:10:00.000000
"""

from collections.abc import Sequence
import json

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = "5f3c2a1b7e9d"
down_revision: str | Sequence[str] | None = "4f1a9b6c7d82"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def _has_table(table_name: str) -> bool:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    return table_name in inspector.get_table_names()


def upgrade() -> None:
    if not _has_table("download_profile_variants"):
        op.create_table(
            "download_profile_variants",
            sa.Column("id", sa.Integer(), primary_key=True, nullable=False),
            sa.Column("profile_id", sa.Integer(), nullable=False),
            sa.Column("variant_id", sa.Integer(), nullable=False),
            sa.Column(
                "position", sa.Integer(), nullable=False, server_default=sa.text("0")
            ),
            sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
            sa.ForeignKeyConstraint(["profile_id"], ["download_profiles.id"]),
            sa.UniqueConstraint(
                "profile_id", "variant_id", name="uq_download_profile_variant"
            ),
        )
        op.create_index(
            "ix_download_profile_variants_profile_id",
            "download_profile_variants",
            ["profile_id"],
            unique=False,
        )
        op.create_index(
            "ix_download_profile_variants_variant_id",
            "download_profile_variants",
            ["variant_id"],
            unique=False,
        )
        op.create_index(
            "ix_download_profile_variants_position",
            "download_profile_variants",
            ["position"],
            unique=False,
        )

    bind = op.get_bind()
    rows = bind.execute(
        sa.text(
            """
            SELECT id, preferred_variant_id, variant_ids_json, created_at
            FROM download_profiles
            ORDER BY id
            """
        )
    ).fetchall()

    for row in rows:
        variant_ids: list[int] = []
        if row.variant_ids_json:
            try:
                loaded = json.loads(row.variant_ids_json)
            except Exception:
                loaded = None
            if isinstance(loaded, list):
                seen: set[int] = set()
                for raw in loaded:
                    try:
                        variant_id = int(raw)
                    except (TypeError, ValueError):
                        continue
                    if variant_id <= 0 or variant_id in seen:
                        continue
                    seen.add(variant_id)
                    variant_ids.append(variant_id)

        if not variant_ids and row.preferred_variant_id is not None:
            try:
                preferred_variant_id = int(row.preferred_variant_id)
            except (TypeError, ValueError):
                preferred_variant_id = 0
            if preferred_variant_id > 0:
                variant_ids = [preferred_variant_id]

        for position, variant_id in enumerate(variant_ids):
            bind.execute(
                sa.text(
                    """
                    INSERT INTO download_profile_variants
                        (profile_id, variant_id, position, created_at)
                    VALUES
                        (:profile_id, :variant_id, :position, :created_at)
                    ON CONFLICT(profile_id, variant_id) DO NOTHING
                    """
                ),
                {
                    "profile_id": int(row.id),
                    "variant_id": variant_id,
                    "position": position,
                    "created_at": row.created_at,
                },
            )


def downgrade() -> None:
    if _has_table("download_profile_variants"):
        op.drop_index(
            "ix_download_profile_variants_position",
            table_name="download_profile_variants",
        )
        op.drop_index(
            "ix_download_profile_variants_variant_id",
            table_name="download_profile_variants",
        )
        op.drop_index(
            "ix_download_profile_variants_profile_id",
            table_name="download_profile_variants",
        )
        op.drop_table("download_profile_variants")
