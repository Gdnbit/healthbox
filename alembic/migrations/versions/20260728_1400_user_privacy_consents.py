"""Add versioned household privacy-consent decisions.

Revision ID: user_privacy_consent_v1
Revises: formal_metric_revision_v1
Create Date: 2026-07-28 14:00:00
"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "user_privacy_consent_v1"
down_revision: Union[str, None] = "formal_metric_revision_v1"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "user_privacy_consents",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("user_id", sa.Integer(), nullable=False),
        sa.Column("notice_version", sa.String(length=80), nullable=False),
        sa.Column("notice_locale", sa.String(length=10), nullable=False),
        sa.Column("notice_sha256", sa.String(length=64), nullable=False),
        sa.Column("decision", sa.String(length=12), nullable=False),
        sa.Column("scope_snapshot", sa.JSON(), nullable=False),
        sa.Column("decided_at", sa.DateTime(timezone=True), nullable=False),
        sa.CheckConstraint(
            "decision IN ('accepted', 'declined')",
            name="ck_user_privacy_consent_decision",
        ),
        sa.ForeignKeyConstraint(
            ["user_id"],
            ["users.id"],
            ondelete="CASCADE",
        ),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(
        "idx_user_privacy_consent_latest",
        "user_privacy_consents",
        ["user_id", "notice_version", "decided_at"],
        unique=False,
    )


def downgrade() -> None:
    op.drop_index(
        "idx_user_privacy_consent_latest",
        table_name="user_privacy_consents",
    )
    op.drop_table("user_privacy_consents")
