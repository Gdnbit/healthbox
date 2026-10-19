"""Add owner-only, deletable health AI answer history.

Revision ID: health_ai_answers_v1
Revises: dashboard_preferences_v1
Create Date: 2026-07-28 06:00:00
"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "health_ai_answers_v1"
down_revision: Union[str, None] = "dashboard_preferences_v1"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "health_ai_answers",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("request_id", sa.String(length=36), nullable=False),
        sa.Column("patient_id", sa.Integer(), nullable=False),
        sa.Column("requested_by_user_id", sa.Integer(), nullable=False),
        sa.Column("question_id", sa.String(length=40), nullable=False),
        sa.Column("question", sa.Text(), nullable=False),
        sa.Column("range_id", sa.String(length=10), nullable=False),
        sa.Column("provider_name", sa.String(length=80), nullable=False),
        sa.Column("model_name", sa.String(length=160), nullable=False),
        sa.Column("processing_location", sa.String(length=120), nullable=False),
        sa.Column("template_version", sa.String(length=80), nullable=False),
        sa.Column("data_cutoff", sa.Date(), nullable=False),
        sa.Column("record_count", sa.Integer(), nullable=False),
        sa.Column("metric_count", sa.Integer(), nullable=False),
        sa.Column("answer_items", sa.JSON(), nullable=False),
        sa.Column("general_explanations", sa.JSON(), nullable=False),
        sa.Column("citations", sa.JSON(), nullable=False),
        sa.Column("limitations", sa.JSON(), nullable=False),
        sa.Column("next_steps", sa.JSON(), nullable=False),
        sa.Column("disclaimer", sa.Text(), nullable=False),
        sa.Column("generated_at", sa.DateTime(), nullable=False),
        sa.CheckConstraint(
            "metric_count >= 1",
            name="ck_health_ai_answer_metric_count",
        ),
        sa.CheckConstraint(
            "range_id IN ('1y', '3y', '5y', 'all')",
            name="ck_health_ai_answer_range",
        ),
        sa.CheckConstraint(
            "record_count >= 1",
            name="ck_health_ai_answer_record_count",
        ),
        sa.ForeignKeyConstraint(
            ["patient_id"],
            ["patients.id"],
            ondelete="CASCADE",
        ),
        sa.ForeignKeyConstraint(
            ["requested_by_user_id"],
            ["users.id"],
            ondelete="CASCADE",
        ),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint(
            "request_id",
            name="uq_health_ai_answer_request_id",
        ),
    )
    op.create_index(
        "idx_health_ai_answer_owner_history",
        "health_ai_answers",
        ["requested_by_user_id", "patient_id", "generated_at"],
        unique=False,
    )


def downgrade() -> None:
    op.drop_index(
        "idx_health_ai_answer_owner_history",
        table_name="health_ai_answers",
    )
    op.drop_table("health_ai_answers")
