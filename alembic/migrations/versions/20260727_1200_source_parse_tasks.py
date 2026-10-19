"""Add durable local source parsing tasks and candidate evidence.

Revision ID: source_parse_task_v1
Revises: source_doc_lifecycle_v1
Create Date: 2026-07-27 12:00:00
"""

from typing import Sequence, Union

import sqlalchemy as sa

from alembic import op

revision: str = "source_parse_task_v1"
down_revision: Union[str, None] = "source_doc_lifecycle_v1"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "health_source_parse_tasks",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("patient_id", sa.Integer(), nullable=False),
        sa.Column("source_document_id", sa.Integer(), nullable=False),
        sa.Column("created_by_user_id", sa.Integer(), nullable=False),
        sa.Column("import_batch_id", sa.Integer(), nullable=True),
        sa.Column("idempotency_key", sa.String(length=64), nullable=False),
        sa.Column("parser_name", sa.String(length=100), nullable=False),
        sa.Column("parser_version", sa.String(length=50), nullable=False),
        sa.Column("status", sa.String(length=20), nullable=False),
        sa.Column("attempt_count", sa.Integer(), nullable=False),
        sa.Column("summary", sa.JSON(), nullable=False),
        sa.Column("error_code", sa.String(length=80), nullable=True),
        sa.Column("started_at", sa.DateTime(), nullable=True),
        sa.Column("completed_at", sa.DateTime(), nullable=True),
        sa.Column("cancelled_at", sa.DateTime(), nullable=True),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.Column("updated_at", sa.DateTime(), nullable=False),
        sa.CheckConstraint(
            "status IN ('queued', 'running', 'succeeded', 'failed', 'cancelled')",
            name="ck_health_source_parse_task_status",
        ),
        sa.CheckConstraint(
            "attempt_count >= 0",
            name="ck_health_source_parse_task_attempts",
        ),
        sa.ForeignKeyConstraint(["created_by_user_id"], ["users.id"]),
        sa.ForeignKeyConstraint(["import_batch_id"], ["health_import_batches.id"]),
        sa.ForeignKeyConstraint(["patient_id"], ["patients.id"]),
        sa.ForeignKeyConstraint(["source_document_id"], ["health_source_documents.id"]),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint(
            "patient_id",
            "idempotency_key",
            name="uq_health_source_parse_patient_key",
        ),
    )
    op.create_index(
        "idx_health_source_parse_patient",
        "health_source_parse_tasks",
        ["patient_id"],
        unique=False,
    )
    op.create_index(
        "idx_health_source_parse_source",
        "health_source_parse_tasks",
        ["source_document_id"],
        unique=False,
    )
    op.create_index(
        "idx_health_source_parse_status",
        "health_source_parse_tasks",
        ["status"],
        unique=False,
    )
    op.create_index(
        "idx_health_source_parse_import_batch",
        "health_source_parse_tasks",
        ["import_batch_id"],
        unique=False,
    )

    with op.batch_alter_table("health_import_items") as batch_op:
        batch_op.add_column(sa.Column("raw_text", sa.Text(), nullable=True))
        batch_op.add_column(sa.Column("confidence", sa.Float(), nullable=True))


def downgrade() -> None:
    with op.batch_alter_table("health_import_items") as batch_op:
        batch_op.drop_column("confidence")
        batch_op.drop_column("raw_text")

    op.drop_index(
        "idx_health_source_parse_import_batch",
        table_name="health_source_parse_tasks",
    )
    op.drop_index(
        "idx_health_source_parse_status",
        table_name="health_source_parse_tasks",
    )
    op.drop_index(
        "idx_health_source_parse_source",
        table_name="health_source_parse_tasks",
    )
    op.drop_index(
        "idx_health_source_parse_patient",
        table_name="health_source_parse_tasks",
    )
    op.drop_table("health_source_parse_tasks")
