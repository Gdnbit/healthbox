"""Add recoverable lifecycle metadata to health source documents.

Revision ID: source_doc_lifecycle_v1
Revises: source_upload_batch_v1
Create Date: 2026-07-27 08:00:00
"""

from typing import Sequence, Union

import sqlalchemy as sa

from alembic import op

revision: str = "source_doc_lifecycle_v1"
down_revision: Union[str, None] = "source_upload_batch_v1"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    with op.batch_alter_table("health_source_documents") as batch_op:
        batch_op.add_column(sa.Column("withdrawn_at", sa.DateTime(), nullable=True))
        batch_op.add_column(sa.Column("withdrawn_by_user_id", sa.Integer(), nullable=True))
        batch_op.add_column(sa.Column("withdrawal_reason", sa.String(length=500), nullable=True))
        batch_op.add_column(sa.Column("withdrawal_previous_status", sa.String(length=20), nullable=True))
        batch_op.create_foreign_key(
            "fk_health_source_withdrawn_by_user",
            "users",
            ["withdrawn_by_user_id"],
            ["id"],
        )


def downgrade() -> None:
    with op.batch_alter_table("health_source_documents") as batch_op:
        batch_op.drop_constraint("fk_health_source_withdrawn_by_user", type_="foreignkey")
        batch_op.drop_column("withdrawal_previous_status")
        batch_op.drop_column("withdrawal_reason")
        batch_op.drop_column("withdrawn_by_user_id")
        batch_op.drop_column("withdrawn_at")
