"""Add single-use invitations for ordinary household member accounts.

Revision ID: account_invitation_v1
Revises: user_privacy_consent_v1
Create Date: 2026-07-28 18:00:00
"""

from typing import Sequence, Union

import sqlalchemy as sa

from alembic import op

revision: str = "account_invitation_v1"
down_revision: Union[str, None] = "user_privacy_consent_v1"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "account_invitations",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("public_id", sa.String(length=36), nullable=False),
        sa.Column("token_sha256", sa.String(length=64), nullable=False),
        sa.Column("created_by_user_id", sa.Integer(), nullable=False),
        sa.Column("activated_user_id", sa.Integer(), nullable=True),
        sa.Column("recipient_label", sa.String(length=100), nullable=False),
        sa.Column("status", sa.String(length=16), nullable=False),
        sa.Column("expires_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("activated_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("declined_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("cancelled_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("activation_notice_version", sa.String(length=80), nullable=True),
        sa.Column("activation_notice_sha256", sa.String(length=64), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.CheckConstraint(
            "status IN ('pending', 'activated', 'declined', 'cancelled', 'expired')",
            name="ck_account_invitation_status",
        ),
        sa.ForeignKeyConstraint(
            ["activated_user_id"],
            ["users.id"],
        ),
        sa.ForeignKeyConstraint(
            ["created_by_user_id"],
            ["users.id"],
        ),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint(
            "activated_user_id",
            name="uq_account_invitation_activated_user",
        ),
        sa.UniqueConstraint("public_id"),
        sa.UniqueConstraint("token_sha256"),
    )
    op.create_index(
        "idx_account_invitation_status_expiry",
        "account_invitations",
        ["status", "expires_at"],
        unique=False,
    )
    op.create_index(
        "idx_account_invitation_created",
        "account_invitations",
        ["created_at"],
        unique=False,
    )


def downgrade() -> None:
    op.drop_index(
        "idx_account_invitation_created",
        table_name="account_invitations",
    )
    op.drop_index(
        "idx_account_invitation_status_expiry",
        table_name="account_invitations",
    )
    op.drop_table("account_invitations")
