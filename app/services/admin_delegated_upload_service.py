"""Default-off, explicit administrator capability for preserving member originals."""

from dataclasses import dataclass

from sqlalchemy.orm import Session

from app.core.constants import is_admin_role
from app.crud.system_setting import system_setting
from app.models.activity_log import ActivityLog
from app.models.health_imports import HealthSourceDocument, HealthSourceUploadBatch
from app.models.patient import Patient
from app.models.user import User
from app.services.owner_access_service import (
    OwnerAccessError,
    ensure_sole_active_administrator,
)

ADMIN_DELEGATED_UPLOAD_CAPABILITY = "delegated_upload"
ADMIN_DELEGATED_UPLOAD_SETTING_KEY = "admin_delegated_upload_enabled"


@dataclass(frozen=True)
class AdminDelegatedUploadError(Exception):
    code: str
    message: str
    status_code: int = 403

    def __str__(self) -> str:
        return self.message


@dataclass(frozen=True)
class AdminDelegatedUploadContext:
    actor_user_id: int
    target_patient_id: int
    reason: str
    operation: str
    capability: str = ADMIN_DELEGATED_UPLOAD_CAPABILITY

    def audit_metadata(self, *, result: str) -> dict:
        return {
            "actor_user_id": self.actor_user_id,
            "target_patient_id": self.target_patient_id,
            "capability": self.capability,
            "reason": self.reason,
            "operation": self.operation,
            "result": result,
        }


def _normalize_reason(reason: str | None) -> str:
    normalized = (reason or "").strip()
    if (
        len(normalized) < 3
        or len(normalized) > 200
        or "\n" in normalized
        or "\r" in normalized
    ):
        raise AdminDelegatedUploadError(
            "invalid_delegated_upload_reason",
            "Delegated-upload reason must contain 3 to 200 single-line characters",
            422,
        )
    return normalized


def _ensure_sole_administrator(db: Session, actor: User) -> None:
    try:
        ensure_sole_active_administrator(db, actor)
    except OwnerAccessError as error:
        raise AdminDelegatedUploadError(
            error.code,
            error.message,
            error.status_code,
        ) from error


def is_admin_delegated_upload_enabled(db: Session) -> bool:
    """Read the persisted flag directly so disable takes effect immediately."""

    return (
        system_setting.get_setting(db, ADMIN_DELEGATED_UPLOAD_SETTING_KEY) or "false"
    ).strip().lower() == "true"


def get_admin_delegated_upload_status(db: Session, actor: User) -> bool:
    _ensure_sole_administrator(db, actor)
    return is_admin_delegated_upload_enabled(db)


def set_admin_delegated_upload_enabled(
    db: Session,
    *,
    actor: User,
    enabled: bool,
    reason: str,
    ip_address: str | None = None,
    user_agent: str | None = None,
) -> bool:
    """Persist and audit one explicit owner toggle in the same transaction."""

    _ensure_sole_administrator(db, actor)
    normalized_reason = _normalize_reason(reason)
    previous = is_admin_delegated_upload_enabled(db)
    system_setting.set_setting(
        db,
        ADMIN_DELEGATED_UPLOAD_SETTING_KEY,
        "true" if enabled else "false",
        commit=False,
    )
    db.add(
        ActivityLog.create_activity(
            action="updated",
            entity_type="admin_delegated_upload",
            description="Updated administrator delegated-upload capability",
            user_id=actor.id,
            metadata={
                "actor_user_id": actor.id,
                "capability": ADMIN_DELEGATED_UPLOAD_CAPABILITY,
                "previous_enabled": previous,
                "enabled": enabled,
                "reason": normalized_reason,
                "result": "completed",
            },
            ip_address=ip_address,
            user_agent=user_agent,
        )
    )
    try:
        db.commit()
    except Exception:
        db.rollback()
        raise
    return enabled


def authorize_admin_delegated_upload(
    db: Session,
    *,
    actor: User,
    patient_id: int,
    requested_capability: str | None,
    reason: str | None,
    operation: str,
    ip_address: str | None = None,
    user_agent: str | None = None,
) -> tuple[Patient, AdminDelegatedUploadContext]:
    """Authorize and record one explicit cross-subject capability attempt."""

    if requested_capability != ADMIN_DELEGATED_UPLOAD_CAPABILITY:
        raise AdminDelegatedUploadError(
            "explicit_delegated_upload_required",
            "Explicit administrator delegated-upload capability is required",
        )
    if not is_admin_role(actor.role):
        raise AdminDelegatedUploadError(
            "administrator_required",
            "Administrator delegated-upload capability is required",
        )
    _ensure_sole_administrator(db, actor)
    if not is_admin_delegated_upload_enabled(db):
        raise AdminDelegatedUploadError(
            "delegated_upload_disabled",
            "Administrator delegated upload is disabled",
        )
    normalized_reason = _normalize_reason(reason)
    patient = db.query(Patient).filter(Patient.id == patient_id).first()
    if patient is None:
        raise AdminDelegatedUploadError(
            "delegated_upload_subject_not_found",
            "Target subject was not found",
            404,
        )
    context = AdminDelegatedUploadContext(
        actor_user_id=actor.id,
        target_patient_id=patient.id,
        reason=normalized_reason,
        operation=operation,
    )
    db.add(
        ActivityLog.create_activity(
            action="authorized",
            entity_type="admin_delegated_upload",
            description="Authorized an explicit administrator delegated-upload action",
            user_id=actor.id,
            patient_id=patient.id,
            entity_id=patient.id,
            metadata=context.audit_metadata(result="authorized"),
            ip_address=ip_address,
            user_agent=user_agent,
        )
    )
    try:
        db.commit()
    except Exception as exc:
        db.rollback()
        raise AdminDelegatedUploadError(
            "delegated_upload_audit_failed",
            "Delegated upload was denied because its audit record could not be saved",
            503,
        ) from exc
    return patient, context


def assert_delegated_batch_scope(
    batch: HealthSourceUploadBatch,
    context: AdminDelegatedUploadContext | None,
) -> None:
    if context is not None and batch.created_by_user_id != context.actor_user_id:
        raise AdminDelegatedUploadError(
            "delegated_upload_batch_not_found",
            "Delegated upload batch was not found",
            404,
        )


def assert_delegated_source_scope(
    source: HealthSourceDocument,
    context: AdminDelegatedUploadContext | None,
) -> None:
    if context is not None and source.created_by_user_id != context.actor_user_id:
        raise AdminDelegatedUploadError(
            "delegated_upload_source_not_found",
            "Delegated source document was not found",
            404,
        )
