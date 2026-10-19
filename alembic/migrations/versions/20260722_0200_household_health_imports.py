"""Add household source documents and review-first health imports.

Revision ID: household_health_imports
Revises: default_user_language_zh
Create Date: 2026-07-22 02:00:00.000000
"""

from alembic import op
import sqlalchemy as sa

revision = "household_health_imports"
down_revision = "default_user_language_zh"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "health_source_documents",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("patient_id", sa.Integer(), nullable=False),
        sa.Column("created_by_user_id", sa.Integer(), nullable=False),
        sa.Column("primary_file_id", sa.Integer(), nullable=True),
        sa.Column("display_name", sa.String(length=255), nullable=False),
        sa.Column("original_filename", sa.String(length=255), nullable=False),
        sa.Column("document_type", sa.String(length=50), nullable=False),
        sa.Column("report_date", sa.Date(), nullable=True),
        sa.Column("facility", sa.String(length=255), nullable=True),
        sa.Column("mime_type", sa.String(length=100), nullable=False),
        sa.Column("size_bytes", sa.Integer(), nullable=False),
        sa.Column("sha256", sa.String(length=64), nullable=False),
        sa.Column("storage_backend", sa.String(length=20), nullable=False),
        sa.Column("status", sa.String(length=20), nullable=False),
        sa.Column("duplicate_of_source_document_id", sa.Integer(), nullable=True),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.Column("updated_at", sa.DateTime(), nullable=False),
        sa.ForeignKeyConstraint(["created_by_user_id"], ["users.id"]),
        sa.ForeignKeyConstraint(["patient_id"], ["patients.id"]),
        sa.ForeignKeyConstraint(["primary_file_id"], ["entity_files.id"]),
        sa.ForeignKeyConstraint(
            ["duplicate_of_source_document_id"], ["health_source_documents.id"]
        ),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(
        "idx_health_source_patient", "health_source_documents", ["patient_id"]
    )
    op.create_index(
        "idx_health_source_patient_hash",
        "health_source_documents",
        ["patient_id", "sha256"],
    )
    op.create_index(
        "idx_health_source_report_date",
        "health_source_documents",
        ["patient_id", "report_date"],
    )
    op.create_index("idx_health_source_status", "health_source_documents", ["status"])

    op.create_table(
        "health_import_batches",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("patient_id", sa.Integer(), nullable=False),
        sa.Column("source_document_id", sa.Integer(), nullable=False),
        sa.Column("created_by_user_id", sa.Integer(), nullable=False),
        sa.Column("idempotency_key", sa.String(length=64), nullable=False),
        sa.Column("parser_name", sa.String(length=100), nullable=False),
        sa.Column("parser_version", sa.String(length=50), nullable=True),
        sa.Column("status", sa.String(length=20), nullable=False),
        sa.Column("summary", sa.JSON(), nullable=False),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.Column("reviewed_at", sa.DateTime(), nullable=True),
        sa.Column("committed_at", sa.DateTime(), nullable=True),
        sa.Column("rolled_back_at", sa.DateTime(), nullable=True),
        sa.Column("updated_at", sa.DateTime(), nullable=False),
        sa.ForeignKeyConstraint(["created_by_user_id"], ["users.id"]),
        sa.ForeignKeyConstraint(["patient_id"], ["patients.id"]),
        sa.ForeignKeyConstraint(["source_document_id"], ["health_source_documents.id"]),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint(
            "patient_id", "idempotency_key", name="uq_health_import_patient_key"
        ),
    )
    op.create_index(
        "idx_health_import_patient", "health_import_batches", ["patient_id"]
    )
    op.create_index(
        "idx_health_import_source", "health_import_batches", ["source_document_id"]
    )
    op.create_index("idx_health_import_status", "health_import_batches", ["status"])

    with op.batch_alter_table("lab_test_components") as batch_op:
        batch_op.add_column(
            sa.Column("source_document_id", sa.Integer(), nullable=True)
        )
        batch_op.add_column(sa.Column("source_page", sa.Integer(), nullable=True))
        batch_op.add_column(
            sa.Column("source_locator", sa.String(length=255), nullable=True)
        )
        batch_op.add_column(sa.Column("import_batch_id", sa.Integer(), nullable=True))
        batch_op.create_foreign_key(
            "fk_lab_component_source_document",
            "health_source_documents",
            ["source_document_id"],
            ["id"],
        )
        batch_op.create_foreign_key(
            "fk_lab_component_import_batch",
            "health_import_batches",
            ["import_batch_id"],
            ["id"],
        )
        batch_op.create_index(
            "idx_lab_test_components_source_document", ["source_document_id"]
        )
        batch_op.create_index(
            "idx_lab_test_components_import_batch", ["import_batch_id"]
        )

    op.create_table(
        "health_import_items",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("batch_id", sa.Integer(), nullable=False),
        sa.Column("sequence", sa.Integer(), nullable=False),
        sa.Column("observed_date", sa.Date(), nullable=True),
        sa.Column("test_name", sa.String(length=255), nullable=False),
        sa.Column("canonical_test_name", sa.String(length=255), nullable=True),
        sa.Column("test_code", sa.String(length=100), nullable=True),
        sa.Column("result_type", sa.String(length=20), nullable=False),
        sa.Column("numeric_value", sa.Float(), nullable=True),
        sa.Column("qualitative_value", sa.String(length=100), nullable=True),
        sa.Column("textual_value", sa.Text(), nullable=True),
        sa.Column("unit", sa.String(length=100), nullable=True),
        sa.Column("ref_range_min", sa.Float(), nullable=True),
        sa.Column("ref_range_max", sa.Float(), nullable=True),
        sa.Column("ref_range_text", sa.String(length=500), nullable=True),
        sa.Column("result_status", sa.String(length=30), nullable=True),
        sa.Column("category", sa.String(length=100), nullable=True),
        sa.Column("source_page", sa.Integer(), nullable=True),
        sa.Column("source_locator", sa.String(length=255), nullable=True),
        sa.Column("decision", sa.String(length=20), nullable=False),
        sa.Column("duplicate_of_component_id", sa.Integer(), nullable=True),
        sa.Column("duplicate_reason", sa.String(length=255), nullable=True),
        sa.Column("duplicate_override_reason", sa.Text(), nullable=True),
        sa.Column("review_notes", sa.Text(), nullable=True),
        sa.Column("validation_issues", sa.JSON(), nullable=False),
        sa.Column("created_lab_result_id", sa.Integer(), nullable=True),
        sa.Column("created_component_id", sa.Integer(), nullable=True),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.Column("updated_at", sa.DateTime(), nullable=False),
        sa.ForeignKeyConstraint(["batch_id"], ["health_import_batches.id"]),
        sa.ForeignKeyConstraint(["created_component_id"], ["lab_test_components.id"]),
        sa.ForeignKeyConstraint(["created_lab_result_id"], ["lab_results.id"]),
        sa.ForeignKeyConstraint(
            ["duplicate_of_component_id"], ["lab_test_components.id"]
        ),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint(
            "batch_id", "sequence", name="uq_health_import_item_sequence"
        ),
    )
    op.create_index("idx_health_import_item_batch", "health_import_items", ["batch_id"])
    op.create_index(
        "idx_health_import_item_decision", "health_import_items", ["decision"]
    )
    op.create_index(
        "idx_health_import_item_created_component",
        "health_import_items",
        ["created_component_id"],
    )


