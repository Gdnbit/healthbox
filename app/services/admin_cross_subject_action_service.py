"""Explicit, operation-scoped writes by the sole administrator."""

from dataclasses import dataclass

from sqlalchemy.orm import Session

from app.core.constants import is_admin_role
from app.models.activity_log import ActivityLog
from app.models.patient import Patient
from app.models.user import User
from app.services.owner_access_service import (
    OwnerAccessError,
    ensure_sole_active_administrator,
)

OWNER_CROSS_SUBJECT_ACCESS_BASIS = "owner_cross_subject_action"
OWNER_RECORD_REVISE_CAPABILITY = "owner_record_revise"
OWNER_RECORD_VOID_CAPABILITY = "owner_record_void"
OWNER_SOURCE_WITHDRAW_CAPABILITY = "owner_source_withdraw"
OWNER_SOURCE_RESTORE_CAPABILITY = "owner_source_restore"


@dataclass(frozen=True)
class AdminCrossSubjectActionError(Exception):
    code: str
    message: str
    status_code: int = 403

    def __str__(self) -> str:
        return self.message


@dataclass(frozen=True)
class AdminCrossSubjectActionContext:
    actor_user_id: int
    target_patient_id: int
    capability: str
    reason: str
    operation: str
    object_type: str
    object_id: int
    access_basis: str = OWNER_CROSS_SUBJECT_ACCESS_BASIS

    def audit_metadata(self, *, result: str, **state: object) -> dict:
        return {
            "actor_user_id": self.actor_user_id,
            "target_patient_id": self.target_patient_id,
            "access_basis": self.access_basis,
            "capability": self.capability,
            "reason": self.reason,
            "operation": self.operation,
            "object_type": self.object_type,
            "object_id": self.object_id,
            "result": result,
            **state,
        }


def _normalize_reason(reason: str | None) -> str:
    normalized = (reason or "").strip()
    if (
        len(normalized) < 3
        or len(normalized) > 200
        or "\n" in normalized
        or "\r" in normalized
    ):
        raise AdminCrossSubjectActionError(
            "invalid_admin_action_reason",
            "Administrator action reason must contain 3 to 200 single-line characters",
            422,
        )
    return normalized


def _ensure_sole_administrator(db: Session, actor: User) -> None:
    try:
        ensure_sole_active_administrator(db, actor)
    except OwnerAccessError as error:
        raise AdminCrossSubjectActionError(
            error.code,
            error.message,
            error.status_code,
        ) from error


def authorize_admin_cross_subject_action(
    db: Session,
    *,
    actor: User,
    patient_id: int,
    requested_capability: str | None,
    reason: str | None,
    required_capability: str,
    operation: str,
    object_type: str,
    object_id: int,
    ip_address: str | None = None,
    user_agent: str | None = None,
) -> AdminCrossSubjectActionContext:
    """Authorize and record one explicit operation without impersonation."""

    if requested_capability != required_capability:
        raise AdminCrossSubjectActionError(
            f"explicit_{required_capability}_required",
            f"Explicit administrator capability {required_capability} is required",
        )
    if not is_admin_role(actor.role):
        raise AdminCrossSubjectActionError(
            "administrator_required",
            "Sole-administrator capability is required",
        )
    _ensure_sole_administrator(db, actor)
    normalized_reason = _normalize_reason(reason)
    patient = db.query(Patient).filter(Patient.id == patient_id).first()
    if patient is None:
        raise AdminCrossSubjectActionError(
            "admin_action_subject_not_found",
            "Target subject was not found",
            404,
        )
    if patient.owner_user_id == actor.id:
        raise AdminCrossSubjectActionError(
            "admin_action_requires_other_subject",
            "Use the ordinary self-service flow for the administrator's own archive",
            409,
        )

    context = AdminCrossSubjectActionContext(
        actor_user_id=actor.id,
        target_patient_id=patient.id,
        capability=required_capability,
        reason=normalized_reason,
        operation=operation,
        object_type=object_type,
        object_id=object_id,
    )
    db.add(
        ActivityLog.create_activity(
            action="authorized",
            entity_type="owner_cross_subject_action",
            description="Authorized an explicit sole-administrator cross-subject action",
            user_id=actor.id,
            patient_id=patient.id,
            entity_id=object_id,
            metadata=context.audit_metadata(result="authorized"),
            ip_address=ip_address,
            user_agent=user_agent,
        )
    )
    try:
        db.commit()
    except Exception as exc:
        db.rollback()
        raise AdminCrossSubjectActionError(
            "admin_action_audit_failed",
            "Administrator action was denied because its audit record could not be saved",
            503,
        ) from exc
    return context
