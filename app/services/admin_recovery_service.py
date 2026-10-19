"""Transactional server-local recovery for the sole household administrator.

This module deliberately has no HTTP route.  It is called only by the
versioned server-local CLI.  Result and audit payloads describe state changes
without containing passwords, password hashes, MFA secrets, recovery codes,
tokens, database URLs, or health values.
"""

from __future__ import annotations

from typing import Any

from sqlalchemy import func
from sqlalchemy.orm import Session

from app.core.config import settings
from app.core.constants import ADMIN_ROLES, is_admin_role
from app.core.utils.security import get_password_hash, verify_password
from app.models.activity_log import ActionType, ActivityLog, EntityType
from app.models.base import get_utc_now
from app.models.user import (
    User,
    UserMfaChallenge,
    UserMfaCredential,
    UserMfaRecoveryCode,
)

COMMAND_VERSION = "1.0.0"
COMMAND_NAME = "household-admin-recovery"
MIN_RECOVERY_PASSWORD_CHARACTERS = 12
MAX_BCRYPT_PASSWORD_BYTES = 72


class RecoveryContractError(Exception):
    """A sanitized, stable recovery failure suitable for structured CLI output."""

    def __init__(self, code: str, message: str):
        super().__init__(message)
        self.code = code
        self.public_message = message


def _validate_text(value: str, *, field: str, maximum: int) -> str:
    normalized = (value or "").strip()
    if (
        not normalized
        or len(normalized) > maximum
        or any(ord(character) < 32 for character in normalized)
    ):
        raise RecoveryContractError(
            f"invalid_{field}",
            f"{field} is missing or invalid",
        )
    return normalized


def _validate_recovery_password(password: str, username: str) -> None:
    try:
        encoded = password.encode("utf-8")
    except UnicodeError as exc:
        raise RecoveryContractError(
            "password_policy_failed",
            "Recovery password does not satisfy the local password policy",
        ) from exc

    normalized = password.casefold()
    if (
        len(password) < MIN_RECOVERY_PASSWORD_CHARACTERS
        or len(encoded) > MAX_BCRYPT_PASSWORD_BYTES
        or not any(character.isalpha() for character in password)
        or not any(character.isdigit() for character in password)
        or normalized == username.casefold()
        or normalized.startswith(("admin", "password"))
        or normalized in {"123456789012", "qwerty123456"}
        or any(ord(character) < 32 for character in password)
    ):
        raise RecoveryContractError(
            "password_policy_failed",
            "Recovery password does not satisfy the local password policy",
        )


def _query_target(db: Session, username: str, *, lock: bool = True) -> User:
    query = db.query(User).filter(func.lower(User.username) == username.casefold())
    if lock:
        query = query.with_for_update()
    target = query.one_or_none()
    if target is None:
        raise RecoveryContractError("target_not_found", "Target account was not found")
    return target


def _administrator_rows(db: Session, *, lock: bool = True) -> list[User]:
    query = (
        db.query(User)
        .filter(func.lower(User.role).in_(ADMIN_ROLES))
        .order_by(User.id.asc())
    )
    if lock:
        query = query.with_for_update()
    return query.all()


def _authentication_state(db: Session, target: User) -> dict[str, Any]:
    enabled_credential_count = (
        db.query(UserMfaCredential)
        .filter(
            UserMfaCredential.user_id == target.id,
            UserMfaCredential.is_enabled.is_(True),
        )
        .count()
    )
    unused_recovery_code_count = (
        db.query(UserMfaRecoveryCode)
        .filter(
            UserMfaRecoveryCode.user_id == target.id,
            UserMfaRecoveryCode.used_at.is_(None),
        )
        .count()
    )
    active_challenge_count = (
        db.query(UserMfaChallenge)
        .filter(
            UserMfaChallenge.user_id == target.id,
            UserMfaChallenge.consumed_at.is_(None),
        )
        .count()
    )
    return {
        "role": target.role,
        "is_active": bool(target.is_active),
        "must_change_password": bool(target.must_change_password),
        "auth_version": int(target.auth_version),
        "mfa_enabled": enabled_credential_count == 1,
        "unused_recovery_code_count": unused_recovery_code_count,
        "active_challenge_count": active_challenge_count,
    }


def _target_summary(target: User) -> dict[str, Any]:
    return {
        "user_id": target.id,
        "username": target.username,
    }


def _check(
    check_id: str,
    passed: bool,
    details: dict[str, Any] | None = None,
) -> dict[str, Any]:
    return {
        "id": check_id,
        "status": "passed" if passed else "failed",
        "details": details or {},
    }


