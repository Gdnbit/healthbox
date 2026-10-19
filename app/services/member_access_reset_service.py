"""Transactional one-time access reset for an active ordinary member."""

import secrets
from datetime import timedelta

from sqlalchemy import func
from sqlalchemy.orm import Session

from app.core.constants import ADMIN_ROLES, is_admin_role
from app.core.utils.datetime_utils import get_utc_now
from app.core.utils.security import get_password_hash
from app.models.activity_log import ActionType, ActivityLog, EntityType
from app.models.user import User

RESET_VERSION = "1.0.0"
RESET_SOURCE = "admin_member_access_reset"
RESET_TTL_MINUTES = 60
_UPPERCASE = "ABCDEFGHJKLMNPQRSTUVWXYZ"
_LOWERCASE = "abcdefghijkmnopqrstuvwxyz"
_DIGITS = "23456789"
_ALPHABET = _UPPERCASE + _LOWERCASE + _DIGITS


class MemberAccessResetError(Exception):
    """A stable reset-contract failure safe to show through the API."""

    def __init__(self, code: str, message: str, status_code: int = 400):
        super().__init__(message)
        self.code = code
        self.message = message
        self.status_code = status_code


def _generate_temporary_password(length: int = 20) -> str:
    """Generate a strong, copyable password without ambiguous characters."""

    characters = [
        secrets.choice(_UPPERCASE),
        secrets.choice(_LOWERCASE),
        secrets.choice(_DIGITS),
    ]
    characters.extend(secrets.choice(_ALPHABET) for _ in range(length - 3))
    secrets.SystemRandom().shuffle(characters)
    return "".join(characters)


def _validate_reason(reason: str) -> str:
    normalized = reason.strip()
    if (
        len(normalized) < 3
        or len(normalized) > 200
        or "\n" in normalized
        or "\r" in normalized
    ):
        raise MemberAccessResetError(
            "invalid_reset_reason",
            "Reset reason must contain 3 to 200 single-line characters",
            422,
        )
    return normalized


def reset_member_access(
    db: Session,
    *,
    actor: User,
    target_user_id: int,
    confirm_username: str,
    reason: str,
    ip_address: str | None = None,
    user_agent: str | None = None,
) -> dict:
    """Reset an ordinary member with one server-generated temporary password."""

    normalized_reason = _validate_reason(reason)
    try:
        administrator_ids = [
            row[0]
            for row in (
                db.query(User.id)
                .filter(
                    func.lower(User.role).in_(ADMIN_ROLES),
                    User.is_active.is_(True),
                )
                .all()
            )
        ]
        if administrator_ids != [actor.id]:
            raise MemberAccessResetError(
                "sole_active_administrator_required",
                "Member reset is unavailable because the sole-administrator invariant is not satisfied",
                409,
            )

        query = db.query(User).filter(User.id == target_user_id)
        if db.bind is not None and db.bind.dialect.name == "postgresql":
            query = query.with_for_update()
        target = query.first()
        if target is None:
            raise MemberAccessResetError(
                "member_not_found",
                "Member account was not found",
                404,
            )
        if target.username != confirm_username:
            raise MemberAccessResetError(
                "target_confirmation_mismatch",
                "Confirmed username does not match the target member",
                409,
            )
        if is_admin_role(target.role):
            raise MemberAccessResetError(
                "administrator_target_not_allowed",
                "Administrator access must use the administrator recovery path",
            )
        if not target.is_active:
            raise MemberAccessResetError(
                "inactive_member_reset_blocked",
                "Inactive members must be reviewed before access can be restored",
                409,
            )
        if target.auth_method not in {"local", "hybrid"}:
            raise MemberAccessResetError(
                "unsupported_authentication_method",
                "This account does not use a local password",
                409,
            )

        temporary_password = _generate_temporary_password()
        expires_at = get_utc_now() + timedelta(minutes=RESET_TTL_MINUTES)
        target.password_hash = get_password_hash(temporary_password)
        target.must_change_password = True
        target.auth_version = int(target.auth_version or 1) + 1
        target.password_reset_expires_at = expires_at
        target.password_reset_consumed_at = None

        audit = ActivityLog.create_activity(
            action=ActionType.UPDATED,
            entity_type=EntityType.USER,
            description="Sole administrator issued a one-time member access reset",
            user_id=actor.id,
            entity_id=target.id,
            metadata={
                "source": RESET_SOURCE,
                "contract_version": RESET_VERSION,
                "actor_user_id": actor.id,
                "target_user_id": target.id,
                "reason": normalized_reason,
                "expires_at": expires_at.isoformat(),
                "sessions_revoked": True,
                "must_change_password": True,
                "result": "success",
            },
            ip_address=ip_address,
            user_agent=user_agent,
        )
        db.add(target)
        db.add(audit)
        db.commit()

        return {
            "target_user_id": target.id,
            "target_username": target.username,
            "temporary_password": temporary_password,
            "expires_at": expires_at,
            "must_change_password": True,
            "sessions_revoked": True,
            "result": "success",
        }
    except MemberAccessResetError:
        db.rollback()
        raise
    except Exception as exc:
        db.rollback()
        raise MemberAccessResetError(
            "member_reset_failed",
            "Member access reset failed and no change was saved",
            500,
        ) from exc
