from typing import Optional

from fastapi import APIRouter, Depends, Query, Request, status
from sqlalchemy.orm import Session

from app.api import deps
from app.models.user import User
from app.schemas.health_coverage import (
    HealthCoverageCreate,
    HealthCoverageResponse,
    HealthCoverageRevision,
    HealthCoverageVoidRequest,
)
from app.services.health_coverage_service import health_coverage_service

router = APIRouter()


@router.get("/patients/{patient_id}", response_model=list[HealthCoverageResponse])
def list_health_coverage(
    *,
    db: Session = Depends(deps.get_db),
    patient_id: int,
    request: Request,
    include_history: bool = Query(False),
    include_voided: bool = Query(False),
    owner_access: Optional[str] = Query(default=None),
    owner_access_reason: Optional[str] = Query(default=None),
    current_user: User = Depends(deps.get_current_user),
):
    deps.verify_patient_read_access(
        patient_id,
        db,
        current_user,
        request=request,
        requested_owner_access=owner_access,
        owner_access_reason=owner_access_reason,
        resource="health_coverage",
    )
    return health_coverage_service.list_statements(
        db,
        patient_id=patient_id,
        include_history=include_history,
        include_voided=include_voided,
    )


@router.post(
    "/patients/{patient_id}",
    response_model=HealthCoverageResponse,
    status_code=status.HTTP_201_CREATED,
)
def create_health_coverage(
    *,
    db: Session = Depends(deps.get_db),
    patient_id: int,
    statement_in: HealthCoverageCreate,
    current_user: User = Depends(deps.get_current_user),
):
    deps.verify_patient_access(patient_id, db, current_user, required_permission="edit")
    return health_coverage_service.create(
        db,
        patient_id=patient_id,
        current_user=current_user,
        statement_in=statement_in,
    )


@router.post("/statements/{statement_id}/revise", response_model=HealthCoverageResponse)
def revise_health_coverage(
    *,
    db: Session = Depends(deps.get_db),
    statement_id: int,
    revision_in: HealthCoverageRevision,
    request: Request,
    admin_action: Optional[str] = Query(default=None),
    admin_action_reason: Optional[str] = Query(default=None),
    current_user: User = Depends(deps.get_current_user),
):
    statement = health_coverage_service.get_statement(db, statement_id)
    admin_context = deps.verify_patient_revision_access(
        statement.patient_id,
        db,
        current_user,
        request=request,
        requested_admin_action=admin_action,
        admin_action_reason=admin_action_reason,
        required_capability="owner_record_revise",
        operation="revise_health_coverage",
        object_type="health_coverage_statement",
        object_id=statement.id,
    )
    return health_coverage_service.revise(
        db,
        statement_id=statement_id,
        current_user=current_user,
        revision_in=revision_in,
        admin_context=admin_context,
    )


@router.post("/statements/{statement_id}/void", response_model=HealthCoverageResponse)
def void_health_coverage(
    *,
    db: Session = Depends(deps.get_db),
    statement_id: int,
    void_in: HealthCoverageVoidRequest,
    request: Request,
    admin_action: Optional[str] = Query(default=None),
    admin_action_reason: Optional[str] = Query(default=None),
    current_user: User = Depends(deps.get_current_user),
):
    statement = health_coverage_service.get_statement(db, statement_id)
    admin_context = deps.verify_patient_revision_access(
        statement.patient_id,
        db,
        current_user,
        request=request,
        requested_admin_action=admin_action,
        admin_action_reason=admin_action_reason,
        required_capability="owner_record_void",
        operation="void_health_coverage",
        object_type="health_coverage_statement",
        object_id=statement.id,
    )
    return health_coverage_service.void(
        db,
        statement_id=statement_id,
        expected_version=void_in.expected_version,
        reason=void_in.reason,
        current_user=current_user,
        admin_context=admin_context,
    )
