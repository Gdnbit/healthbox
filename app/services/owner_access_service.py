"""Explicit, audited read-only access for the sole instance administrator."""

from dataclasses import dataclass

from sqlalchemy import func
from sqlalchemy.orm import Session

from app.core.constants import ADMIN_ROLES
from app.models.activity_log import ActionType, ActivityLog, EntityType
from app.models.patient import Patient
from app.models.user import User

OWNER_GLOBAL_READ_REQUEST = "global_read"
OWNER_GLOBAL_READ_BASIS = "owner_global_read"
OWNER_DASHBOARD_HANDOFF_KINDS = {"clipboard", "csv", "print"}
OWNER_DASHBOARD_HANDOFF_SCOPES = {
    "all-loaded",
    "latest-report",
    "recent-five-years",
}
OWNER_GLOBAL_READ_RESOURCES = {
    "dashboard_export",
    "health_background",
    "health_coverage",
    "lab_component_catalog",
    "lab_component_trend",
    "source_document_download",
    "source_document_metadata",
    "source_document_preview",
    "vitals",
}


@dataclass(frozen=True)
class OwnerAccessError(Exception):
    """Stable fail-closed error without health data."""

    code: str
    message: str
    status_code: int = 403

    def __str__(self) -> str:
        return self.message


def _validate_purpose(purpose: str | None) -> str:
    normalized = (purpose or "").strip()
    if (
        len(normalized) < 3
        or len(normalized) > 200
        or "\n" in normalized
        or "\r" in normalized
    ):
        raise OwnerAccessError(
            "invalid_owner_access_purpose",
            "Administrator access purpose must contain 3 to 200 single-line characters",
            422,
        )
    return normalized


def _ensure_sole_active_administrator(db: Session, actor: User) -> None:
    administrators = (
        db.query(User.id)
        .filter(
            func.lower(User.role).in_(ADMIN_ROLES),
            User.is_active.is_(True),
        )
        .all()
    )
    administrator_ids = [row[0] for row in administrators]
    if administrator_ids != [actor.id]:
        raise OwnerAccessError(
            "sole_active_administrator_required",
            "Owner capability is unavailable because the sole-administrator invariant is not satisfied",
            409,
        )


def ensure_sole_active_administrator(db: Session, actor: User) -> None:
    """Public invariant guard shared by explicit owner-only capabilities."""

    _ensure_sole_active_administrator(db, actor)


def list_owner_global_subjects(db: Session, actor: User) -> list[dict]:
    """Return the minimum subject directory needed by the read-only owner page."""

    _ensure_sole_active_administrator(db, actor)
    patients = db.query(Patient).order_by(Patient.id).all()
    return [
        {
            "id": patient.id,
            "first_name": patient.first_name,
            "last_name": patient.last_name,
            "owner_user_id": patient.owner_user_id,
            "access_basis": (
                "owner"
                if patient.owner_user_id == actor.id
                else OWNER_GLOBAL_READ_BASIS
            ),
            "permission_level": (
                "full" if patient.owner_user_id == actor.id else OWNER_GLOBAL_READ_BASIS
            ),
        }
        for patient in patients
    ]


def authorize_owner_global_read(
    db: Session,
    *,
    actor: User,
    patient: Patient,
    requested_capability: str | None,
    purpose: str | None,
    resource: str,
    request_method: str,
    request_path: str,
    ip_address: str | None = None,
    user_agent: str | None = None,
    source_document_id: int | None = None,
    handoff_kind: str | None = None,
    handoff_scope: str | None = None,
    include_reports: bool | None = None,
    metric_count: int | None = None,
    report_count: int | None = None,
) -> str:
    """Authorize and atomically audit one cross-subject read."""

    if requested_capability != OWNER_GLOBAL_READ_REQUEST:
        raise OwnerAccessError(
            "explicit_owner_global_read_required",
            "Explicit administrator global-read capability is required",
        )
    method = request_method.upper()
    if method not in {"GET", "HEAD"}:
        raise OwnerAccessError(
            "owner_global_read_is_read_only",
            "Administrator global-read capability cannot authorize a write",
        )
    if resource not in OWNER_GLOBAL_READ_RESOURCES:
        raise OwnerAccessError(
            "owner_global_read_resource_not_enabled",
            "This resource has not enabled administrator global read",
        )
    normalized_purpose = _validate_purpose(purpose)
    _ensure_sole_active_administrator(db, actor)

    is_dashboard_handoff = resource == "dashboard_export"
    if is_dashboard_handoff:
        if (
            handoff_kind not in OWNER_DASHBOARD_HANDOFF_KINDS
            or handoff_scope not in OWNER_DASHBOARD_HANDOFF_SCOPES
            or include_reports is None
            or metric_count is None
            or not 0 <= metric_count <= 200
            or report_count is None
            or not 0 <= report_count <= 1000
            or source_document_id is not None
        ):
            raise OwnerAccessError(
                "invalid_owner_dashboard_handoff",
                "Administrator dashboard handoff context is invalid",
                422,
            )
    elif any(
        value is not None
        for value in (
            handoff_kind,
            handoff_scope,
            include_reports,
            metric_count,
            report_count,
        )
    ):
        raise OwnerAccessError(
            "invalid_owner_access_audit_target",
            "Dashboard handoff context is only valid for dashboard export",
            500,
        )

    if patient.owner_user_id == actor.id:
        return "owner"

    audit_action = ActionType.VIEWED
    audit_entity_type = EntityType.PATIENT
    audit_entity_id = patient.id
    description = "Sole administrator used disclosed global read access"
    if source_document_id is not None:
        if resource not in {
            "source_document_download",
            "source_document_preview",
        }:
            raise OwnerAccessError(
                "invalid_owner_access_audit_target",
                "Source-document audit context is only valid for source access",
                500,
            )
        audit_entity_type = EntityType.HEALTH_SOURCE_DOCUMENT
        audit_entity_id = source_document_id
        if resource == "source_document_download":
            audit_action = ActionType.DOWNLOADED
            description = "Sole administrator downloaded a disclosed source document"
        else:
            audit_action = ActionType.VIEWED
            description = "Sole administrator previewed a disclosed source document"
    elif is_dashboard_handoff:
        audit_action = ActionType.EXPORTED
        description = "Sole administrator prepared a disclosed dashboard handoff"

    metadata = {
        "actor_user_id": actor.id,
        "target_patient_id": patient.id,
        "access_basis": OWNER_GLOBAL_READ_BASIS,
        "resource": resource,
        "purpose": normalized_purpose,
        "request_method": method,
        "request_path": request_path,
        "result": "allowed",
    }
    if source_document_id is not None:
        metadata["source_document_id"] = source_document_id
    elif is_dashboard_handoff:
        metadata.update(
            {
                "handoff_kind": handoff_kind,
                "handoff_scope": handoff_scope,
                "include_reports": include_reports,
                "metric_count": metric_count,
                "report_count": report_count,
            }
        )

    audit = ActivityLog.create_activity(
        action=audit_action,
        entity_type=audit_entity_type,
        description=description,
        user_id=actor.id,
        patient_id=patient.id,
        entity_id=audit_entity_id,
        metadata=metadata,
        ip_address=ip_address,
        user_agent=user_agent,
    )
    try:
        db.add(audit)
        db.commit()
    except Exception as exc:
        db.rollback()
        raise OwnerAccessError(
            "owner_access_audit_failed",
            "Administrator global read was denied because its audit record could not be saved",
            503,
        ) from exc
    return OWNER_GLOBAL_READ_BASIS
