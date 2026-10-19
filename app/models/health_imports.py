from sqlalchemy import (
    JSON,
    CheckConstraint,
    Column,
    Date,
    DateTime,
    Float,
    ForeignKey,
    Index,
    Integer,
    String,
    Text,
    UniqueConstraint,
)
from sqlalchemy.orm import relationship as orm_relationship

from .base import Base, get_utc_now


class HealthSourceDocument(Base):
    """Original household health document and its immutable source metadata."""

    __tablename__ = "health_source_documents"

    id = Column(Integer, primary_key=True)
    patient_id = Column(Integer, ForeignKey("patients.id"), nullable=False)
    created_by_user_id = Column(Integer, ForeignKey("users.id"), nullable=False)
    primary_file_id = Column(Integer, ForeignKey("entity_files.id"), nullable=True)

    display_name = Column(String(255), nullable=False)
    original_filename = Column(String(255), nullable=False)
    document_type = Column(String(50), nullable=False, default="other")
    report_date = Column(Date, nullable=True)
    facility = Column(String(255), nullable=True)
    mime_type = Column(String(100), nullable=False)
    size_bytes = Column(Integer, nullable=False)
    sha256 = Column(String(64), nullable=False)
    visual_signature_algorithm = Column(String(80), nullable=True)
    visual_signature = Column(JSON, nullable=True)
    storage_backend = Column(String(20), nullable=False, default="local")
    status = Column(String(20), nullable=False, default="uploaded")
    withdrawn_at = Column(DateTime, nullable=True)
    withdrawn_by_user_id = Column(Integer, ForeignKey("users.id"), nullable=True)
    withdrawal_reason = Column(String(500), nullable=True)
    withdrawal_previous_status = Column(String(20), nullable=True)
    duplicate_of_source_document_id = Column(
        Integer, ForeignKey("health_source_documents.id"), nullable=True
    )
    created_at = Column(DateTime, nullable=False, default=get_utc_now)
    updated_at = Column(
        DateTime, nullable=False, default=get_utc_now, onupdate=get_utc_now
    )

    import_batches = orm_relationship(
        "HealthImportBatch",
        back_populates="source_document",
        cascade="all, delete-orphan",
    )
    parse_tasks = orm_relationship(
        "HealthSourceParseTask",
        back_populates="source_document",
        cascade="all, delete-orphan",
    )

    __table_args__ = (
        Index("idx_health_source_patient", "patient_id"),
        Index("idx_health_source_patient_hash", "patient_id", "sha256"),
        Index("idx_health_source_report_date", "patient_id", "report_date"),
        Index("idx_health_source_status", "status"),
    )


class HealthSourceUploadBatch(Base):
    """Recoverable manifest for one user-selected group of original files."""

    __tablename__ = "health_source_upload_batches"

    id = Column(Integer, primary_key=True)
    patient_id = Column(Integer, ForeignKey("patients.id"), nullable=False)
    created_by_user_id = Column(Integer, ForeignKey("users.id"), nullable=False)
    idempotency_key = Column(String(64), nullable=False)
    manifest_sha256 = Column(String(64), nullable=False)
    document_type = Column(String(50), nullable=False, default="other")
    report_date = Column(Date, nullable=True)
    facility = Column(String(255), nullable=True)
    status = Column(String(20), nullable=False, default="open")
    expected_file_count = Column(Integer, nullable=False)
    expected_total_bytes = Column(Integer, nullable=False)
    created_at = Column(DateTime, nullable=False, default=get_utc_now)
    completed_at = Column(DateTime, nullable=True)
    cancelled_at = Column(DateTime, nullable=True)
    updated_at = Column(
        DateTime, nullable=False, default=get_utc_now, onupdate=get_utc_now
    )

    items = orm_relationship(
        "HealthSourceUploadItem",
        back_populates="batch",
        cascade="all, delete-orphan",
        order_by="HealthSourceUploadItem.sequence",
    )

    __table_args__ = (
        CheckConstraint(
            "status IN ('open', 'completed', 'partial', 'cancelled')",
            name="ck_health_source_upload_batch_status",
        ),
        CheckConstraint(
            "expected_file_count >= 1 AND expected_file_count <= 30",
            name="ck_health_source_upload_batch_file_count",
        ),
        CheckConstraint(
            "expected_total_bytes > 0",
            name="ck_health_source_upload_batch_total_bytes",
        ),
        UniqueConstraint(
            "patient_id",
            "idempotency_key",
            name="uq_health_source_upload_patient_key",
        ),
        Index("idx_health_source_upload_patient", "patient_id"),
        Index("idx_health_source_upload_status", "status"),
    )