def inspect_administrator_recovery(
    db: Session,
    *,
    username: str,
) -> dict[str, Any]:
    """Return a read-only, secret-free recovery readiness snapshot."""

    normalized_username = _validate_text(
        username,
        field="username",
        maximum=255,
    ).casefold()
    administrators = _administrator_rows(db, lock=False)
    target = _query_target(db, normalized_username, lock=False)
    target_is_admin = is_admin_role(target.role)
    configured_owner = settings.ADMIN_DEFAULT_USERNAME.strip().casefold()
    can_restore_role = (
        len(administrators) == 0
        and not target_is_admin
        and target.username.casefold() == configured_owner
    )
    ready = (
        len(administrators) == 1
        and administrators[0].id == target.id
        and target_is_admin
    ) or can_restore_role
    state = _authentication_state(db, target)
    checks = [
        _check(
            "administrator_count_supported",
            len(administrators) <= 1,
            {"administrator_count": len(administrators)},
        ),
        _check(
            "target_is_sole_administrator_or_configured_owner",
            ready,
            {
                "target_is_administrator": target_is_admin,
                "role_restore_required": can_restore_role,
            },
        ),
    ]
    return {
        "command_version": COMMAND_VERSION,
        "target": _target_summary(target),
        "action": "inspect_admin_recovery",
        "sessions_revoked": False,
        "second_factor": {
            "enabled": state["mfa_enabled"],
            "unused_recovery_code_count": state["unused_recovery_code_count"],
            "active_challenge_count": state["active_challenge_count"],
            "action": "inspection_only",
        },
        "account": {
            "administrator_count": len(administrators),
            "is_administrator": target_is_admin,
            "is_active": state["is_active"],
            "must_change_password": state["must_change_password"],
            "role_restore_required": can_restore_role,
        },
        "integrity_checks": checks,
        "maintenance_record_id": None,
        "result": "ready" if ready else "blocked",
    }


def _post_change_integrity_checks(
    db: Session,
    target: User,
    *,
    previous_auth_version: int,
    new_password: str,
) -> list[dict[str, Any]]:
    administrator_count = (
        db.query(User).filter(func.lower(User.role).in_(ADMIN_ROLES)).count()
    )
    active_administrator_count = (
        db.query(User)
        .filter(
            func.lower(User.role).in_(ADMIN_ROLES),
            User.is_active.is_(True),
        )
        .count()
    )
    credential_count = (
        db.query(UserMfaCredential)
        .filter(UserMfaCredential.user_id == target.id)
        .count()
    )
    recovery_code_count = (
        db.query(UserMfaRecoveryCode)
        .filter(UserMfaRecoveryCode.user_id == target.id)
        .count()
    )
    active_challenge_count = (
        db.query(UserMfaChallenge)
        .filter(
            UserMfaChallenge.user_id == target.id,
            UserMfaChallenge.consumed_at.is_(None),
        )
        .count()
    )
    return [
        _check(
            "single_administrator",
            administrator_count == 1,
            {"administrator_count": administrator_count},
        ),
        _check(
            "single_active_administrator",
            active_administrator_count == 1,
            {"active_administrator_count": active_administrator_count},
        ),
        _check("target_is_administrator", is_admin_role(target.role)),
        _check("target_is_active", bool(target.is_active)),
        _check(
            "session_version_advanced",
            target.auth_version == previous_auth_version + 1,
        ),
        _check(
            "recovery_credential_hash_valid",
            verify_password(new_password, target.password_hash),
        ),
        _check("forced_password_change_enabled", bool(target.must_change_password)),
        _check("totp_credential_removed", credential_count == 0),
        _check("recovery_codes_removed", recovery_code_count == 0),
        _check("active_challenges_consumed", active_challenge_count == 0),
    ]


