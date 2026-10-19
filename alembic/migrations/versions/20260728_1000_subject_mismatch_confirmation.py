"""Add batch-level subject mismatch confirmation.

Revision ID: subject_mismatch_v1
Revises: source_similarity_v1
Create Date: 2026-07-28 10:00:00
"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "subject_mismatch_v1"
down_revision: Union[str, None] = "source_similarity_v1"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        "health_import_batches",
        sa.Column(
            "subject_identity_status",
            sa.String(length=30),
            nullable=False,
            server_default="unavailable",
        ),
    )
    op.add_column(
        "health_import_batches",
        sa.Column("subject_identity_observed_name", sa.String(length=255)),
    )
    op.add_column(
        "health_import_batches",
        sa.Column("subject_identity_confidence", sa.Float()),
    )
    op.add_column(
        "health_import_batches",
        sa.Column("subject_identity_assessment_version", sa.String(length=80)),
    )
    op.add_column(
        "health_import_batches",
        sa.Column("subject_identity_evidence", sa.JSON()),
    )
    op.add_column(
        "health_import_batches",
        sa.Column("subject_mismatch_confirmed_by_user_id", sa.Integer()),
    )
    op.add_column(
        "health_import_batches",
        sa.Column("subject_mismatch_confirmed_at", sa.DateTime()),
    )
    op.create_check_constraint(
        "ck_health_import_subject_identity_status",
        "health_import_batches",
        "subject_identity_status IN "
        "('unavailable', 'matched', 'suspected_mismatch')",
    )
    op.create_check_constraint(
        "ck_health_import_subject_identity_confidence",
        "health_import_batches",
        "subject_identity_confidence IS NULL OR "
        "(subject_identity_confidence >= 0 AND subject_identity_confidence <= 1)",
    )
    op.create_check_constraint(
        "ck_health_import_subject_mismatch_evidence",
        "health_import_batches",
        "subject_identity_status != 'suspected_mismatch' OR "
        "(subject_identity_observed_name IS NOT NULL AND "
        "subject_identity_confidence IS NOT NULL AND "
        "subject_identity_assessment_version IS NOT NULL AND "
        "subject_identity_evidence IS NOT NULL)",
    )
    op.create_foreign_key(
        "fk_health_import_subject_mismatch_confirmer",
        "health_import_batches",
        "users",
        ["subject_mismatch_confirmed_by_user_id"],
        ["id"],
        ondelete="SET NULL",
    )


def downgrade() -> None:
    op.drop_constraint(
        "fk_health_import_subject_mismatch_confirmer",
        "health_import_batches",
        type_="foreignkey",
    )
    op.drop_constraint(
        "ck_health_import_subject_mismatch_evidence",
        "health_import_batches",
        type_="check",
    )
    op.drop_constraint(
        "ck_health_import_subject_identity_confidence",
        "health_import_batches",
        type_="check",
    )
    op.drop_constraint(
        "ck_health_import_subject_identity_status",
        "health_import_batches",
        type_="check",
    )
    op.drop_column("health_import_batches", "subject_mismatch_confirmed_at")
    op.drop_column("health_import_batches", "subject_mismatch_confirmed_by_user_id")
    op.drop_column("health_import_batches", "subject_identity_evidence")
    op.drop_column("health_import_batches", "subject_identity_assessment_version")
    op.drop_column("health_import_batches", "subject_identity_confidence")
    op.drop_column("health_import_batches", "subject_identity_observed_name")
    op.drop_column("health_import_batches", "subject_identity_status")
