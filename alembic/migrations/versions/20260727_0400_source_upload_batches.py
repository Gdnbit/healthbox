"""Add recoverable source document upload batches.

Revision ID: source_upload_batch_v1
Revises: coverage_evidence_v1
Create Date: 2026-07-27 04:00:00
"""

from typing import Sequence, Union

import sqlalchemy as sa

from alembic import op

revision: str = "source_upload_batch_v1"
down_revision: Union[str, None] = "coverage_evidence_v1"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "health_source_upload_batches",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("patient_id", sa.Integer(), nullable=False),
        sa.Column("created_by_user_id", sa.Integer(), nullable=False),
        sa.Column("idempotency_key", sa.String(length=64), nullable=False),
        sa.Column("manifest_sha256", sa.String(length=64), nullable=False),
        sa.Column("document_type", sa.String(length=50), nullable=False),
        sa.Column("report_date", sa.Date(), nullable=True),
        sa.Column("facility", sa.String(length=255), nullable=True),
        sa.Column("status", sa.String(length=20), nullable=False),
        sa.Column("expected_file_count", sa.Integer(), nullable=False),
        sa.Column("expected_total_bytes", sa.Integer(), nullable=False),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.Column("completed_at", sa.DateTime(), nullable=True),
        sa.Column("cancelled_at", sa.DateTime(), nullable=True),
        sa.Column("updated_at", sa.DateTime(), nullable=False),
        sa.ForeignKeyConstraint(["created_by_user_id"], ["users.id"]),
        sa.ForeignKeyConstraint(["patient_id"], ["patients.id"]),
        sa.PrimaryKeyConstraint("id"),
        sa.CheckConstraint(
            "status IN ('open', 'completed', 'partial', 'cancelled')",
            name="ck_health_source_upload_batch_status",
        ),
        sa.CheckConstraint(
            "expected_file_count >= 1 AND expected_file_count <= 30",
            name="ck_health_source_upload_batch_file_count",
        ),
        sa.CheckConstraint(
            "expected_total_bytes > 0",
            name="ck_health_source_upload_batch_total_bytes",
        ),
        sa.UniqueConstraint(
            "patient_id",
            "idempotency_key",
            name="uq_health_source_upload_patient_key",
        ),
    )
    op.create_index(
        "idx_health_source_upload_patient",
        "health_source_upload_batches",
        ["patient_id"],
        unique=False,
    )
    op.create_index(
        "idx_health_source_upload_status",
        "health_source_upload_batches",
        ["status"],
        unique=False,
    )

    op.create_table(
        "health_source_upload_items",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("batch_id", sa.Integer(), nullable=False),
        sa.Column("client_item_id", sa.String(length=64), nullable=False),
        sa.Column("sequence", sa.Integer(), nullable=False),
        sa.Column("original_filename", sa.String(length=255), nullable=False),
        sa.Column("mime_type", sa.String(length=100), nullable=False),
        sa.Column("size_bytes", sa.Integer(), nullable=False),
        sa.Column("client_sha256", sa.String(length=64), nullable=True),
        sa.Column("actual_sha256", sa.String(length=64), nullable=True),
        sa.Column("status", sa.String(length=20), nullable=False),
        sa.Column("source_document_id", sa.Integer(), nullable=True),
        sa.Column("duplicate_source_document_id", sa.Integer(), nullable=True),
        sa.Column("attempt_count", sa.Integer(), nullable=False),
        sa.Column("last_error_code", sa.String(length=50), nullable=True),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.Column("updated_at", sa.DateTime(), nullable=False),
        sa.ForeignKeyConstraint(
            ["batch_id"],
            ["health_source_upload_batches.id"],
        ),
        sa.ForeignKeyConstraint(
            ["duplicate_source_document_id"],
            ["health_source_documents.id"],
        ),
        sa.ForeignKeyConstraint(
            ["source_document_id"],
            ["health_source_documents.id"],
        ),
        sa.PrimaryKeyConstraint("id"),
        sa.CheckConstraint(
            "status IN ('pending', 'uploaded', 'duplicate', 'failed', 'cancelled')",
            name="ck_health_source_upload_item_status",
        ),
        sa.CheckConstraint(
            "sequence >= 1",
            name="ck_health_source_upload_item_sequence",
        ),
        sa.CheckConstraint(
            "size_bytes > 0",
            name="ck_health_source_upload_item_size",
        ),
        sa.CheckConstraint(
            "attempt_count >= 0",
            name="ck_health_source_upload_item_attempts",
        ),
        sa.UniqueConstraint(
            "batch_id",
            "client_item_id",
            name="uq_health_source_upload_item_client_id",
        ),
        sa.UniqueConstraint(
            "batch_id",
            "sequence",
            name="uq_health_source_upload_item_sequence",
        ),
    )
    op.create_index(
        "idx_health_source_upload_item_batch",
        "health_source_upload_items",
        ["batch_id"],
        unique=False,
    )
    op.create_index(
        "idx_health_source_upload_item_source",
        "health_source_upload_items",
        ["source_document_id"],
        unique=False,
    )
    op.create_index(
        "idx_health_source_upload_item_status",
        "health_source_upload_items",
        ["status"],
        unique=False,
    )


def downgrade() -> None:
    op.drop_index(
        "idx_health_source_upload_item_status",
        table_name="health_source_upload_items",
    )
    op.drop_index(
        "idx_health_source_upload_item_source",
        table_name="health_source_upload_items",
    )
    op.drop_index(
        "idx_health_source_upload_item_batch",
        table_name="health_source_upload_items",
    )
    op.drop_table("health_source_upload_items")
    op.drop_index(
        "idx_health_source_upload_status",
        table_name="health_source_upload_batches",
    )
    op.drop_index(
        "idx_health_source_upload_patient",
        table_name="health_source_upload_batches",
    )
    op.drop_table("health_source_upload_batches")
