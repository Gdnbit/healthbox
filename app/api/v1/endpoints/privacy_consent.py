from fastapi import APIRouter, Depends, Request
from sqlalchemy.orm import Session

from app.api import deps
from app.api.activity_logging import safe_log_activity
from app.api.deps import ConflictException
from app.models.activity_log import ActionType, EntityType
from app.models.user import User
from app.schemas.privacy_consent import (
    CurrentPrivacyNoticeResponse,
    PrivacyConsentDecisionRequest,
    PrivacyConsentDecisionResponse,
)
from app.services import privacy_consent_service

router = APIRouter()


@router.get("/current", response_model=CurrentPrivacyNoticeResponse)
def get_current_privacy_notice(
    *,
    db: Session = Depends(deps.get_db),
    current_user: User = Depends(deps.get_current_user),
) -> CurrentPrivacyNoticeResponse:
    return CurrentPrivacyNoticeResponse.model_validate(
        privacy_consent_service.current_notice_response(db, current_user.id)
    )


@router.post("/decisions", response_model=PrivacyConsentDecisionResponse)
def create_privacy_consent_decision(
    *,
    request: Request,
    decision_in: PrivacyConsentDecisionRequest,
    db: Session = Depends(deps.get_db),
    current_user: User = Depends(deps.get_current_user),
) -> PrivacyConsentDecisionResponse:
    try:
        row, created = privacy_consent_service.record_decision(
            db,
            user_id=current_user.id,
            notice_version=decision_in.notice_version,
            decision=decision_in.decision,
        )
    except ValueError as exc:
        db.rollback()
        raise ConflictException(
            message="Privacy notice version changed. Reload the current notice.",
            request=request,
        ) from exc

    if created:
        safe_log_activity(
            db=db,
            action=ActionType.UPDATED,
            entity_type=EntityType.USER,
            entity_obj=current_user,
            user_id=current_user.id,
            description="Versioned household privacy notice decision recorded",
            request=request,
            metadata={
                "notice_version": row.notice_version,
                "decision": row.decision,
                "notice_sha256": row.notice_sha256,
                "external_processing_included": False,
            },
        )
        db.commit()
        db.refresh(row)

    return PrivacyConsentDecisionResponse(
        id=row.id,
        notice_version=row.notice_version,
        decision=row.decision,
        decided_at=row.decided_at,
        privacy_consent_required=privacy_consent_service.privacy_consent_required(
            db,
            current_user.id,
        ),
    )
