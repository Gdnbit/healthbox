"""Sole-administrator endpoints for the household health AI runtime."""

from fastapi import APIRouter, Depends, HTTPException, Request, Response
from sqlalchemy.orm import Session

from app.api.deps import get_current_admin_user
from app.core.database.database import get_db
from app.models.user import User
from app.schemas.admin_health_ai import (
    AdminHealthAiSettingsResponse,
    AdminHealthAiSettingsUpdate,
    AdminHealthAiTestRequest,
    AdminHealthAiTestResponse,
)
from app.services.admin_health_ai_service import (
    AdminHealthAiError,
    get_admin_health_ai_settings,
    test_admin_health_ai_connection,
    update_admin_health_ai_settings,
)

router = APIRouter()


def _raise_http(error: AdminHealthAiError) -> None:
    raise HTTPException(
        status_code=error.status_code,
        detail={"code": error.code, "message": error.message},
        headers={
            "X-Error-Code": error.code,
            "Cache-Control": "no-store",
        },
    ) from error


@router.get("/settings", response_model=AdminHealthAiSettingsResponse)
def get_health_ai_settings(
    response: Response,
    db: Session = Depends(get_db),
    admin_user: User = Depends(get_current_admin_user),
) -> AdminHealthAiSettingsResponse:
    response.headers["Cache-Control"] = "no-store"
    try:
        payload = get_admin_health_ai_settings(db, admin_user)
    except AdminHealthAiError as error:
        _raise_http(error)
    return AdminHealthAiSettingsResponse.model_validate(payload)


@router.put("/settings", response_model=AdminHealthAiSettingsResponse)
def update_health_ai_settings(
    *,
    settings_in: AdminHealthAiSettingsUpdate,
    request: Request,
    response: Response,
    db: Session = Depends(get_db),
    admin_user: User = Depends(get_current_admin_user),
) -> AdminHealthAiSettingsResponse:
    response.headers["Cache-Control"] = "no-store"
    try:
        payload = update_admin_health_ai_settings(
            db,
            actor=admin_user,
            expected_revision=settings_in.expected_revision,
            mode=settings_in.mode,
            base_url=settings_in.base_url,
            model=settings_in.model,
            reason=settings_in.reason,
            ip_address=request.client.host if request.client else None,
            user_agent=request.headers.get("user-agent"),
        )
    except AdminHealthAiError as error:
        _raise_http(error)
    return AdminHealthAiSettingsResponse.model_validate(payload)


@router.post("/test-connection", response_model=AdminHealthAiTestResponse)
async def test_health_ai_connection(
    *,
    test_in: AdminHealthAiTestRequest,
    request: Request,
    response: Response,
    db: Session = Depends(get_db),
    admin_user: User = Depends(get_current_admin_user),
) -> AdminHealthAiTestResponse:
    response.headers["Cache-Control"] = "no-store"
    try:
        payload = await test_admin_health_ai_connection(
            db,
            actor=admin_user,
            expected_revision=test_in.expected_revision,
            reason=test_in.reason,
            ip_address=request.client.host if request.client else None,
            user_agent=request.headers.get("user-agent"),
        )
    except AdminHealthAiError as error:
        _raise_http(error)
    return AdminHealthAiTestResponse.model_validate(payload)
