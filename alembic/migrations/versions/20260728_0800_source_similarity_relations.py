"""Add reviewable source-image similarity relationships.

Revision ID: source_similarity_v1
Revises: health_ai_answers_v1
Create Date: 2026-07-28 08:00:00
"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "source_similarity_v1"
down_revision: Union[str, None] = "health_ai_answers_v1"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        "health_source_documents",
        sa.Column("visual_signature_algorithm", sa.String(length=80), nullable=True),
    )
    op.add_column(
        "health_source_documents",
        sa.Column("visual_signature", sa.JSON(), nullable=True),
    )
    op.create_table(
        "health_source_similarity_relations",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("patient_id", sa.Integer(), nullable=False),
        sa.Column("source_document_id", sa.Integer(), nullable=False),
        sa.Column("related_source_document_id", sa.Integer(), nullable=False),
        sa.Column("relation_type", sa.String(length=30), nullable=False),
        sa.Column("confidence", sa.Float(), nullable=False),
        sa.Column("algorithm_version", sa.String(length=80), nullable=False),
        sa.Column("evidence", sa.JSON(), nullable=False),
        sa.Column(
            "review_status",
            sa.String(length=20),
            nullable=False,
            server_default="pending",
        ),
        sa.Column("reviewed_by_user_id", sa.Integer(), nullable=True),
        sa.Column("reviewed_at", sa.DateTime(), nullable=True),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.Column("updated_at", sa.DateTime(), nullable=False),
        sa.CheckConstraint(
            "source_document_id < related_source_document_id",
            name="ck_health_source_similarity_pair_order",
        ),
        sa.CheckConstraint(
            "relation_type IN ('near_duplicate', 'partial_overlap')",
            name="ck_health_source_similarity_type",
        ),
        sa.CheckConstraint(
            "confidence >= 0 AND confidence <= 1",
            name="ck_health_source_similarity_confidence",
        ),
        sa.CheckConstraint(
            "review_status IN ('pending', 'confirmed', 'dismissed')",
            name="ck_health_source_similarity_review_status",
        ),
        sa.ForeignKeyConstraint(
            ["patient_id"],
            ["patients.id"],
            ondelete="CASCADE",
        ),
        sa.ForeignKeyConstraint(
            ["related_source_document_id"],
            ["health_source_documents.id"],
            ondelete="CASCADE",
        ),
        sa.ForeignKeyConstraint(
            ["reviewed_by_user_id"],
            ["users.id"],
            ondelete="SET NULL",
        ),
        sa.ForeignKeyConstraint(
            ["source_document_id"],
            ["health_source_documents.id"],
            ondelete="CASCADE",
        ),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint(
            "source_document_id",
            "related_source_document_id",
            "algorithm_version",
            name="uq_health_source_similarity_pair_version",
        ),
    )
    op.create_index(
        "idx_health_source_similarity_patient_status",
        "health_source_similarity_relations",
        ["patient_id", "review_status", "created_at"],
        unique=False,
    )
    op.create_index(
        "idx_health_source_similarity_related",
        "health_source_similarity_relations",
        ["related_source_document_id"],
        unique=False,
    )
    op.create_index(
        "idx_health_source_similarity_source",
        "health_source_similarity_relations",
        ["source_document_id"],
        unique=False,
    )


def downgrade() -> None:
    op.drop_index(
        "idx_health_source_similarity_source",
        table_name="health_source_similarity_relations",
    )
    op.drop_index(
        "idx_health_source_similarity_related",
        table_name="health_source_similarity_relations",
    )
    op.drop_index(
        "idx_health_source_similarity_patient_status",
        table_name="health_source_similarity_relations",
    )
    op.drop_table("health_source_similarity_relations")
    op.drop_column("health_source_documents", "visual_signature")
    op.drop_column("health_source_documents", "visual_signature_algorithm")
