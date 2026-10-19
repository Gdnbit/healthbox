from sqlalchemy import (
    Boolean,
    Column,
    DateTime,
    Float,
    ForeignKey,
    Index,
    Integer,
    String,
    Text,
    UniqueConstraint,
)

from .base import Base, get_utc_now


class HealthAlertRule(Base):
    """Versioned deterministic alert rule owned by one household member."""

    __tablename__ = "health_alert_rules"

    id = Column(Integer, primary_key=True)
    patient_id = Column(Integer, ForeignKey("patients.id"), nullable=False)
    created_by_user_id = Column(Integer, ForeignKey("users.id"), nullable=False)
    name = Column(String(255), nullable=False)
    rule_type = Column(String(30), nullable=False)
    test_name = Column(String(255), nullable=False)
    unit = Column(String(100), nullable=True)
    operator = Column(String(10), nullable=True)
    threshold_value = Column(Float, nullable=True)
    overdue_days = Column(Integer, nullable=True)
    enabled = Column(Boolean, nullable=False, default=True)
    version = Column(Integer, nullable=False, default=1)
    created_at = Column(DateTime, nullable=False, default=get_utc_now)
    updated_at = Column(
        DateTime, nullable=False, default=get_utc_now, onupdate=get_utc_now
    )

    __table_args__ = (
        Index("idx_health_alert_rule_patient", "patient_id"),
        Index("idx_health_alert_rule_enabled", "patient_id", "enabled"),
    )


class HealthAlertMute(Base):
    """Per-user mute state for a concrete evaluated alert."""

    __tablename__ = "health_alert_mutes"

    id = Column(Integer, primary_key=True)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=False)
    patient_id = Column(Integer, ForeignKey("patients.id"), nullable=False)
    alert_id = Column(String(64), nullable=False)
    muted_until = Column(DateTime, nullable=False)
    reason = Column(Text, nullable=True)
    created_at = Column(DateTime, nullable=False, default=get_utc_now)
    updated_at = Column(
        DateTime, nullable=False, default=get_utc_now, onupdate=get_utc_now
    )

    __table_args__ = (
        UniqueConstraint(
            "user_id", "patient_id", "alert_id", name="uq_health_alert_mute"
        ),
        Index("idx_health_alert_mute_lookup", "user_id", "patient_id", "alert_id"),
        Index("idx_health_alert_mute_expiry", "muted_until"),
    )
