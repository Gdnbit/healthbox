"""Add the privacy-minimized health AI request guard ledger.

Revision ID: health_ai_request_guard_v1
Revises: account_invitation_v1
Create Date: 2026-07-29 09:00:00
"""

from typing import Sequence, Union

import sqlalchemy as sa

from alembic import op

revision: str = "health_ai_request_guard_v1"
down_revision: Union[str, None] = "account_invitation_v1"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "health_ai_requests",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("requested_by_user_id", sa.Integer(), nullable=False),
        sa.Column("patient_id", sa.Integer(), nullable=False),
        sa.Column("idempotency_key_sha256", sa.String(length=64), nullable=False),
        sa.Column("request_sha256", sa.String(length=64), nullable=False),
        sa.Column("request_id", sa.String(length=36), nullable=False),
        sa.Column("status", sa.String(length=16), nullable=False),
        sa.Column("answer_id", sa.Integer(), nullable=True),
        sa.Column("safe_error_code", sa.String(length=80), nullable=True),
        sa.Column("safe_http_status", sa.Integer(), nullable=True),
        sa.Column("admitted_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("lease_expires_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("completed_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.CheckConstraint(
            "status IN ('in_progress', 'succeeded', 'failed')",
            name="ck_health_ai_request_status",
        ),
        sa.CheckConstraint(
            "safe_http_status IS NULL "
            "OR (safe_http_status >= 400 AND safe_http_status <= 599)",
            name="ck_health_ai_request_safe_http_status",
        ),
        sa.CheckConstraint(
            "status != 'failed' "
            "OR (safe_error_code IS NOT NULL AND safe_http_status IS NOT NULL)",
            name="ck_health_ai_request_failed_error",
        ),
        sa.CheckConstraint(
            "status = 'in_progress' OR completed_at IS NOT NULL",
            name="ck_health_ai_request_terminal_completed",
        ),
        sa.ForeignKeyConstraint(
            ["answer_id"],
            ["health_ai_answers.id"],
            ondelete="SET NULL",
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
            "answer_id",
            name="uq_health_ai_request_answer",
        ),
        sa.UniqueConstraint(
            "request_id",
            name="uq_health_ai_request_request_id",
        ),
        sa.UniqueConstraint(
            "requested_by_user_id",
            "idempotency_key_sha256",
            name="uq_health_ai_request_user_key_hash",
        ),
    )
    op.create_index(
        "idx_health_ai_request_user_admitted",
        "health_ai_requests",
        ["requested_by_user_id", "admitted_at"],
        unique=False,
    )
    op.create_index(
        "idx_health_ai_request_user_status_lease",
        "health_ai_requests",
        ["requested_by_user_id", "status", "lease_expires_at"],
        unique=False,
    )


def downgrade() -> None:
    op.drop_index(
        "idx_health_ai_request_user_status_lease",
        table_name="health_ai_requests",
    )
    op.drop_index(
        "idx_health_ai_request_user_admitted",
        table_name="health_ai_requests",
    )
    op.drop_table("health_ai_requests")