def recover_administrator_access(
    db: Session,
    *,
    username: str,
    confirmed_user_id: int,
    new_password: str,
    operator: str,
    reason: str,
    restore_admin_role: bool = False,
    expected_owner_username: str | None = None,
) -> dict[str, Any]:
    """Atomically recover the sole administrator's local authentication state."""

    normalized_username = _validate_text(
        username,
        field="username",
        maximum=255,
    ).casefold()
    normalized_operator = _validate_text(
        operator,
        field="operator",
        maximum=100,
    )
    normalized_reason = _validate_text(
        reason,
        field="reason",
        maximum=500,
    )
    _validate_recovery_password(new_password, normalized_username)
    if new_password in normalized_operator or new_password in normalized_reason:
        raise RecoveryContractError(
            "maintenance_text_contains_credential",
            "Operator and reason fields must not contain the recovery password",
        )

    try:
        administrators = _administrator_rows(db)
        target = _query_target(db, normalized_username)
        if target.id != confirmed_user_id:
            raise RecoveryContractError(
                "target_confirmation_mismatch",
                "Confirmed user ID does not match the target account",
            )
        if len(administrators) > 1:
            raise RecoveryContractError(
                "administrator_integrity_violation",
                "Recovery is blocked because more than one administrator exists",
            )

        before = _authentication_state(db, target)
        target_is_admin = is_admin_role(target.role)
        admin_role_restored = False
        if len(administrators) == 1:
            if administrators[0].id != target.id or not target_is_admin:
                raise RecoveryContractError(
                    "target_is_not_sole_administrator",
                    "Target account is not the sole administrator",
                )
        elif target_is_admin:
            raise RecoveryContractError(
                "administrator_integrity_violation",
                "Administrator state is internally inconsistent",
            )
        else:
            if not restore_admin_role:
                raise RecoveryContractError(
                    "explicit_role_restore_required",
                    "Target role restoration requires an explicit recovery flag",
                )
            configured_owner = settings.ADMIN_DEFAULT_USERNAME.strip().casefold()
            expected_owner = (expected_owner_username or "").strip().casefold()
            if (
                target.username.casefold() != configured_owner
                or expected_owner != target.username.casefold()
            ):
                raise RecoveryContractError(
                    "owner_identity_mismatch",
                    "Role restoration is limited to the configured owner account",
                )
            target.role = "admin"
            admin_role_restored = True

        previous_auth_version = int(target.auth_version)
        credential_rows_removed = (
            db.query(UserMfaCredential)
            .filter(UserMfaCredential.user_id == target.id)
            .delete(synchronize_session=False)
        )
        recovery_rows_removed = (
            db.query(UserMfaRecoveryCode)
            .filter(UserMfaRecoveryCode.user_id == target.id)
            .delete(synchronize_session=False)
        )
        active_challenges_consumed = (
            db.query(UserMfaChallenge)
            .filter(
                UserMfaChallenge.user_id == target.id,
                UserMfaChallenge.consumed_at.is_(None),
            )
            .update(
                {UserMfaChallenge.consumed_at: get_utc_now()},
                synchronize_session=False,
            )
        )

        target.password_hash = get_password_hash(new_password)
        target.must_change_password = True
        target.is_active = True
        target.auth_version = previous_auth_version + 1
        target.password_reset_expires_at = None
        target.password_reset_consumed_at = None
        target.updated_at = get_utc_now()
        db.flush()

        checks = _post_change_integrity_checks(
            db,
            target,
            previous_auth_version=previous_auth_version,
            new_password=new_password,
        )
        if any(check["status"] != "passed" for check in checks):
            raise RecoveryContractError(
                "post_change_integrity_failed",
                "Post-change integrity checks failed; all changes were rolled back",
            )

        after = _authentication_state(db, target)
        maintenance = ActivityLog.create_activity(
            action=ActionType.MAINTENANCE_COMPLETED,
            entity_type=EntityType.USER,
            entity_id=target.id,
            description=(
                "Server-local household administrator authentication recovery completed"
            ),
            metadata={
                "source": COMMAND_NAME,
                "command_version": COMMAND_VERSION,
                "operator": normalized_operator,
                "reason": normalized_reason,
                "target_user_id": target.id,
                "target_username": target.username,
                "action": "recover_admin_access",
                "before": before,
                "after": after,
                "sessions_revoked": True,
                "admin_role_restored": admin_role_restored,
                "credential_rows_removed": credential_rows_removed,
                "recovery_rows_removed": recovery_rows_removed,
                "active_challenges_consumed": active_challenges_consumed,
                "integrity_checks": checks,
            },
            ip_address="server-local-cli",
            user_agent=COMMAND_NAME,
        )
        db.add(maintenance)
        db.flush()
        checks.append(
            _check(
                "maintenance_record_written",
                maintenance.id is not None,
                {"maintenance_record_id": maintenance.id},
            )
        )
        if maintenance.id is None:
            raise RecoveryContractError(
                "maintenance_record_failed",
                "Maintenance record could not be created; all changes were rolled back",
            )

        maintenance.event_metadata = {
            **maintenance.event_metadata,
            "integrity_checks": checks,
        }
        result = {
            "command_version": COMMAND_VERSION,
            "target": _target_summary(target),
            "action": "recover_admin_access",
            "sessions_revoked": True,
            "second_factor": {
                "action": "reset_for_reenrollment",
                "credential_rows_removed": credential_rows_removed,
                "recovery_rows_removed": recovery_rows_removed,
                "active_challenges_consumed": active_challenges_consumed,
            },
            "account": {
                "is_active": True,
                "is_administrator": True,
                "admin_role_restored": admin_role_restored,
                "must_change_password": True,
                "auth_version_advanced": True,
            },
            "integrity_checks": checks,
            "maintenance_record_id": maintenance.id,
            "result": "success",
        }
        db.commit()
        return result
    except RecoveryContractError:
        db.rollback()
        raise
    except Exception as exc:
        db.rollback()
        raise RecoveryContractError(
            "recovery_operation_failed",
            "Recovery failed and all changes were rolled back",
        ) from exc
