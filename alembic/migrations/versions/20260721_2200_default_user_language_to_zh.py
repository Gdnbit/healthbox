"""Default new user preferences to Simplified Chinese.

Revision ID: default_user_language_zh
Revises: add_lr_med_proc_tables
Create Date: 2026-07-21 22:00:00.000000

Existing preference rows are intentionally left unchanged so an explicit user
choice is never overwritten.
"""

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision = "default_user_language_zh"
down_revision = "add_lr_med_proc_tables"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.alter_column(
        "user_preferences",
        "language",
        existing_type=sa.String(length=10),
        existing_nullable=False,
        server_default="zh",
    )


def downgrade() -> None:
    op.alter_column(
        "user_preferences",
        "language",
        existing_type=sa.String(length=10),
        existing_nullable=False,
        server_default="en",
    )
