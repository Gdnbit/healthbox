"""Sole-administrator management API for hidden archive circles."""

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session

from app.api import deps
from app.models.user import User
from app.schemas.archive_circle import (
    ArchiveAdminSubjectListResponse,
    ArchiveCircleCreateRequest,
    ArchiveCircleListResponse,
    ArchiveCircleMemberRequest,
    ArchiveCircleMembershipStatusRequest,
    ArchiveCircleMoveRequest,
    ArchiveCircleMutationResponse,
    ArchiveCircleResponse,
    ArchiveCircleStatusRequest,
)
from app.services.archive_circle_service import (
    ArchiveCircleError,
    ArchiveCircleService,
)

router = APIRouter()


def _raise_http(error: ArchiveCircleError):
    raise HTTPException(
        status_code=error.status_code,
        detail={"code": error.code, "message": error.message},
    ) from error


@router.get("", response_model=ArchiveCircleListResponse)
def list_archive_circles(
    db: Session = Depends(deps.get_db),
    current_user: User = Depends(deps.get_current_admin_user),
):
    try:
        circles = ArchiveCircleService(db).list_circles(current_user)
    except ArchiveCircleError as error:
        _raise_http(error)
    return ArchiveCircleListResponse(circles=circles)


@router.get("/eligible-subjects", response_model=ArchiveAdminSubjectListResponse)
def list_archive_circle_subjects(
    db: Session = Depends(deps.get_db),
    current_user: User = Depends(deps.get_current_admin_user),
):
    try:
        subjects = ArchiveCircleService(db).list_admin_subjects(current_user)
    except ArchiveCircleError as error:
        _raise_http(error)
    return ArchiveAdminSubjectListResponse(subjects=subjects)


@router.get("/{circle_id}", response_model=ArchiveCircleResponse)
def get_archive_circle(
    circle_id: int,
    db: Session = Depends(deps.get_db),
    current_user: User = Depends(deps.get_current_admin_user),
):
    try:
        circle = ArchiveCircleService(db).get_circle(current_user, circle_id)
    except ArchiveCircleError as error:
        _raise_http(error)
    return ArchiveCircleResponse(**circle)


@router.post(
    "",
    response_model=ArchiveCircleMutationResponse,
    status_code=status.HTTP_201_CREATED,
)
def create_archive_circle(
    payload: ArchiveCircleCreateRequest,
    db: Session = Depends(deps.get_db),
    current_user: User = Depends(deps.get_current_admin_user),
):
    try:
        circle = ArchiveCircleService(db).create_circle(
            actor=current_user,
            name=payload.name,
            description=payload.description,
        )
    except ArchiveCircleError as error:
        _raise_http(error)
    return ArchiveCircleMutationResponse(circle_id=circle.id)


@router.patch(
    "/{circle_id}",
    response_model=ArchiveCircleMutationResponse,
)
def update_archive_circle_status(
    circle_id: int,
    payload: ArchiveCircleStatusRequest,
    db: Session = Depends(deps.get_db),
    current_user: User = Depends(deps.get_current_admin_user),
):
    try:
        circle = ArchiveCircleService(db).set_circle_status(
            actor=current_user,
            circle_id=circle_id,
            status=payload.status,
        )
    except ArchiveCircleError as error:
        _raise_http(error)
    return ArchiveCircleMutationResponse(circle_id=circle.id)


@router.post(
    "/{circle_id}/members",
    response_model=ArchiveCircleMutationResponse,
)
def add_archive_circle_member(
    circle_id: int,
    payload: ArchiveCircleMemberRequest,
    db: Session = Depends(deps.get_db),
    current_user: User = Depends(deps.get_current_admin_user),
):
    try:
        membership = ArchiveCircleService(db).add_member(
            actor=current_user,
            circle_id=circle_id,
            patient_id=payload.patient_id,
        )
    except ArchiveCircleError as error:
        _raise_http(error)
    return ArchiveCircleMutationResponse(
        circle_id=membership.circle_id,
        patient_id=membership.patient_id,
    )


@router.patch(
    "/{circle_id}/members/{patient_id}",
    response_model=ArchiveCircleMutationResponse,
)
def update_archive_circle_member(
    circle_id: int,
    patient_id: int,
    payload: ArchiveCircleMembershipStatusRequest,
    db: Session = Depends(deps.get_db),
    current_user: User = Depends(deps.get_current_admin_user),
):
    try:
        membership = ArchiveCircleService(db).set_membership_status(
            actor=current_user,
            circle_id=circle_id,
            patient_id=patient_id,
            status=payload.status,
        )
    except ArchiveCircleError as error:
        _raise_http(error)
    return ArchiveCircleMutationResponse(
        circle_id=membership.circle_id,
        patient_id=membership.patient_id,
    )


@router.delete(
    "/{circle_id}/members/{patient_id}",
    response_model=ArchiveCircleMutationResponse,
)
def remove_archive_circle_member(
    circle_id: int,
    patient_id: int,
    db: Session = Depends(deps.get_db),
    current_user: User = Depends(deps.get_current_admin_user),
):
    try:
        membership = ArchiveCircleService(db).remove_member(
            actor=current_user,
            circle_id=circle_id,
            patient_id=patient_id,
        )
    except ArchiveCircleError as error:
        _raise_http(error)
    return ArchiveCircleMutationResponse(
        circle_id=membership.circle_id,
        patient_id=membership.patient_id,
    )


@router.post(
    "/move-member",
    response_model=ArchiveCircleMutationResponse,
)
def move_archive_circle_member(
    payload: ArchiveCircleMoveRequest,
    db: Session = Depends(deps.get_db),
    current_user: User = Depends(deps.get_current_admin_user),
):
    try:
        membership = ArchiveCircleService(db).move_member(
            actor=current_user,
            patient_id=payload.patient_id,
            source_circle_id=payload.source_circle_id,
            target_circle_id=payload.target_circle_id,
        )
    except ArchiveCircleError as error:
        _raise_http(error)
    return ArchiveCircleMutationResponse(
        circle_id=membership.circle_id,
        patient_id=membership.patient_id,
    )
