"""Add viewer-by-subject dashboard display preferences.

Revision ID: dashboard_preferences_v1
Revises: archive_circle_v1
Create Date: 2026-07-28 03:00:00
"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "dashboard_preferences_v1"
down_revision: Union[str, None] = "archive_circle_v1"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "dashboard_preferences",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("user_id", sa.Integer(), nullable=False),
        sa.Column("patient_id", sa.Integer(), nullable=False),
        sa.Column("pinned_metric_ids", sa.JSON(), nullable=False),
        sa.Column("ranges_by_metric_id", sa.JSON(), nullable=False),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.Column("updated_at", sa.DateTime(), nullable=False),
        sa.ForeignKeyConstraint(["patient_id"], ["patients.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint(
            "user_id",
            "patient_id",
            name="uq_dashboard_preference_viewer_subject",
        ),
    )
    op.create_index(
        "idx_dashboard_preference_patient",
        "dashboard_preferences",
        ["patient_id", "user_id"],
        unique=False,
    )


def downgrade() -> None:
    op.drop_index(
        "idx_dashboard_preference_patient",
        table_name="dashboard_preferences",
    )
    op.drop_table("dashboard_preferences")
