"""Single-use invitations that create ordinary household member accounts."""

from sqlalchemy import (  # isort: skip
    CheckConstraint,
    Column,
    DateTime,
    ForeignKey,
    Index,
    Integer,
    String,
    UniqueConstraint,
)
from sqlalchemy.orm import relationship as orm_relationship

from .base import Base, get_utc_now

ACCOUNT_INVITATION_STATUSES = (
    "pending",
    "activated",
    "declined",
    "cancelled",
    "expired",
)


class AccountInvitation(Base):
    """Short-lived capability used once to create an ordinary member account."""

    __tablename__ = "account_invitations"

    id = Column(Integer, primary_key=True)
    public_id = Column(String(36), nullable=False, unique=True)
    token_sha256 = Column(String(64), nullable=False, unique=True)
    created_by_user_id = Column(
        Integer,
        ForeignKey("users.id"),
        nullable=False,
    )
    activated_user_id = Column(
        Integer,
        ForeignKey("users.id"),
        nullable=True,
    )

    recipient_label = Column(String(100), nullable=False)
    status = Column(String(16), default="pending", nullable=False)
    expires_at = Column(DateTime(timezone=True), nullable=False)
    activated_at = Column(DateTime(timezone=True), nullable=True)
    declined_at = Column(DateTime(timezone=True), nullable=True)
    cancelled_at = Column(DateTime(timezone=True), nullable=True)
    activation_notice_version = Column(String(80), nullable=True)
    activation_notice_sha256 = Column(String(64), nullable=True)

    created_at = Column(DateTime(timezone=True), default=get_utc_now, nullable=False)
    updated_at = Column(
        DateTime(timezone=True),
        default=get_utc_now,
        onupdate=get_utc_now,
        nullable=False,
    )

    created_by = orm_relationship(
        "User",
        foreign_keys=[created_by_user_id],
    )
    activated_user = orm_relationship(
        "User",
        foreign_keys=[activated_user_id],
    )

    __table_args__ = (
        CheckConstraint(
            "status IN ('pending', 'activated', 'declined', 'cancelled', 'expired')",
            name="ck_account_invitation_status",
        ),
        UniqueConstraint(
            "activated_user_id",
            name="uq_account_invitation_activated_user",
        ),
        Index(
            "idx_account_invitation_status_expiry",
            "status",
            "expires_at",
        ),
        Index(
            "idx_account_invitation_created",
            "created_at",
        ),
    )
