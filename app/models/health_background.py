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
)

from .base import Base, get_utc_now


class HealthBackgroundEntry(Base):
    """Immutable version of a member's narrative health background."""

    __tablename__ = "health_background_entries"

    id = Column(Integer, primary_key=True)
    patient_id = Column(Integer, ForeignKey("patients.id"), nullable=False)
    created_by_user_id = Column(Integer, ForeignKey("users.id"), nullable=False)
    record_key = Column(String(36), nullable=False)
    version_number = Column(Integer, nullable=False)
    supersedes_entry_id = Column(
        Integer, ForeignKey("health_background_entries.id"), nullable=True
    )

    category = Column(String(50), nullable=False)
    title = Column(String(255), nullable=False)
    narrative = Column(Text, nullable=False)
    effective_date = Column(Date, nullable=True)
    verification_status = Column(String(30), nullable=False, default="needs_review")
    status = Column(String(20), nullable=False, default="active")
    is_current = Column(Boolean, nullable=False, default=True)
    change_note = Column(Text, nullable=True)

    source_document_id = Column(
        Integer, ForeignKey("health_source_documents.id"), nullable=True
    )
    source_page = Column(Integer, nullable=True)
    source_locator = Column(String(255), nullable=True)

    created_at = Column(DateTime, nullable=False, default=get_utc_now)

    __table_args__ = (
        UniqueConstraint(
            "record_key", "version_number", name="uq_health_background_key_version"
        ),
        Index("idx_health_background_patient", "patient_id"),
        Index("idx_health_background_patient_current", "patient_id", "is_current"),
        Index("idx_health_background_record_key", "record_key"),
        Index("idx_health_background_effective_date", "patient_id", "effective_date"),
        Index("idx_health_background_source", "source_document_id"),
    )
