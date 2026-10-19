"""Add durable self-service complete health archive exports.

Revision ID: health_archive_export_v1
Revises: member_reset_v1
Create Date: 2026-07-27 22:00:00
"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "health_archive_export_v1"
down_revision: Union[str, None] = "member_reset_v1"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "health_archive_exports",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("patient_id", sa.Integer(), nullable=False),
        sa.Column("requested_by_user_id", sa.Integer(), nullable=False),
        sa.Column("idempotency_key", sa.String(length=64), nullable=False),
        sa.Column("schema_version", sa.String(length=50), nullable=False),
        sa.Column("status", sa.String(length=20), nullable=False),
        sa.Column("attempt_count", sa.Integer(), nullable=False),
        sa.Column("archive_filename", sa.String(length=255), nullable=False),
        sa.Column("archive_path", sa.String(length=500), nullable=True),
        sa.Column("archive_size_bytes", sa.Integer(), nullable=True),
        sa.Column("archive_sha256", sa.String(length=64), nullable=True),
        sa.Column("original_count", sa.Integer(), nullable=False),
        sa.Column("manifest_summary", sa.JSON(), nullable=False),
        sa.Column("error_code", sa.String(length=80), nullable=True),
        sa.Column("started_at", sa.DateTime(), nullable=True),
        sa.Column("completed_at", sa.DateTime(), nullable=True),
        sa.Column("expires_at", sa.DateTime(), nullable=True),
        sa.Column("cancelled_at", sa.DateTime(), nullable=True),
        sa.Column("downloaded_at", sa.DateTime(), nullable=True),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.Column("updated_at", sa.DateTime(), nullable=False),
        sa.CheckConstraint(
            "status IN ('queued', 'running', 'ready', 'failed', 'cancelled', 'expired')",
            name="ck_health_archive_export_status",
        ),
        sa.CheckConstraint(
            "attempt_count >= 0",
            name="ck_health_archive_export_attempts",
        ),
        sa.CheckConstraint(
            "original_count >= 0",
            name="ck_health_archive_export_original_count",
        ),
        sa.ForeignKeyConstraint(["patient_id"], ["patients.id"]),
        sa.ForeignKeyConstraint(["requested_by_user_id"], ["users.id"]),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint(
            "requested_by_user_id",
            "patient_id",
            "idempotency_key",
            name="uq_health_archive_export_request_key",
        ),
    )
    op.create_index(
        "idx_health_archive_export_requester",
        "health_archive_exports",
        ["requested_by_user_id", "created_at"],
        unique=False,
    )
    op.create_index(
        "idx_health_archive_export_patient",
        "health_archive_exports",
        ["patient_id", "created_at"],
        unique=False,
    )
    op.create_index(
        "idx_health_archive_export_status",
        "health_archive_exports",
        ["status", "created_at"],
        unique=False,
    )


def downgrade() -> None:
    op.drop_index(
        "idx_health_archive_export_status",
        table_name="health_archive_exports",
    )
    op.drop_index(
        "idx_health_archive_export_patient",
        table_name="health_archive_exports",
    )
    op.drop_index(
        "idx_health_archive_export_requester",
        table_name="health_archive_exports",
    )
    op.drop_table("health_archive_exports")
