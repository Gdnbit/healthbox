"""Viewer-specific dashboard preferences for one authorized health subject."""

from sqlalchemy import (
    JSON,
    Column,
    DateTime,
    ForeignKey,
    Index,
    Integer,
    UniqueConstraint,
)

from .base import Base, get_utc_now


class DashboardPreference(Base):
    """Persist display choices without copying health observations."""

    __tablename__ = "dashboard_preferences"

    id = Column(Integer, primary_key=True)
    user_id = Column(
        Integer,
        ForeignKey("users.id", ondelete="CASCADE"),
        nullable=False,
    )
    patient_id = Column(
        Integer,
        ForeignKey("patients.id", ondelete="CASCADE"),
        nullable=False,
    )
    pinned_metric_ids = Column(JSON, nullable=False, default=list)
    ranges_by_metric_id = Column(JSON, nullable=False, default=dict)
    created_at = Column(DateTime, nullable=False, default=get_utc_now)
    updated_at = Column(
        DateTime,
        nullable=False,
        default=get_utc_now,
        onupdate=get_utc_now,
    )

    __table_args__ = (
        UniqueConstraint(
            "user_id",
            "patient_id",
            name="uq_dashboard_preference_viewer_subject",
        ),
        Index(
            "idx_dashboard_preference_patient",
            "patient_id",
            "user_id",
        ),
    )