class HealthSourceUploadItem(Base):
    """Server-side state for one original file declared in an upload manifest."""

    __tablename__ = "health_source_upload_items"

    id = Column(Integer, primary_key=True)
    batch_id = Column(
        Integer, ForeignKey("health_source_upload_batches.id"), nullable=False
    )
    client_item_id = Column(String(64), nullable=False)
    sequence = Column(Integer, nullable=False)
    original_filename = Column(String(255), nullable=False)
    mime_type = Column(String(100), nullable=False)
    size_bytes = Column(Integer, nullable=False)
    client_sha256 = Column(String(64), nullable=True)
    actual_sha256 = Column(String(64), nullable=True)
    status = Column(String(20), nullable=False, default="pending")
    source_document_id = Column(
        Integer, ForeignKey("health_source_documents.id"), nullable=True
    )
    duplicate_source_document_id = Column(
        Integer, ForeignKey("health_source_documents.id"), nullable=True
    )
    attempt_count = Column(Integer, nullable=False, default=0)
    last_error_code = Column(String(50), nullable=True)
    created_at = Column(DateTime, nullable=False, default=get_utc_now)
    updated_at = Column(
        DateTime, nullable=False, default=get_utc_now, onupdate=get_utc_now
    )

    batch = orm_relationship("HealthSourceUploadBatch", back_populates="items")

    __table_args__ = (
        CheckConstraint(
            "status IN ('pending', 'uploaded', 'duplicate', 'failed', 'cancelled')",
            name="ck_health_source_upload_item_status",
        ),
        CheckConstraint(
            "sequence >= 1",
            name="ck_health_source_upload_item_sequence",
        ),
        CheckConstraint(
            "size_bytes > 0",
            name="ck_health_source_upload_item_size",
        ),
        CheckConstraint(
            "attempt_count >= 0",
            name="ck_health_source_upload_item_attempts",
        ),
        UniqueConstraint(
            "batch_id",
            "client_item_id",
            name="uq_health_source_upload_item_client_id",
        ),
        UniqueConstraint(
            "batch_id",
            "sequence",
            name="uq_health_source_upload_item_sequence",
        ),
        Index("idx_health_source_upload_item_batch", "batch_id"),
        Index("idx_health_source_upload_item_status", "status"),
        Index("idx_health_source_upload_item_source", "source_document_id"),
    )


class HealthSourceSimilarityRelation(Base):
    """Reviewable image-similarity candidate that never mutates either original."""

    __tablename__ = "health_source_similarity_relations"

    id = Column(Integer, primary_key=True)
    patient_id = Column(Integer, ForeignKey("patients.id"), nullable=False)
    source_document_id = Column(
        Integer,
        ForeignKey("health_source_documents.id", ondelete="CASCADE"),
        nullable=False,
    )
    related_source_document_id = Column(
        Integer,
        ForeignKey("health_source_documents.id", ondelete="CASCADE"),
        nullable=False,
    )
    relation_type = Column(String(30), nullable=False)
    confidence = Column(Float, nullable=False)
    algorithm_version = Column(String(80), nullable=False)
    evidence = Column(JSON, nullable=False, default=dict)
    review_status = Column(String(20), nullable=False, default="pending")
    reviewed_by_user_id = Column(
        Integer,
        ForeignKey("users.id", ondelete="SET NULL"),
        nullable=True,
    )
    reviewed_at = Column(DateTime, nullable=True)
    created_at = Column(DateTime, nullable=False, default=get_utc_now)
    updated_at = Column(
        DateTime, nullable=False, default=get_utc_now, onupdate=get_utc_now
    )

    __table_args__ = (
        CheckConstraint(
            "source_document_id < related_source_document_id",
            name="ck_health_source_similarity_pair_order",
        ),
        CheckConstraint(
            "relation_type IN ('near_duplicate', 'partial_overlap')",
            name="ck_health_source_similarity_type",
        ),
        CheckConstraint(
            "confidence >= 0 AND confidence <= 1",
            name="ck_health_source_similarity_confidence",
        ),
        CheckConstraint(
            "review_status IN ('pending', 'confirmed', 'dismissed')",
            name="ck_health_source_similarity_review_status",
        ),
        UniqueConstraint(
            "source_document_id",
            "related_source_document_id",
            "algorithm_version",
            name="uq_health_source_similarity_pair_version",
        ),
        Index(
            "idx_health_source_similarity_patient_status",
            "patient_id",
            "review_status",
            "created_at",
        ),
        Index(
            "idx_health_source_similarity_source",
            "source_document_id",
        ),
        Index(
            "idx_health_source_similarity_related",
            "related_source_document_id",
        ),
    )


