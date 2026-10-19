"""Read-only capabilities for the disclosed sole-administrator view."""

from typing import Literal, Optional

from fastapi import APIRouter, Depends, HTTPException, Query, Request, Response
from sqlalchemy.orm import Session

from app.api import deps
from app.api.deps import get_current_admin_user
from app.core.database.database import get_db
from app.models.patient import Patient
from app.models.user import User
from app.schemas.admin import (
    OwnerDashboardHandoffAuthorization,
    OwnerGlobalSubjectDirectory,
)
from app.services.owner_access_service import (
    OWNER_GLOBAL_READ_BASIS,
    OwnerAccessError,
    list_owner_global_subjects,
)

router = APIRouter()


@router.get("/subjects", response_model=OwnerGlobalSubjectDirectory)
def list_owner_subjects(
    db: Session = Depends(get_db),
    admin_user: User = Depends(get_current_admin_user),
) -> OwnerGlobalSubjectDirectory:
    """Return only identifiers and display names needed to choose an archive."""

    try:
        subjects = list_owner_global_subjects(db, admin_user)
    except OwnerAccessError as error:
        raise HTTPException(
            status_code=error.status_code,
            detail={"code": error.code, "message": error.message},
        ) from error
    return OwnerGlobalSubjectDirectory(
        subjects=subjects,
        total_count=len(subjects),
        disclosure="管理员查看会被记录",
    )


@router.get(
    "/patients/{patient_id}/dashboard-handoff",
    response_model=OwnerDashboardHandoffAuthorization,
)
def authorize_dashboard_handoff(
    *,
    patient_id: int,
    request: Request,
    response: Response,
    owner_access: Optional[str] = Query(default=None),
    owner_access_reason: Optional[str] = Query(default=None),
    handoff_kind: Literal["clipboard", "csv", "print"],
    scope: Literal["all-loaded", "latest-report", "recent-five-years"],
    include_reports: bool,
    metric_count: int = Query(ge=0, le=200),
    report_count: int = Query(ge=0, le=1000),
    db: Session = Depends(get_db),
    admin_user: User = Depends(get_current_admin_user),
) -> OwnerDashboardHandoffAuthorization:
    """Authorize and audit one browser-side dashboard copy/export handoff."""

    patient = db.query(Patient).filter(Patient.id == patient_id).first()
    if patient is None:
        raise HTTPException(status_code=404, detail="Patient not found")

    deps.verify_patient_read_access(
        patient_id,
        db,
        admin_user,
        request=request,
        requested_owner_access=owner_access,
        owner_access_reason=owner_access_reason,
        resource="dashboard_export",
        allow_standard_access=False,
        handoff_kind=handoff_kind,
        handoff_scope=scope,
        include_reports=include_reports,
        metric_count=metric_count,
        report_count=report_count,
    )
    access_basis = (
        "owner" if patient.owner_user_id == admin_user.id else OWNER_GLOBAL_READ_BASIS
    )
    response.headers["Cache-Control"] = "no-store"
    response.headers["Pragma"] = "no-cache"
    return OwnerDashboardHandoffAuthorization(
        status="authorized",
        patient_id=patient_id,
        access_basis=access_basis,
        handoff_kind=handoff_kind,
        scope=scope,
        include_reports=include_reports,
        metric_count=metric_count,
        report_count=report_count,
        audit_recorded=access_basis == OWNER_GLOBAL_READ_BASIS,
    )
