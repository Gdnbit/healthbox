"""Persisted AI answers and their privacy-minimized request ledger."""

from sqlalchemy import (
    JSON,
    CheckConstraint,
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


class HealthAiAnswer(Base):
    """One owner-only model answer and its immutable evidence snapshot."""

    __tablename__ = "health_ai_answers"

    id = Column(Integer, primary_key=True)
    request_id = Column(String(36), nullable=False)
    patient_id = Column(
        Integer,
        ForeignKey("patients.id", ondelete="CASCADE"),
        nullable=False,
    )
    requested_by_user_id = Column(
        Integer,
        ForeignKey("users.id", ondelete="CASCADE"),
        nullable=False,
    )
    question_id = Column(String(40), nullable=False)
    question = Column(Text, nullable=False)
    range_id = Column(String(10), nullable=False)
    provider_name = Column(String(80), nullable=False)
    model_name = Column(String(160), nullable=False)
    processing_location = Column(String(120), nullable=False)
    template_version = Column(String(80), nullable=False)
    data_cutoff = Column(Date, nullable=False)
    record_count = Column(Integer, nullable=False)
    metric_count = Column(Integer, nullable=False)
    answer_items = Column(JSON, nullable=False, default=list)
    general_explanations = Column(JSON, nullable=False, default=list)
    citations = Column(JSON, nullable=False, default=list)
    limitations = Column(JSON, nullable=False, default=list)
    next_steps = Column(JSON, nullable=False, default=list)
    disclaimer = Column(Text, nullable=False)
    generated_at = Column(DateTime, nullable=False, default=get_utc_now)

    __table_args__ = (
        CheckConstraint(
            "range_id IN ('1y', '3y', '5y', 'all')",
            name="ck_health_ai_answer_range",
        ),
        CheckConstraint(
            "record_count >= 1",
            name="ck_health_ai_answer_record_count",
        ),
        CheckConstraint(
            "metric_count >= 1",
            name="ck_health_ai_answer_metric_count",
        ),
        UniqueConstraint("request_id", name="uq_health_ai_answer_request_id"),
        Index(
            "idx_health_ai_answer_owner_history",
            "requested_by_user_id",
            "patient_id",
            "generated_at",
        ),
    )


class HealthAiRequest(Base):
    """Durable idempotency, admission, and terminal-state metadata.

    The request key and canonical request are retained only as SHA-256 digests.
    Health values, record identifiers, prompts, answers, provider output, and
    provider configuration deliberately do not belong in this ledger.
    """

    __tablename__ = "health_ai_requests"

    id = Column(Integer, primary_key=True)
    requested_by_user_id = Column(
        Integer,
        ForeignKey("users.id", ondelete="CASCADE"),
        nullable=False,
    )
    patient_id = Column(
        Integer,
        ForeignKey("patients.id", ondelete="CASCADE"),
        nullable=False,
    )
    idempotency_key_sha256 = Column(String(64), nullable=False)
    request_sha256 = Column(String(64), nullable=False)
    request_id = Column(String(36), nullable=False)
    status = Column(String(16), nullable=False, default="in_progress")
    answer_id = Column(
        Integer,
        ForeignKey("health_ai_answers.id", ondelete="SET NULL"),
        nullable=True,
    )
    safe_error_code = Column(String(80), nullable=True)
    safe_http_status = Column(Integer, nullable=True)
    admitted_at = Column(DateTime(timezone=True), nullable=False, default=get_utc_now)
    lease_expires_at = Column(DateTime(timezone=True), nullable=False)
    completed_at = Column(DateTime(timezone=True), nullable=True)
    created_at = Column(DateTime(timezone=True), nullable=False, default=get_utc_now)
    updated_at = Column(
        DateTime(timezone=True),
        nullable=False,
        default=get_utc_now,
        onupdate=get_utc_now,
    )

    __table_args__ = (
        CheckConstraint(
            "status IN ('in_progress', 'succeeded', 'failed')",
            name="ck_health_ai_request_status",
        ),
        CheckConstraint(
            "safe_http_status IS NULL "
            "OR (safe_http_status >= 400 AND safe_http_status <= 599)",
            name="ck_health_ai_request_safe_http_status",
        ),
        CheckConstraint(
            "status != 'failed' "
            "OR (safe_error_code IS NOT NULL AND safe_http_status IS NOT NULL)",
            name="ck_health_ai_request_failed_error",
        ),
        CheckConstraint(
            "status = 'in_progress' OR completed_at IS NOT NULL",
            name="ck_health_ai_request_terminal_completed",
        ),
        UniqueConstraint(
            "requested_by_user_id",
            "idempotency_key_sha256",
            name="uq_health_ai_request_user_key_hash",
        ),
        UniqueConstraint("request_id", name="uq_health_ai_request_request_id"),
        UniqueConstraint("answer_id", name="uq_health_ai_request_answer"),
        Index(
            "idx_health_ai_request_user_status_lease",
            "requested_by_user_id",
            "status",
            "lease_expires_at",
        ),
        Index(
            "idx_health_ai_request_user_admitted",
            "requested_by_user_id",
            "admitted_at",
        ),
    )