class HealthSourceParseTask(Base):
    """Durable local parsing job that may only create review candidates."""

    __tablename__ = "health_source_parse_tasks"

    id = Column(Integer, primary_key=True)
    patient_id = Column(Integer, ForeignKey("patients.id"), nullable=False)
    source_document_id = Column(
        Integer, ForeignKey("health_source_documents.id"), nullable=False
    )
    created_by_user_id = Column(Integer, ForeignKey("users.id"), nullable=False)
    import_batch_id = Column(
        Integer, ForeignKey("health_import_batches.id"), nullable=True
    )
    idempotency_key = Column(String(64), nullable=False)
    parser_name = Column(String(100), nullable=False, default="local-core-lab")
    parser_version = Column(String(50), nullable=False)
    status = Column(String(20), nullable=False, default="queued")
    attempt_count = Column(Integer, nullable=False, default=0)
    summary = Column(JSON, nullable=False, default=dict)
    error_code = Column(String(80), nullable=True)
    started_at = Column(DateTime, nullable=True)
    completed_at = Column(DateTime, nullable=True)
    cancelled_at = Column(DateTime, nullable=True)
    created_at = Column(DateTime, nullable=False, default=get_utc_now)
    updated_at = Column(
        DateTime, nullable=False, default=get_utc_now, onupdate=get_utc_now
    )

    source_document = orm_relationship(
        "HealthSourceDocument", back_populates="parse_tasks"
    )

    __table_args__ = (
        CheckConstraint(
            "status IN ('queued', 'running', 'succeeded', 'failed', 'cancelled')",
            name="ck_health_source_parse_task_status",
        ),
        CheckConstraint(
            "attempt_count >= 0",
            name="ck_health_source_parse_task_attempts",
        ),
        UniqueConstraint(
            "patient_id",
            "idempotency_key",
            name="uq_health_source_parse_patient_key",
        ),
        Index("idx_health_source_parse_patient", "patient_id"),
        Index("idx_health_source_parse_source", "source_document_id"),
        Index("idx_health_source_parse_status", "status"),
        Index("idx_health_source_parse_import_batch", "import_batch_id"),
    )


