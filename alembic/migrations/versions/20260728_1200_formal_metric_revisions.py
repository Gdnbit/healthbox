"""Add append-only revisions for formally imported metrics.

Revision ID: formal_metric_revision_v1
Revises: subject_mismatch_v1
Create Date: 2026-07-28 12:00:00
"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "formal_metric_revision_v1"
down_revision: Union[str, None] = "subject_mismatch_v1"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "health_formal_metric_revisions",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("component_id", sa.Integer(), nullable=False),
        sa.Column("patient_id", sa.Integer(), nullable=False),
        sa.Column("version", sa.Integer(), nullable=False),
        sa.Column("action", sa.String(length=20), nullable=False),
        sa.Column("supersedes_revision_id", sa.Integer(), nullable=True),
        sa.Column("reason", sa.Text(), nullable=True),
        sa.Column("idempotency_key", sa.String(length=64), nullable=False),
        sa.Column("request_hash", sa.String(length=64), nullable=False),
        sa.Column("result_type", sa.String(length=20), nullable=False),
        sa.Column("numeric_value", sa.Float(), nullable=True),
        sa.Column("qualitative_value", sa.String(length=100), nullable=True),
        sa.Column("textual_value", sa.Text(), nullable=True),
        sa.Column("unit", sa.String(length=100), nullable=True),
        sa.Column("ref_range_min", sa.Float(), nullable=True),
        sa.Column("ref_range_max", sa.Float(), nullable=True),
        sa.Column("ref_range_text", sa.String(length=500), nullable=True),
        sa.Column("result_status", sa.String(length=30), nullable=True),
        sa.Column("created_by_user_id", sa.Integer(), nullable=False),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.CheckConstraint(
            "version >= 1",
            name="ck_health_formal_metric_revision_version",
        ),
        sa.CheckConstraint(
            "action IN ('created', 'revised')",
            name="ck_health_formal_metric_revision_action",
        ),
        sa.CheckConstraint(
            "(version = 1 AND action = 'created' AND "
            "supersedes_revision_id IS NULL AND reason IS NULL) OR "
            "(version > 1 AND action = 'revised' AND "
            "supersedes_revision_id IS NOT NULL AND reason IS NOT NULL)",
            name="ck_health_formal_metric_revision_chain",
        ),
        sa.CheckConstraint(
            "result_type IN ('quantitative', 'qualitative', 'textual')",
            name="ck_health_formal_metric_revision_result_type",
        ),
        sa.CheckConstraint(
            "(result_type = 'quantitative' AND numeric_value IS NOT NULL "
            "AND qualitative_value IS NULL AND textual_value IS NULL) OR "
            "(result_type = 'qualitative' AND numeric_value IS NULL "
            "AND qualitative_value IS NOT NULL AND textual_value IS NULL "
            "AND ref_range_min IS NULL AND ref_range_max IS NULL) OR "
            "(result_type = 'textual' AND numeric_value IS NULL "
            "AND qualitative_value IS NULL AND textual_value IS NOT NULL "
            "AND ref_range_min IS NULL AND ref_range_max IS NULL)",
            name="ck_health_formal_metric_revision_value",
        ),
        sa.CheckConstraint(
            "ref_range_min IS NULL OR ref_range_max IS NULL OR "
            "ref_range_min < ref_range_max",
            name="ck_health_formal_metric_revision_range",
        ),
        sa.ForeignKeyConstraint(
            ["component_id"],
            ["lab_test_components.id"],
            ondelete="CASCADE",
        ),
        sa.ForeignKeyConstraint(
            ["created_by_user_id"],
            ["users.id"],
            ondelete="RESTRICT",
        ),
        sa.ForeignKeyConstraint(
            ["patient_id"],
            ["patients.id"],
            ondelete="CASCADE",
        ),
        sa.ForeignKeyConstraint(
            ["supersedes_revision_id"],
            ["health_formal_metric_revisions.id"],
            ondelete="RESTRICT",
        ),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint(
            "component_id",
            "idempotency_key",
            name="uq_health_formal_metric_revision_request",
        ),
        sa.UniqueConstraint(
            "component_id",
            "version",
            name="uq_health_formal_metric_revision_version",
        ),
    )
    op.create_index(
        "idx_health_formal_metric_revision_component",
        "health_formal_metric_revisions",
        ["component_id", "version"],
        unique=False,
    )
    op.create_index(
        "idx_health_formal_metric_revision_patient",
        "health_formal_metric_revisions",
        ["patient_id", "created_at"],
        unique=False,
    )

    op.execute(sa.text("""
            INSERT INTO health_formal_metric_revisions (
                component_id,
                patient_id,
                version,
                action,
                supersedes_revision_id,
                reason,
                idempotency_key,
                request_hash,
                result_type,
                numeric_value,
                qualitative_value,
                textual_value,
                unit,
                ref_range_min,
                ref_range_max,
                ref_range_text,
                result_status,
                created_by_user_id,
                created_at
            )
            SELECT
                component.id,
                lab_result.patient_id,
                1,
                'created',
                NULL,
                NULL,
                'initial:' || component.import_batch_id::text || ':' || component.id::text,
                repeat('0', 64),
                COALESCE(component.result_type, 'quantitative'),
                component.value,
                component.qualitative_value,
                component.textual_value,
                component.unit,
                component.ref_range_min,
                component.ref_range_max,
                component.ref_range_text,
                component.status,
                import_batch.created_by_user_id,
                COALESCE(component.created_at, CURRENT_TIMESTAMP)
            FROM lab_test_components AS component
            JOIN lab_results AS lab_result
              ON lab_result.id = component.lab_result_id
            JOIN health_import_batches AS import_batch
              ON import_batch.id = component.import_batch_id
            WHERE component.import_batch_id IS NOT NULL
            """))


def downgrade() -> None:
    op.drop_index(
        "idx_health_formal_metric_revision_patient",
        table_name="health_formal_metric_revisions",
    )
    op.drop_index(
        "idx_health_formal_metric_revision_component",
        table_name="health_formal_metric_revisions",
    )
    op.drop_table("health_formal_metric_revisions")
