"""Track backup integrity checks and isolated restore drills.

Revision ID: backup_restore_health
Revises: health_alert_rules
Create Date: 2026-07-22 10:00:00
"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "backup_restore_health"
down_revision: Union[str, None] = "health_alert_rules"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        "backup_records", sa.Column("integrity_status", sa.String(30), nullable=True)
    )
    op.add_column(
        "backup_records",
        sa.Column("integrity_verified_at", sa.DateTime(), nullable=True),
    )
    op.add_column(
        "backup_records",
        sa.Column("restore_test_status", sa.String(30), nullable=True),
    )
    op.add_column(
        "backup_records", sa.Column("restore_tested_at", sa.DateTime(), nullable=True)
    )
    op.add_column(
        "backup_records", sa.Column("restore_test_summary", sa.Text(), nullable=True)
    )


def downgrade() -> None:
    op.drop_column("backup_records", "restore_test_summary")
    op.drop_column("backup_records", "restore_tested_at")
    op.drop_column("backup_records", "restore_test_status")
    op.drop_column("backup_records", "integrity_verified_at")
    op.drop_column("backup_records", "integrity_status")
