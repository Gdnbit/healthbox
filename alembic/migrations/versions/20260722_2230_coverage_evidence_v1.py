"""Add versioned household exam coverage statements.

Revision ID: coverage_evidence_v1
Revises: backup_automation_v1
Create Date: 2026-07-22 22:30:00
"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "coverage_evidence_v1"
down_revision: Union[str, None] = "backup_automation_v1"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "health_coverage_statements",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("patient_id", sa.Integer(), nullable=False),
        sa.Column("created_by_user_id", sa.Integer(), nullable=False),
        sa.Column("record_key", sa.String(length=36), nullable=False),
        sa.Column("version_number", sa.Integer(), nullable=False),
        sa.Column("supersedes_statement_id", sa.Integer(), nullable=True),
        sa.Column("exam_date", sa.Date(), nullable=False),
        sa.Column("metric_key", sa.String(length=255), nullable=False),
        sa.Column("metric_name", sa.String(length=255), nullable=False),
        sa.Column("metric_code", sa.String(length=100), nullable=True),
        sa.Column("absence_reason", sa.String(length=30), nullable=False),
        sa.Column("absence_reason_system", sa.String(length=255), nullable=False),
        sa.Column("verification_status", sa.String(length=30), nullable=False),
        sa.Column("note", sa.Text(), nullable=True),
        sa.Column("source_document_id", sa.Integer(), nullable=True),
        sa.Column("source_page", sa.Integer(), nullable=True),
        sa.Column("source_locator", sa.String(length=255), nullable=True),
        sa.Column("status", sa.String(length=20), nullable=False),
        sa.Column("is_current", sa.Boolean(), nullable=False),
        sa.Column("change_note", sa.Text(), nullable=True),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.ForeignKeyConstraint(["created_by_user_id"], ["users.id"]),
        sa.ForeignKeyConstraint(["patient_id"], ["patients.id"]),
        sa.ForeignKeyConstraint(["source_document_id"], ["health_source_documents.id"]),
        sa.ForeignKeyConstraint(
            ["supersedes_statement_id"], ["health_coverage_statements.id"]
        ),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint(
            "record_key", "version_number", name="uq_health_coverage_key_version"
        ),
    )
    op.create_index(
        "idx_health_coverage_patient",
        "health_coverage_statements",
        ["patient_id"],
        unique=False,
    )
    op.create_index(
        "idx_health_coverage_exam_date",
        "health_coverage_statements",
        ["patient_id", "exam_date"],
        unique=False,
    )
    op.create_index(
        "idx_health_coverage_record_key",
        "health_coverage_statements",
        ["record_key"],
        unique=False,
    )
    op.create_index(
        "idx_health_coverage_source",
        "health_coverage_statements",
        ["source_document_id"],
        unique=False,
    )
    op.create_index(
        "uq_health_coverage_current_identity",
        "health_coverage_statements",
        ["patient_id", "exam_date", "metric_key"],
        unique=True,
        postgresql_where=sa.text("is_current AND status <> 'voided'"),
        sqlite_where=sa.text("is_current = 1 AND status <> 'voided'"),
    )


def downgrade() -> None:
    op.drop_index(
        "uq_health_coverage_current_identity",
        table_name="health_coverage_statements",
    )
    op.drop_index("idx_health_coverage_source", table_name="health_coverage_statements")
    op.drop_index(
        "idx_health_coverage_record_key", table_name="health_coverage_statements"
    )
    op.drop_index(
        "idx_health_coverage_exam_date", table_name="health_coverage_statements"
    )
    op.drop_index(
        "idx_health_coverage_patient", table_name="health_coverage_statements"
    )
    op.drop_table("health_coverage_statements")
