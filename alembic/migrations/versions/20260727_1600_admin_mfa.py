"""Add administrator TOTP, recovery codes, and challenge state.

Revision ID: admin_mfa_v1
Revises: source_parse_task_v1
Create Date: 2026-07-27 16:00:00
"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "admin_mfa_v1"
down_revision: Union[str, None] = "source_parse_task_v1"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        "users",
        sa.Column(
            "auth_version",
            sa.Integer(),
            server_default="1",
            nullable=False,
        ),
    )

    op.create_table(
        "user_mfa_credentials",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("user_id", sa.Integer(), nullable=False),
        sa.Column(
            "method", sa.String(length=20), server_default="totp", nullable=False
        ),
        sa.Column("secret_encrypted", sa.Text(), nullable=False),
        sa.Column(
            "is_enabled", sa.Boolean(), server_default=sa.false(), nullable=False
        ),
        sa.Column("confirmed_at", sa.DateTime(), nullable=True),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.Column("updated_at", sa.DateTime(), nullable=False),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("user_id"),
    )
    op.create_table(
        "user_mfa_recovery_codes",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("user_id", sa.Integer(), nullable=False),
        sa.Column("code_hash", sa.String(length=255), nullable=False),
        sa.Column("used_at", sa.DateTime(), nullable=True),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(
        "idx_user_mfa_recovery_user_unused",
        "user_mfa_recovery_codes",
        ["user_id", "used_at"],
        unique=False,
    )
    op.create_table(
        "user_mfa_challenges",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("challenge_id", sa.String(length=64), nullable=False),
        sa.Column("user_id", sa.Integer(), nullable=False),
        sa.Column("purpose", sa.String(length=20), nullable=False),
        sa.Column("expires_at", sa.DateTime(), nullable=False),
        sa.Column("consumed_at", sa.DateTime(), nullable=True),
        sa.Column("attempt_count", sa.Integer(), server_default="0", nullable=False),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.CheckConstraint(
            "purpose IN ('enroll', 'verify')",
            name="ck_user_mfa_challenge_purpose",
        ),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("challenge_id"),
    )
    op.create_index(
        "idx_user_mfa_challenge_user",
        "user_mfa_challenges",
        ["user_id"],
        unique=False,
    )
    op.create_index(
        "idx_user_mfa_challenge_expires",
        "user_mfa_challenges",
        ["expires_at"],
        unique=False,
    )


def downgrade() -> None:
    op.drop_index("idx_user_mfa_challenge_expires", table_name="user_mfa_challenges")
    op.drop_index("idx_user_mfa_challenge_user", table_name="user_mfa_challenges")
    op.drop_table("user_mfa_challenges")
    op.drop_index(
        "idx_user_mfa_recovery_user_unused",
        table_name="user_mfa_recovery_codes",
    )
    op.drop_table("user_mfa_recovery_codes")
    op.drop_table("user_mfa_credentials")
    op.drop_column("users", "auth_version")
