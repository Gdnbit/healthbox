from typing import Optional

from fastapi import APIRouter, Depends, Query, Request, status
from sqlalchemy.orm import Session

from app.api import deps
from app.models.user import User
from app.schemas.health_background import (
    HealthBackgroundCreate,
    HealthBackgroundResponse,
    HealthBackgroundRevision,
    HealthBackgroundVoidRequest,
)
from app.services.health_background_service import health_background_service

router = APIRouter()


@router.get("/patients/{patient_id}", response_model=list[HealthBackgroundResponse])
def list_health_background(
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
        resource="health_background",
    )
    return health_background_service.list_entries(
        db,
        patient_id=patient_id,
        include_history=include_history,
        include_voided=include_voided,
    )


@router.post(
    "/patients/{patient_id}",
    response_model=HealthBackgroundResponse,
    status_code=status.HTTP_201_CREATED,
)
def create_health_background(
    *,
    db: Session = Depends(deps.get_db),
    patient_id: int,
    entry_in: HealthBackgroundCreate,
    current_user: User = Depends(deps.get_current_user),
):
    deps.verify_patient_access(patient_id, db, current_user, required_permission="edit")
    return health_background_service.create(
        db, patient_id=patient_id, current_user=current_user, entry_in=entry_in
    )


@router.post("/entries/{entry_id}/revise", response_model=HealthBackgroundResponse)
def revise_health_background(
    *,
    db: Session = Depends(deps.get_db),
    entry_id: int,
    revision_in: HealthBackgroundRevision,
    request: Request,
    admin_action: Optional[str] = Query(default=None),
    admin_action_reason: Optional[str] = Query(default=None),
    current_user: User = Depends(deps.get_current_user),
):
    entry = health_background_service.get_entry(db, entry_id)
    admin_context = deps.verify_patient_revision_access(
        entry.patient_id,
        db,
        current_user,
        request=request,
        requested_admin_action=admin_action,
        admin_action_reason=admin_action_reason,
        required_capability="owner_record_revise",
        operation="revise_health_background",
        object_type="health_background",
        object_id=entry.id,
    )
    return health_background_service.revise(
        db,
        entry_id=entry_id,
        current_user=current_user,
        revision_in=revision_in,
        admin_context=admin_context,
    )


@router.post("/entries/{entry_id}/void", response_model=HealthBackgroundResponse)
def void_health_background(
    *,
    db: Session = Depends(deps.get_db),
    entry_id: int,
    void_in: HealthBackgroundVoidRequest,
    request: Request,
    admin_action: Optional[str] = Query(default=None),
    admin_action_reason: Optional[str] = Query(default=None),
    current_user: User = Depends(deps.get_current_user),
):
    entry = health_background_service.get_entry(db, entry_id)
    admin_context = deps.verify_patient_revision_access(
        entry.patient_id,
        db,
        current_user,
        request=request,
        requested_admin_action=admin_action,
        admin_action_reason=admin_action_reason,
        required_capability="owner_record_void",
        operation="void_health_background",
        object_type="health_background",
        object_id=entry.id,
    )
    return health_background_service.void(
        db,
        entry_id=entry_id,
        expected_version=void_in.expected_version,
        reason=void_in.reason,
        current_user=current_user,
        admin_context=admin_context,
    )
