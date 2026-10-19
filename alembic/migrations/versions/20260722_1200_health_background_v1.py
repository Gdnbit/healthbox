"""Add immutable, versioned household health background entries.

Revision ID: health_background_v1
Revises: backup_restore_health
Create Date: 2026-07-22 12:00:00
"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "health_background_v1"
down_revision: Union[str, None] = "backup_restore_health"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "health_background_entries",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("patient_id", sa.Integer(), nullable=False),
        sa.Column("created_by_user_id", sa.Integer(), nullable=False),
        sa.Column("record_key", sa.String(length=36), nullable=False),
        sa.Column("version_number", sa.Integer(), nullable=False),
        sa.Column("supersedes_entry_id", sa.Integer(), nullable=True),
        sa.Column("category", sa.String(length=50), nullable=False),
        sa.Column("title", sa.String(length=255), nullable=False),
        sa.Column("narrative", sa.Text(), nullable=False),
        sa.Column("effective_date", sa.Date(), nullable=True),
        sa.Column("verification_status", sa.String(length=30), nullable=False),
        sa.Column("status", sa.String(length=20), nullable=False),
        sa.Column("is_current", sa.Boolean(), nullable=False),
        sa.Column("change_note", sa.Text(), nullable=True),
        sa.Column("source_document_id", sa.Integer(), nullable=True),
        sa.Column("source_page", sa.Integer(), nullable=True),
        sa.Column("source_locator", sa.String(length=255), nullable=True),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.ForeignKeyConstraint(["created_by_user_id"], ["users.id"]),
        sa.ForeignKeyConstraint(["patient_id"], ["patients.id"]),
        sa.ForeignKeyConstraint(["source_document_id"], ["health_source_documents.id"]),
        sa.ForeignKeyConstraint(
            ["supersedes_entry_id"], ["health_background_entries.id"]
        ),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint(
            "record_key", "version_number", name="uq_health_background_key_version"
        ),
    )
    op.create_index(
        "idx_health_background_effective_date",
        "health_background_entries",
        ["patient_id", "effective_date"],
        unique=False,
    )
    op.create_index(
        "idx_health_background_patient",
        "health_background_entries",
        ["patient_id"],
        unique=False,
    )
    op.create_index(
        "idx_health_background_patient_current",
        "health_background_entries",
        ["patient_id", "is_current"],
        unique=False,
    )
    op.create_index(
        "idx_health_background_record_key",
        "health_background_entries",
        ["record_key"],
        unique=False,
    )
    op.create_index(
        "idx_health_background_source",
        "health_background_entries",
        ["source_document_id"],
        unique=False,
    )


def downgrade() -> None:
    op.drop_index(
        "idx_health_background_source", table_name="health_background_entries"
    )
    op.drop_index(
        "idx_health_background_record_key", table_name="health_background_entries"
    )
    op.drop_index(
        "idx_health_background_patient_current",
        table_name="health_background_entries",
    )
    op.drop_index(
        "idx_health_background_patient", table_name="health_background_entries"
    )
    op.drop_index(
        "idx_health_background_effective_date",
        table_name="health_background_entries",
    )
    op.drop_table("health_background_entries")