class HealthImportBatch(Base):
    """Idempotent, review-first extraction batch for one source document."""

    __tablename__ = "health_import_batches"

    id = Column(Integer, primary_key=True)
    patient_id = Column(Integer, ForeignKey("patients.id"), nullable=False)
    source_document_id = Column(
        Integer, ForeignKey("health_source_documents.id"), nullable=False
    )
    created_by_user_id = Column(Integer, ForeignKey("users.id"), nullable=False)
    idempotency_key = Column(String(64), nullable=False)
    parser_name = Column(String(100), nullable=False, default="manual")
    parser_version = Column(String(50), nullable=True)
    status = Column(String(20), nullable=False, default="pending_review")
    summary = Column(JSON, nullable=False, default=dict)
    subject_identity_status = Column(String(30), nullable=False, default="unavailable")
    subject_identity_observed_name = Column(String(255), nullable=True)
    subject_identity_confidence = Column(Float, nullable=True)
    subject_identity_assessment_version = Column(String(80), nullable=True)
    subject_identity_evidence = Column(JSON, nullable=True)
    subject_mismatch_confirmed_by_user_id = Column(
        Integer, ForeignKey("users.id"), nullable=True
    )
    subject_mismatch_confirmed_at = Column(DateTime, nullable=True)
    created_at = Column(DateTime, nullable=False, default=get_utc_now)
    reviewed_at = Column(DateTime, nullable=True)
    committed_at = Column(DateTime, nullable=True)
    rolled_back_at = Column(DateTime, nullable=True)
    updated_at = Column(
        DateTime, nullable=False, default=get_utc_now, onupdate=get_utc_now
    )

    source_document = orm_relationship(
        "HealthSourceDocument", back_populates="import_batches"
    )
    items = orm_relationship(
        "HealthImportItem",
        back_populates="batch",
        cascade="all, delete-orphan",
        order_by="HealthImportItem.sequence",
    )

    @property
    def subject_mismatch_warning(self):
        if self.subject_identity_status != "suspected_mismatch":
            return None
        return {
            "code": "subject_mismatch_suspected",
            "observed_name": self.subject_identity_observed_name,
            "confidence": self.subject_identity_confidence,
            "assessment_version": self.subject_identity_assessment_version,
            "evidence": self.subject_identity_evidence or {},
            "confirmation_required": self.subject_mismatch_confirmed_at is None,
            "confirmed_at": self.subject_mismatch_confirmed_at,
        }

    __table_args__ = (
        UniqueConstraint(
            "patient_id", "idempotency_key", name="uq_health_import_patient_key"
        ),
        CheckConstraint(
            "subject_identity_status IN "
            "('unavailable', 'matched', 'suspected_mismatch')",
            name="ck_health_import_subject_identity_status",
        ),
        CheckConstraint(
            "subject_identity_confidence IS NULL OR "
            "(subject_identity_confidence >= 0 AND subject_identity_confidence <= 1)",
            name="ck_health_import_subject_identity_confidence",
        ),
        CheckConstraint(
            "subject_identity_status != 'suspected_mismatch' OR "
            "(subject_identity_observed_name IS NOT NULL AND "
            "subject_identity_confidence IS NOT NULL AND "
            "subject_identity_assessment_version IS NOT NULL AND "
            "subject_identity_evidence IS NOT NULL)",
            name="ck_health_import_subject_mismatch_evidence",
        ),
        Index("idx_health_import_patient", "patient_id"),
        Index("idx_health_import_source", "source_document_id"),
        Index("idx_health_import_status", "status"),
    )


class HealthImportItem(Base):
    """Candidate observation that cannot reach official tables without review."""

    __tablename__ = "health_import_items"

    id = Column(Integer, primary_key=True)
    batch_id = Column(Integer, ForeignKey("health_import_batches.id"), nullable=False)
    sequence = Column(Integer, nullable=False)
    observed_date = Column(Date, nullable=True)
    test_name = Column(String(255), nullable=False)
    canonical_test_name = Column(String(255), nullable=True)
    test_code = Column(String(100), nullable=True)
    result_type = Column(String(20), nullable=False, default="quantitative")
    numeric_value = Column(Float, nullable=True)
    qualitative_value = Column(String(100), nullable=True)
    textual_value = Column(Text, nullable=True)
    unit = Column(String(100), nullable=True)
    ref_range_min = Column(Float, nullable=True)
    ref_range_max = Column(Float, nullable=True)
    ref_range_text = Column(String(500), nullable=True)
    result_status = Column(String(30), nullable=True)
    category = Column(String(100), nullable=True)
    source_page = Column(Integer, nullable=True)
    source_locator = Column(String(255), nullable=True)
    raw_text = Column(Text, nullable=True)
    confidence = Column(Float, nullable=True)

    decision = Column(String(20), nullable=False, default="pending")
    duplicate_of_component_id = Column(
        Integer, ForeignKey("lab_test_components.id"), nullable=True
    )
    duplicate_reason = Column(String(255), nullable=True)
    duplicate_override_reason = Column(Text, nullable=True)
    review_notes = Column(Text, nullable=True)
    validation_issues = Column(JSON, nullable=False, default=list)

    created_lab_result_id = Column(Integer, ForeignKey("lab_results.id"), nullable=True)
    created_component_id = Column(
        Integer, ForeignKey("lab_test_components.id"), nullable=True
    )
    created_at = Column(DateTime, nullable=False, default=get_utc_now)
    updated_at = Column(
        DateTime, nullable=False, default=get_utc_now, onupdate=get_utc_now
    )

    batch = orm_relationship("HealthImportBatch", back_populates="items")

    __table_args__ = (
        UniqueConstraint("batch_id", "sequence", name="uq_health_import_item_sequence"),
        Index("idx_health_import_item_batch", "batch_id"),
        Index("idx_health_import_item_decision", "decision"),
        Index("idx_health_import_item_created_component", "created_component_id"),
    )


