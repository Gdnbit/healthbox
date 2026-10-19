"""Add reciprocal internal archive circles without modifying legacy shares.

Revision ID: archive_circle_v1
Revises: health_archive_export_v1
Create Date: 2026-07-27 23:00:00
"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "archive_circle_v1"
down_revision: Union[str, None] = "health_archive_export_v1"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "archive_circles",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("name", sa.String(length=80), nullable=False),
        sa.Column("description", sa.Text(), nullable=True),
        sa.Column("status", sa.String(length=20), nullable=False),
        sa.Column("created_by_user_id", sa.Integer(), nullable=False),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.Column("updated_at", sa.DateTime(), nullable=False),
        sa.CheckConstraint(
            "status IN ('active', 'paused', 'archived')",
            name="ck_archive_circle_status",
        ),
        sa.ForeignKeyConstraint(["created_by_user_id"], ["users.id"]),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("name"),
    )
    op.create_index(
        "idx_archive_circle_status",
        "archive_circles",
        ["status", "updated_at"],
        unique=False,
    )
    op.create_table(
        "archive_circle_memberships",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("circle_id", sa.Integer(), nullable=False),
        sa.Column("patient_id", sa.Integer(), nullable=False),
        sa.Column("scope", sa.String(length=40), nullable=False),
        sa.Column("status", sa.String(length=20), nullable=False),
        sa.Column("expires_at", sa.DateTime(), nullable=True),
        sa.Column("joined_at", sa.DateTime(), nullable=False),
        sa.Column("paused_at", sa.DateTime(), nullable=True),
        sa.Column("removed_at", sa.DateTime(), nullable=True),
        sa.Column("updated_by_user_id", sa.Integer(), nullable=False),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.Column("updated_at", sa.DateTime(), nullable=False),
        sa.CheckConstraint(
            "scope = 'structured_dashboard'",
            name="ck_archive_circle_membership_scope",
        ),
        sa.CheckConstraint(
            "status IN ('active', 'paused', 'removed')",
            name="ck_archive_circle_membership_status",
        ),
        sa.ForeignKeyConstraint(
            ["circle_id"],
            ["archive_circles.id"],
            ondelete="CASCADE",
        ),
        sa.ForeignKeyConstraint(
            ["patient_id"],
            ["patients.id"],
            ondelete="CASCADE",
        ),
        sa.ForeignKeyConstraint(["updated_by_user_id"], ["users.id"]),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint(
            "circle_id",
            "patient_id",
            name="uq_archive_circle_membership_patient",
        ),
    )
    op.create_index(
        "idx_archive_circle_membership_circle",
        "archive_circle_memberships",
        ["circle_id", "status"],
        unique=False,
    )
    op.create_index(
        "idx_archive_circle_membership_patient",
        "archive_circle_memberships",
        ["patient_id", "status"],
        unique=False,
    )


def downgrade() -> None:
    op.drop_index(
        "idx_archive_circle_membership_patient",
        table_name="archive_circle_memberships",
    )
    op.drop_index(
        "idx_archive_circle_membership_circle",
        table_name="archive_circle_memberships",
    )
    op.drop_table("archive_circle_memberships")
    op.drop_index(
        "idx_archive_circle_status",
        table_name="archive_circles",
    )
    op.drop_table("archive_circles")
