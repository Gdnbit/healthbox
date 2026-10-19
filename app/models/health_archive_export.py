"""Durable, self-service complete health archive export tasks."""

from sqlalchemy import (
    JSON,
    CheckConstraint,
    Column,
    DateTime,
    ForeignKey,
    Index,
    Integer,
    String,
    UniqueConstraint,
)

from .base import Base, get_utc_now


class HealthArchiveExport(Base):
    """Short-lived downloadable artifact backed by durable task metadata."""

    __tablename__ = "health_archive_exports"

    id = Column(Integer, primary_key=True)
    patient_id = Column(Integer, ForeignKey("patients.id"), nullable=False)
    requested_by_user_id = Column(Integer, ForeignKey("users.id"), nullable=False)
    idempotency_key = Column(String(64), nullable=False)
    schema_version = Column(
        String(50), nullable=False, default="household-health-archive/1.0"
    )
    status = Column(String(20), nullable=False, default="queued")
    attempt_count = Column(Integer, nullable=False, default=0)

    archive_filename = Column(String(255), nullable=False)
    archive_path = Column(String(500), nullable=True)
    archive_size_bytes = Column(Integer, nullable=True)
    archive_sha256 = Column(String(64), nullable=True)
    original_count = Column(Integer, nullable=False, default=0)
    manifest_summary = Column(JSON, nullable=False, default=dict)
    error_code = Column(String(80), nullable=True)

    started_at = Column(DateTime, nullable=True)
    completed_at = Column(DateTime, nullable=True)
    expires_at = Column(DateTime, nullable=True)
    cancelled_at = Column(DateTime, nullable=True)
    downloaded_at = Column(DateTime, nullable=True)
    created_at = Column(DateTime, nullable=False, default=get_utc_now)
    updated_at = Column(
        DateTime, nullable=False, default=get_utc_now, onupdate=get_utc_now
    )

    __table_args__ = (
        CheckConstraint(
            "status IN ('queued', 'running', 'ready', 'failed', 'cancelled', 'expired')",
            name="ck_health_archive_export_status",
        ),
        CheckConstraint(
            "attempt_count >= 0",
            name="ck_health_archive_export_attempts",
        ),
        CheckConstraint(
            "original_count >= 0",
            name="ck_health_archive_export_original_count",
        ),
        UniqueConstraint(
            "requested_by_user_id",
            "patient_id",
            "idempotency_key",
            name="uq_health_archive_export_request_key",
        ),
        Index(
            "idx_health_archive_export_requester",
            "requested_by_user_id",
            "created_at",
        ),
        Index("idx_health_archive_export_patient", "patient_id", "created_at"),
        Index("idx_health_archive_export_status", "status", "created_at"),
    )
