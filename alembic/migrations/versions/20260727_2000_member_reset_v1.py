"""Add short-lived one-time ordinary-member password reset state.

Revision ID: member_reset_v1
Revises: admin_mfa_v1
Create Date: 2026-07-27 20:00:00
"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "member_reset_v1"
down_revision: Union[str, None] = "admin_mfa_v1"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        "users",
        sa.Column(
            "password_reset_expires_at",
            sa.DateTime(timezone=True),
            nullable=True,
        ),
    )
    op.add_column(
        "users",
        sa.Column(
            "password_reset_consumed_at",
            sa.DateTime(timezone=True),
            nullable=True,
        ),
    )
    op.create_index(
        "idx_users_password_reset_expiry",
        "users",
        ["password_reset_expires_at"],
        unique=False,
    )


def downgrade() -> None:
    op.drop_index("idx_users_password_reset_expiry", table_name="users")
    op.drop_column("users", "password_reset_consumed_at")
    op.drop_column("users", "password_reset_expires_at")
