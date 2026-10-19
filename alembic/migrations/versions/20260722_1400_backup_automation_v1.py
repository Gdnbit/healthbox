"""Track verified backup copies produced by automatic backup runs.

Revision ID: backup_automation_v1
Revises: health_background_v1
Create Date: 2026-07-22 14:00:00
"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "backup_automation_v1"
down_revision: Union[str, None] = "health_background_v1"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        "backup_records", sa.Column("replica_status", sa.String(30), nullable=True)
    )
    op.add_column(
        "backup_records", sa.Column("replicated_at", sa.DateTime(), nullable=True)
    )
    op.add_column(
        "backup_records", sa.Column("replica_checksum", sa.String(64), nullable=True)
    )
    op.add_column(
        "backup_records",
        sa.Column("replica_target_label", sa.String(100), nullable=True),
    )
    op.add_column(
        "backup_records", sa.Column("replica_error_code", sa.String(50), nullable=True)
    )


def downgrade() -> None:
    op.drop_column("backup_records", "replica_error_code")
    op.drop_column("backup_records", "replica_target_label")
    op.drop_column("backup_records", "replica_checksum")
    op.drop_column("backup_records", "replicated_at")
    op.drop_column("backup_records", "replica_status")