def downgrade() -> None:
    op.drop_index(
        "idx_health_import_item_created_component", table_name="health_import_items"
    )
    op.drop_index("idx_health_import_item_decision", table_name="health_import_items")
    op.drop_index("idx_health_import_item_batch", table_name="health_import_items")
    op.drop_table("health_import_items")

    with op.batch_alter_table("lab_test_components") as batch_op:
        batch_op.drop_index("idx_lab_test_components_import_batch")
        batch_op.drop_index("idx_lab_test_components_source_document")
        batch_op.drop_constraint("fk_lab_component_import_batch", type_="foreignkey")
        batch_op.drop_constraint("fk_lab_component_source_document", type_="foreignkey")
        batch_op.drop_column("import_batch_id")
        batch_op.drop_column("source_locator")
        batch_op.drop_column("source_page")
        batch_op.drop_column("source_document_id")

    op.drop_index("idx_health_import_status", table_name="health_import_batches")
    op.drop_index("idx_health_import_source", table_name="health_import_batches")
    op.drop_index("idx_health_import_patient", table_name="health_import_batches")
    op.drop_table("health_import_batches")

    op.drop_index("idx_health_source_status", table_name="health_source_documents")
    op.drop_index("idx_health_source_report_date", table_name="health_source_documents")
    op.drop_index(
        "idx_health_source_patient_hash", table_name="health_source_documents"
    )
    op.drop_index("idx_health_source_patient", table_name="health_source_documents")
    op.drop_table("health_source_documents")
