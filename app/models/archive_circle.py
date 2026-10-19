"""Internal reciprocal archive-sharing groups.

Circle and membership rows are intentionally administrator-only metadata.
Ordinary member APIs derive a subject list from these rows without returning
circle identifiers, names, membership identifiers, or account identifiers.
"""

from sqlalchemy import (
    CheckConstraint,
    Column,
    DateTime,
    ForeignKey,
    Index,
    Integer,
    String,
    Text,
    UniqueConstraint,
)
from sqlalchemy.orm import relationship as orm_relationship

from .base import Base, get_utc_now

ARCHIVE_CIRCLE_STATUSES = ("active", "paused", "archived")
ARCHIVE_CIRCLE_MEMBERSHIP_STATUSES = ("active", "paused", "removed")
ARCHIVE_CIRCLE_SCOPE = "structured_dashboard"


class ArchiveCircle(Base):
    """Administrator-managed internal group that grants reciprocal visibility."""

    __tablename__ = "archive_circles"

    id = Column(Integer, primary_key=True)
    name = Column(String(80), nullable=False, unique=True)
    description = Column(Text, nullable=True)
    status = Column(String(20), nullable=False, default="active")
    created_by_user_id = Column(Integer, ForeignKey("users.id"), nullable=False)
    created_at = Column(DateTime, nullable=False, default=get_utc_now)
    updated_at = Column(
        DateTime,
        nullable=False,
        default=get_utc_now,
        onupdate=get_utc_now,
    )

    creator = orm_relationship("User", foreign_keys=[created_by_user_id])
    memberships = orm_relationship(
        "ArchiveCircleMembership",
        back_populates="circle",
        cascade="all, delete-orphan",
    )

    __table_args__ = (
        CheckConstraint(
            "status IN ('active', 'paused', 'archived')",
            name="ck_archive_circle_status",
        ),
        Index("idx_archive_circle_status", "status", "updated_at"),
    )


class ArchiveCircleMembership(Base):
    """One health subject's direct membership in one archive circle."""

    __tablename__ = "archive_circle_memberships"

    id = Column(Integer, primary_key=True)
    circle_id = Column(
        Integer,
        ForeignKey("archive_circles.id", ondelete="CASCADE"),
        nullable=False,
    )
    patient_id = Column(
        Integer,
        ForeignKey("patients.id", ondelete="CASCADE"),
        nullable=False,
    )
    scope = Column(
        String(40),
        nullable=False,
        default=ARCHIVE_CIRCLE_SCOPE,
    )
    status = Column(String(20), nullable=False, default="active")
    expires_at = Column(DateTime, nullable=True)
    joined_at = Column(DateTime, nullable=False, default=get_utc_now)
    paused_at = Column(DateTime, nullable=True)
    removed_at = Column(DateTime, nullable=True)
    updated_by_user_id = Column(Integer, ForeignKey("users.id"), nullable=False)
    created_at = Column(DateTime, nullable=False, default=get_utc_now)
    updated_at = Column(
        DateTime,
        nullable=False,
        default=get_utc_now,
        onupdate=get_utc_now,
    )

    circle = orm_relationship("ArchiveCircle", back_populates="memberships")
    patient = orm_relationship("Patient", foreign_keys=[patient_id])
    updated_by = orm_relationship("User", foreign_keys=[updated_by_user_id])

    __table_args__ = (
        UniqueConstraint(
            "circle_id",
            "patient_id",
            name="uq_archive_circle_membership_patient",
        ),
        CheckConstraint(
            "scope = 'structured_dashboard'",
            name="ck_archive_circle_membership_scope",
        ),
        CheckConstraint(
            "status IN ('active', 'paused', 'removed')",
            name="ck_archive_circle_membership_status",
        ),
        Index(
            "idx_archive_circle_membership_circle",
            "circle_id",
            "status",
        ),
        Index(
            "idx_archive_circle_membership_patient",
            "patient_id",
            "status",
        ),
    )