class HealthFormalMetricRevision(Base):
    """Append-only value history for one formally imported lab component."""

    __tablename__ = "health_formal_metric_revisions"

    id = Column(Integer, primary_key=True)
    component_id = Column(
        Integer,
        ForeignKey("lab_test_components.id", ondelete="CASCADE"),
        nullable=False,
    )
    patient_id = Column(
        Integer,
        ForeignKey("patients.id", ondelete="CASCADE"),
        nullable=False,
    )
    version = Column(Integer, nullable=False)
    action = Column(String(20), nullable=False)
    supersedes_revision_id = Column(
        Integer,
        ForeignKey("health_formal_metric_revisions.id", ondelete="RESTRICT"),
        nullable=True,
    )
    reason = Column(Text, nullable=True)
    idempotency_key = Column(String(64), nullable=False)
    request_hash = Column(String(64), nullable=False)

    result_type = Column(String(20), nullable=False)
    numeric_value = Column(Float, nullable=True)
    qualitative_value = Column(String(100), nullable=True)
    textual_value = Column(Text, nullable=True)
    unit = Column(String(100), nullable=True)
    ref_range_min = Column(Float, nullable=True)
    ref_range_max = Column(Float, nullable=True)
    ref_range_text = Column(String(500), nullable=True)
    result_status = Column(String(30), nullable=True)

    created_by_user_id = Column(
        Integer,
        ForeignKey("users.id", ondelete="RESTRICT"),
        nullable=False,
    )
    created_at = Column(DateTime, nullable=False, default=get_utc_now)

    __table_args__ = (
        UniqueConstraint(
            "component_id",
            "version",
            name="uq_health_formal_metric_revision_version",
        ),
        UniqueConstraint(
            "component_id",
            "idempotency_key",
            name="uq_health_formal_metric_revision_request",
        ),
        CheckConstraint(
            "version >= 1",
            name="ck_health_formal_metric_revision_version",
        ),
        CheckConstraint(
            "action IN ('created', 'revised')",
            name="ck_health_formal_metric_revision_action",
        ),
        CheckConstraint(
            "(version = 1 AND action = 'created' AND "
            "supersedes_revision_id IS NULL AND reason IS NULL) OR "
            "(version > 1 AND action = 'revised' AND "
            "supersedes_revision_id IS NOT NULL AND reason IS NOT NULL)",
            name="ck_health_formal_metric_revision_chain",
        ),
        CheckConstraint(
            "result_type IN ('quantitative', 'qualitative', 'textual')",
            name="ck_health_formal_metric_revision_result_type",
        ),
        CheckConstraint(
            "(result_type = 'quantitative' AND numeric_value IS NOT NULL "
            "AND qualitative_value IS NULL AND textual_value IS NULL) OR "
            "(result_type = 'qualitative' AND numeric_value IS NULL "
            "AND qualitative_value IS NOT NULL AND textual_value IS NULL "
            "AND ref_range_min IS NULL AND ref_range_max IS NULL) OR "
            "(result_type = 'textual' AND numeric_value IS NULL "
            "AND qualitative_value IS NULL AND textual_value IS NOT NULL "
            "AND ref_range_min IS NULL AND ref_range_max IS NULL)",
            name="ck_health_formal_metric_revision_value",
        ),
        CheckConstraint(
            "ref_range_min IS NULL OR ref_range_max IS NULL OR "
            "ref_range_min < ref_range_max",
            name="ck_health_formal_metric_revision_range",
        ),
        Index(
            "idx_health_formal_metric_revision_component",
            "component_id",
            "version",
        ),
        Index(
            "idx_health_formal_metric_revision_patient",
            "patient_id",
            "created_at",
        ),
    )
