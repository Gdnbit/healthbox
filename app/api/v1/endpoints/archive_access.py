"""Member-facing reciprocal archive access with no group metadata."""

from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from app.api import deps
from app.models.user import User
from app.schemas.archive_circle import (
    ArchiveSubjectListResponse,
    DashboardPreferencesResponse,
    DashboardPreferencesUpdateRequest,
    StructuredDashboardResponse,
)
from app.services.archive_circle_service import (
    ArchiveCircleError,
    ArchiveCircleService,
)
from app.services.archive_dashboard_service import ArchiveDashboardService
from app.services.archive_dashboard_preference_service import (
    ArchiveDashboardPreferenceService,
)

router = APIRouter()


def _raise_http(error: ArchiveCircleError):
    from fastapi import HTTPException

    raise HTTPException(
        status_code=error.status_code,
        detail={"code": error.code, "message": error.message},
    ) from error


@router.get("/subjects", response_model=ArchiveSubjectListResponse)
def list_archive_subjects(
    db: Session = Depends(deps.get_db),
    current_user: User = Depends(deps.get_current_user),
):
    try:
        subjects = ArchiveCircleService(db).list_accessible_subjects(current_user)
    except ArchiveCircleError as error:
        _raise_http(error)
    return ArchiveSubjectListResponse(subjects=subjects)


@router.get(
    "/subjects/{patient_id}/dashboard",
    response_model=StructuredDashboardResponse,
)
def get_archive_subject_dashboard(
    patient_id: int,
    db: Session = Depends(deps.get_db),
    current_user: User = Depends(deps.get_current_user),
):
    try:
        return ArchiveDashboardService(db).get_dashboard(
            actor=current_user,
            patient_id=patient_id,
        )
    except ArchiveCircleError as error:
        _raise_http(error)


@router.get(
    "/subjects/{patient_id}/dashboard-preferences",
    response_model=DashboardPreferencesResponse,
)
def get_archive_subject_dashboard_preferences(
    patient_id: int,
    db: Session = Depends(deps.get_db),
    current_user: User = Depends(deps.get_current_user),
):
    try:
        return ArchiveDashboardPreferenceService(db).get_preferences(
            actor=current_user,
            patient_id=patient_id,
        )
    except ArchiveCircleError as error:
        _raise_http(error)


@router.put(
    "/subjects/{patient_id}/dashboard-preferences",
    response_model=DashboardPreferencesResponse,
)
def update_archive_subject_dashboard_preferences(
    patient_id: int,
    request: DashboardPreferencesUpdateRequest,
    db: Session = Depends(deps.get_db),
    current_user: User = Depends(deps.get_current_user),
):
    try:
        return ArchiveDashboardPreferenceService(db).update_preferences(
            actor=current_user,
            patient_id=patient_id,
            pinned_metric_ids=request.pinned_metric_ids,
            ranges_by_metric_id=request.ranges_by_metric_id,
        )
    except ArchiveCircleError as error:
        _raise_http(error)
