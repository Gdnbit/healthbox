"""Current-member privacy visibility and access history."""

from fastapi import APIRouter, Depends, Query
from sqlalchemy.orm import Session

from app.api import deps
from app.models.user import User
from app.schemas.privacy_access import PrivacyAccessResponse
from app.services.privacy_access_service import PrivacyAccessService

router = APIRouter()


@router.get("/me", response_model=PrivacyAccessResponse)
def get_my_privacy_access(
    offset: int = Query(default=0, ge=0),
    limit: int = Query(default=50, ge=1, le=100),
    db: Session = Depends(deps.get_db),
    current_user: User = Depends(deps.get_current_user),
):
    return PrivacyAccessService(db).get_current_user_access(
        actor=current_user,
        offset=offset,
        limit=limit,
    )
