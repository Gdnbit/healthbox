from sqlalchemy import (
    Boolean,
    Column,
    Date,
    DateTime,
    ForeignKey,
    Index,
    Integer,
    String,
    Text,
    UniqueConstraint,
    text,
)

from .base import Base, get_utc_now


class HealthCoverageStatement(Base):
    """Immutable assertion explaining why a dated check has no observation."""

    __tablename__ = "health_coverage_statements"

    id = Column(Integer, primary_key=True)
    patient_id = Column(Integer, ForeignKey("patients.id"), nullable=False)
    created_by_user_id = Column(Integer, ForeignKey("users.id"), nullable=False)
    record_key = Column(String(36), nullable=False)
    version_number = Column(Integer, nullable=False)
    supersedes_statement_id = Column(
        Integer, ForeignKey("health_coverage_statements.id"), nullable=True
    )

    exam_date = Column(Date, nullable=False)
    metric_key = Column(String(255), nullable=False)
    metric_name = Column(String(255), nullable=False)
    metric_code = Column(String(100), nullable=True)
    absence_reason = Column(String(30), nullable=False)
    absence_reason_system = Column(String(255), nullable=False)
    verification_status = Column(String(30), nullable=False, default="needs_review")
    note = Column(Text, nullable=True)

    source_document_id = Column(
        Integer, ForeignKey("health_source_documents.id"), nullable=True
    )
    source_page = Column(Integer, nullable=True)
    source_locator = Column(String(255), nullable=True)

    status = Column(String(20), nullable=False, default="active")
    is_current = Column(Boolean, nullable=False, default=True)
    change_note = Column(Text, nullable=True)
    created_at = Column(DateTime, nullable=False, default=get_utc_now)

    __table_args__ = (
        UniqueConstraint(
            "record_key", "version_number", name="uq_health_coverage_key_version"
        ),
        Index("idx_health_coverage_patient", "patient_id"),
        Index("idx_health_coverage_exam_date", "patient_id", "exam_date"),
        Index("idx_health_coverage_record_key", "record_key"),
        Index("idx_health_coverage_source", "source_document_id"),
        Index(
            "uq_health_coverage_current_identity",
            "patient_id",
            "exam_date",
            "metric_key",
            unique=True,
            postgresql_where=text("is_current AND status <> 'voided'"),
            sqlite_where=text("is_current = 1 AND status <> 'voided'"),
        ),
    )
