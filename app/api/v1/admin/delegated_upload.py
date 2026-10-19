"""Sole-administrator controls for the default-off delegated-upload capability."""

from fastapi import APIRouter, Depends, HTTPException, Request
from sqlalchemy.orm import Session

from app.api.deps import get_current_admin_user
from app.core.database.database import get_db
from app.models.user import User
from app.schemas.admin import (
    AdminDelegatedUploadSettingsResponse,
    AdminDelegatedUploadSettingsUpdate,
)
from app.services.admin_delegated_upload_service import (
    ADMIN_DELEGATED_UPLOAD_CAPABILITY,
    AdminDelegatedUploadError,
    get_admin_delegated_upload_status,
    set_admin_delegated_upload_enabled,
)

router = APIRouter()


def _raise_http(error: AdminDelegatedUploadError) -> None:
    raise HTTPException(
        status_code=error.status_code,
        detail={"code": error.code, "message": error.message},
        headers={"X-Error-Code": error.code},
    ) from error


@router.get("/settings", response_model=AdminDelegatedUploadSettingsResponse)
def get_delegated_upload_settings(
    db: Session = Depends(get_db),
    admin_user: User = Depends(get_current_admin_user),
) -> AdminDelegatedUploadSettingsResponse:
    try:
        enabled = get_admin_delegated_upload_status(db, admin_user)
    except AdminDelegatedUploadError as error:
        _raise_http(error)
    return AdminDelegatedUploadSettingsResponse(
        enabled=enabled,
        capability=ADMIN_DELEGATED_UPLOAD_CAPABILITY,
        disclosure="管理员代上传默认关闭；启用和每次使用都会记录",
    )


@router.put("/settings", response_model=AdminDelegatedUploadSettingsResponse)
def update_delegated_upload_settings(
    *,
    settings_in: AdminDelegatedUploadSettingsUpdate,
    request: Request,
    db: Session = Depends(get_db),
    admin_user: User = Depends(get_current_admin_user),
) -> AdminDelegatedUploadSettingsResponse:
    try:
        enabled = set_admin_delegated_upload_enabled(
            db,
            actor=admin_user,
            enabled=settings_in.enabled,
            reason=settings_in.reason,
            ip_address=request.client.host if request.client else None,
            user_agent=request.headers.get("user-agent"),
        )
    except AdminDelegatedUploadError as error:
        _raise_http(error)
    return AdminDelegatedUploadSettingsResponse(
        enabled=enabled,
        capability=ADMIN_DELEGATED_UPLOAD_CAPABILITY,
        disclosure="管理员代上传默认关闭；启用和每次使用都会记录",
    )
