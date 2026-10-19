"""Add deterministic health alert rules and mute state.

Revision ID: health_alert_rules
Revises: household_health_imports
Create Date: 2026-07-22 06:00:00
"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "health_alert_rules"
down_revision: Union[str, None] = "household_health_imports"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "health_alert_rules",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("patient_id", sa.Integer(), nullable=False),
        sa.Column("created_by_user_id", sa.Integer(), nullable=False),
        sa.Column("name", sa.String(length=255), nullable=False),
        sa.Column("rule_type", sa.String(length=30), nullable=False),
        sa.Column("test_name", sa.String(length=255), nullable=False),
        sa.Column("unit", sa.String(length=100), nullable=True),
        sa.Column("operator", sa.String(length=10), nullable=True),
        sa.Column("threshold_value", sa.Float(), nullable=True),
        sa.Column("overdue_days", sa.Integer(), nullable=True),
        sa.Column("enabled", sa.Boolean(), server_default=sa.true(), nullable=False),
        sa.Column("version", sa.Integer(), server_default="1", nullable=False),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.Column("updated_at", sa.DateTime(), nullable=False),
        sa.ForeignKeyConstraint(["created_by_user_id"], ["users.id"]),
        sa.ForeignKeyConstraint(["patient_id"], ["patients.id"]),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(
        "idx_health_alert_rule_patient",
        "health_alert_rules",
        ["patient_id"],
    )
    op.create_index(
        "idx_health_alert_rule_enabled",
        "health_alert_rules",
        ["patient_id", "enabled"],
    )

    op.create_table(
        "health_alert_mutes",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("user_id", sa.Integer(), nullable=False),
        sa.Column("patient_id", sa.Integer(), nullable=False),
        sa.Column("alert_id", sa.String(length=64), nullable=False),
        sa.Column("muted_until", sa.DateTime(), nullable=False),
        sa.Column("reason", sa.Text(), nullable=True),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.Column("updated_at", sa.DateTime(), nullable=False),
        sa.ForeignKeyConstraint(["patient_id"], ["patients.id"]),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"]),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint(
            "user_id", "patient_id", "alert_id", name="uq_health_alert_mute"
        ),
    )
    op.create_index(
        "idx_health_alert_mute_lookup",
        "health_alert_mutes",
        ["user_id", "patient_id", "alert_id"],
    )
    op.create_index(
        "idx_health_alert_mute_expiry",
        "health_alert_mutes",
        ["muted_until"],
    )


def downgrade() -> None:
    op.drop_index("idx_health_alert_mute_expiry", table_name="health_alert_mutes")
    op.drop_index("idx_health_alert_mute_lookup", table_name="health_alert_mutes")
    op.drop_table("health_alert_mutes")
    op.drop_index("idx_health_alert_rule_enabled", table_name="health_alert_rules")
    op.drop_index("idx_health_alert_rule_patient", table_name="health_alert_rules")
    op.drop_table("health_alert_rules")
