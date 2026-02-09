"""hybrid discover cache and library schema

Revision ID: a5d6c9e72f01
Revises: b223ac982e55
Create Date: 2026-02-08 17:20:00.000000
"""

from collections.abc import Sequence

from alembic import op
import sqlalchemy as sa
import sqlmodel


# revision identifiers, used by Alembic.
revision: str = "a5d6c9e72f01"
down_revision: str | Sequence[str] | None = "b223ac982e55"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    # Drop legacy title aggregation schema.
    op.drop_table("source_titles")
    op.drop_table("fetched_pages")
    op.drop_table("canonical_title")

    # Rebuild sources table with a stable primary key on source id.
    op.create_table(
        "sources_new",
        sa.Column("id", sqlmodel.sql.sqltypes.AutoString(), nullable=False),
        sa.Column("name", sqlmodel.sql.sqltypes.AutoString(), nullable=False),
        sa.Column("lang", sqlmodel.sql.sqltypes.AutoString(), nullable=False),
        sa.Column("base_url", sqlmodel.sql.sqltypes.AutoString(), nullable=True),
        sa.Column("supports_latest", sa.Boolean(), nullable=True),
        sa.Column("extension_pkg", sqlmodel.sql.sqltypes.AutoString(), nullable=False),
        sa.Column("enabled", sa.Boolean(), nullable=False),
        sa.ForeignKeyConstraint(["extension_pkg"], ["extensions.pkg"]),
        sa.PrimaryKeyConstraint("id"),
    )
    op.execute(
        """
        INSERT INTO sources_new (id, name, lang, base_url, supports_latest, extension_pkg, enabled)
        SELECT id, name, lang, base_url, supports_latest, extension_pkg, enabled
        FROM sources
        """
    )
    op.drop_table("sources")
    op.rename_table("sources_new", "sources")

    # Discover cache pages/items.
    op.create_table(
        "discover_cache_pages",
        sa.Column("section", sqlmodel.sql.sqltypes.AutoString(), nullable=False),
        sa.Column("source_id", sqlmodel.sql.sqltypes.AutoString(), nullable=False),
        sa.Column("page", sa.Integer(), nullable=False),
        sa.Column("fetched_at", sa.DateTime(), nullable=False),
        sa.Column("has_next_page", sa.Boolean(), nullable=False),
        sa.Column("item_count", sa.Integer(), nullable=False),
        sa.PrimaryKeyConstraint("section", "source_id", "page"),
    )
    op.create_table(
        "discover_cache_items",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("section", sqlmodel.sql.sqltypes.AutoString(), nullable=False),
        sa.Column("source_id", sqlmodel.sql.sqltypes.AutoString(), nullable=False),
        sa.Column("page", sa.Integer(), nullable=False),
        sa.Column("rank", sa.Integer(), nullable=False),
        sa.Column("dedupe_key", sqlmodel.sql.sqltypes.AutoString(), nullable=False),
        sa.Column("title_url", sqlmodel.sql.sqltypes.AutoString(), nullable=False),
        sa.Column("title", sqlmodel.sql.sqltypes.AutoString(), nullable=False),
        sa.Column("thumbnail_url", sqlmodel.sql.sqltypes.AutoString(), nullable=False),
        sa.Column("artist", sqlmodel.sql.sqltypes.AutoString(), nullable=True),
        sa.Column("author", sqlmodel.sql.sqltypes.AutoString(), nullable=True),
        sa.Column("description", sqlmodel.sql.sqltypes.AutoString(), nullable=True),
        sa.Column("genre", sqlmodel.sql.sqltypes.AutoString(), nullable=True),
        sa.Column("status", sa.Integer(), nullable=False),
        sa.Column("fetched_at", sa.DateTime(), nullable=False),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint(
            "section",
            "source_id",
            "page",
            "rank",
            name="uq_discover_cache_items_rank",
        ),
    )
    op.create_index(
        "ix_discover_cache_items_section", "discover_cache_items", ["section"], unique=False
    )
    op.create_index(
        "ix_discover_cache_items_source_id",
        "discover_cache_items",
        ["source_id"],
        unique=False,
    )
    op.create_index(
        "ix_discover_cache_items_page", "discover_cache_items", ["page"], unique=False
    )
    op.create_index(
        "ix_discover_cache_items_dedupe_key",
        "discover_cache_items",
        ["dedupe_key"],
        unique=False,
    )

    # Library canonical schema.
    op.create_table(
        "library_titles",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("canonical_key", sqlmodel.sql.sqltypes.AutoString(), nullable=False),
        sa.Column("title", sqlmodel.sql.sqltypes.AutoString(), nullable=False),
        sa.Column("thumbnail_url", sqlmodel.sql.sqltypes.AutoString(), nullable=False),
        sa.Column("description", sqlmodel.sql.sqltypes.AutoString(), nullable=True),
        sa.Column("artist", sqlmodel.sql.sqltypes.AutoString(), nullable=True),
        sa.Column("author", sqlmodel.sql.sqltypes.AutoString(), nullable=True),
        sa.Column("genre", sqlmodel.sql.sqltypes.AutoString(), nullable=True),
        sa.Column("status", sa.Integer(), nullable=False),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.Column("updated_at", sa.DateTime(), nullable=False),
        sa.Column("last_refreshed_at", sa.DateTime(), nullable=True),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(
        "ix_library_titles_canonical_key", "library_titles", ["canonical_key"], unique=False
    )

    op.create_table(
        "library_title_variants",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("library_title_id", sa.Integer(), nullable=False),
        sa.Column("source_id", sqlmodel.sql.sqltypes.AutoString(), nullable=False),
        sa.Column("source_name", sqlmodel.sql.sqltypes.AutoString(), nullable=True),
        sa.Column("source_lang", sqlmodel.sql.sqltypes.AutoString(), nullable=True),
        sa.Column("title_url", sqlmodel.sql.sqltypes.AutoString(), nullable=False),
        sa.Column("title", sqlmodel.sql.sqltypes.AutoString(), nullable=False),
        sa.Column("thumbnail_url", sqlmodel.sql.sqltypes.AutoString(), nullable=False),
        sa.Column("description", sqlmodel.sql.sqltypes.AutoString(), nullable=True),
        sa.Column("artist", sqlmodel.sql.sqltypes.AutoString(), nullable=True),
        sa.Column("author", sqlmodel.sql.sqltypes.AutoString(), nullable=True),
        sa.Column("genre", sqlmodel.sql.sqltypes.AutoString(), nullable=True),
        sa.Column("status", sa.Integer(), nullable=False),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.Column("updated_at", sa.DateTime(), nullable=False),
        sa.Column("last_synced_at", sa.DateTime(), nullable=True),
        sa.ForeignKeyConstraint(["library_title_id"], ["library_titles.id"]),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint(
            "source_id", "title_url", name="uq_library_variant_source_title"
        ),
    )
    op.create_index(
        "ix_library_title_variants_library_title_id",
        "library_title_variants",
        ["library_title_id"],
        unique=False,
    )
    op.create_index(
        "ix_library_title_variants_source_id",
        "library_title_variants",
        ["source_id"],
        unique=False,
    )

    op.create_table(
        "library_chapters",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("library_title_id", sa.Integer(), nullable=False),
        sa.Column("variant_id", sa.Integer(), nullable=False),
        sa.Column("chapter_url", sqlmodel.sql.sqltypes.AutoString(), nullable=False),
        sa.Column("name", sqlmodel.sql.sqltypes.AutoString(), nullable=False),
        sa.Column("chapter_number", sa.Float(), nullable=False),
        sa.Column("scanlator", sqlmodel.sql.sqltypes.AutoString(), nullable=True),
        sa.Column("date_upload", sa.DateTime(), nullable=False),
        sa.Column("position", sa.Integer(), nullable=False),
        sa.Column("is_read", sa.Boolean(), nullable=False),
        sa.Column("is_downloaded", sa.Boolean(), nullable=False),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.Column("updated_at", sa.DateTime(), nullable=False),
        sa.Column("last_synced_at", sa.DateTime(), nullable=True),
        sa.ForeignKeyConstraint(["library_title_id"], ["library_titles.id"]),
        sa.ForeignKeyConstraint(["variant_id"], ["library_title_variants.id"]),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint(
            "variant_id", "chapter_url", name="uq_library_chapter_variant_url"
        ),
    )
    op.create_index(
        "ix_library_chapters_library_title_id",
        "library_chapters",
        ["library_title_id"],
        unique=False,
    )
    op.create_index(
        "ix_library_chapters_variant_id",
        "library_chapters",
        ["variant_id"],
        unique=False,
    )
    op.create_index(
        "ix_library_chapters_is_read", "library_chapters", ["is_read"], unique=False
    )
    op.create_index(
        "ix_library_chapters_is_downloaded",
        "library_chapters",
        ["is_downloaded"],
        unique=False,
    )

    op.create_table(
        "library_chapter_pages",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("chapter_id", sa.Integer(), nullable=False),
        sa.Column("page_index", sa.Integer(), nullable=False),
        sa.Column("url", sqlmodel.sql.sqltypes.AutoString(), nullable=False),
        sa.Column("image_url", sqlmodel.sql.sqltypes.AutoString(), nullable=False),
        sa.Column("fetched_at", sa.DateTime(), nullable=False),
        sa.ForeignKeyConstraint(["chapter_id"], ["library_chapters.id"]),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint(
            "chapter_id", "page_index", name="uq_library_page_chapter_index"
        ),
    )
    op.create_index(
        "ix_library_chapter_pages_chapter_id",
        "library_chapter_pages",
        ["chapter_id"],
        unique=False,
    )


def downgrade() -> None:
    op.drop_index("ix_library_chapter_pages_chapter_id", table_name="library_chapter_pages")
    op.drop_table("library_chapter_pages")
    op.drop_index("ix_library_chapters_is_downloaded", table_name="library_chapters")
    op.drop_index("ix_library_chapters_is_read", table_name="library_chapters")
    op.drop_index("ix_library_chapters_variant_id", table_name="library_chapters")
    op.drop_index("ix_library_chapters_library_title_id", table_name="library_chapters")
    op.drop_table("library_chapters")
    op.drop_index(
        "ix_library_title_variants_source_id", table_name="library_title_variants"
    )
    op.drop_index(
        "ix_library_title_variants_library_title_id",
        table_name="library_title_variants",
    )
    op.drop_table("library_title_variants")
    op.drop_index("ix_library_titles_canonical_key", table_name="library_titles")
    op.drop_table("library_titles")

    op.drop_index("ix_discover_cache_items_dedupe_key", table_name="discover_cache_items")
    op.drop_index("ix_discover_cache_items_page", table_name="discover_cache_items")
    op.drop_index("ix_discover_cache_items_source_id", table_name="discover_cache_items")
    op.drop_index("ix_discover_cache_items_section", table_name="discover_cache_items")
    op.drop_table("discover_cache_items")
    op.drop_table("discover_cache_pages")

    # restore original sources schema
    op.create_table(
        "sources_old",
        sa.Column("id", sqlmodel.sql.sqltypes.AutoString(), nullable=False),
        sa.Column("name", sqlmodel.sql.sqltypes.AutoString(), nullable=False),
        sa.Column("lang", sqlmodel.sql.sqltypes.AutoString(), nullable=False),
        sa.Column("base_url", sqlmodel.sql.sqltypes.AutoString(), nullable=True),
        sa.Column("supports_latest", sa.Boolean(), nullable=True),
        sa.Column("extension_pkg", sqlmodel.sql.sqltypes.AutoString(), nullable=False),
        sa.Column("enabled", sa.Boolean(), nullable=False),
        sa.ForeignKeyConstraint(["extension_pkg"], ["extensions.pkg"]),
        sa.PrimaryKeyConstraint("id", "extension_pkg"),
    )
    op.execute(
        """
        INSERT INTO sources_old (id, name, lang, base_url, supports_latest, extension_pkg, enabled)
        SELECT id, name, lang, base_url, supports_latest, extension_pkg, enabled
        FROM sources
        """
    )
    op.drop_table("sources")
    op.rename_table("sources_old", "sources")

    # restore legacy discover/title tables
    op.create_table(
        "canonical_title",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("title", sqlmodel.sql.sqltypes.AutoString(), nullable=False),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_table(
        "fetched_pages",
        sa.Column("source_id", sqlmodel.sql.sqltypes.AutoString(), nullable=False),
        sa.Column("section", sqlmodel.sql.sqltypes.AutoString(), nullable=False),
        sa.Column("page", sa.Integer(), nullable=False),
        sa.Column("fetched_at", sa.DateTime(), nullable=False),
        sa.Column("title_count", sa.Integer(), nullable=False),
        sa.Column("has_next_page", sa.Boolean(), nullable=False),
        sa.PrimaryKeyConstraint("source_id", "section", "page"),
    )
    op.create_table(
        "source_titles",
        sa.Column("url", sqlmodel.sql.sqltypes.AutoString(), nullable=False),
        sa.Column("title", sqlmodel.sql.sqltypes.AutoString(), nullable=False),
        sa.Column(
            "status",
            sa.Enum(
                "UNKNOWN",
                "ONGOING",
                "COMPLETED",
                "LICENSED",
                "PUBLISHING_FINISHED",
                "CANCELLED",
                "ON_HIATUS",
                name="status",
            ),
            nullable=False,
        ),
        sa.Column("thumbnail_url", sqlmodel.sql.sqltypes.AutoString(), nullable=False),
        sa.Column("artist", sqlmodel.sql.sqltypes.AutoString(), nullable=True),
        sa.Column("author", sqlmodel.sql.sqltypes.AutoString(), nullable=True),
        sa.Column("description", sqlmodel.sql.sqltypes.AutoString(), nullable=True),
        sa.Column("genre", sqlmodel.sql.sqltypes.AutoString(), nullable=True),
        sa.Column("source_id", sqlmodel.sql.sqltypes.AutoString(), nullable=False),
        sa.Column("canonical_title_id", sa.Integer(), nullable=False),
        sa.ForeignKeyConstraint(["canonical_title_id"], ["canonical_title.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["source_id"], ["sources.id"]),
        sa.PrimaryKeyConstraint("url"),
    )
