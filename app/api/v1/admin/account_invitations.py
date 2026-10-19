"""Sole-administrator API for invited ordinary member accounts."""

from fastapi import APIRouter, Depends, Request, Response, status
from sqlalchemy.orm import Session

from app.api import deps
from app.core.http.error_handling import MedicalRecordsAPIException
from app.core.rate_limit import InProcessRateLimiter
from app.models.account_invitation import AccountInvitation
from app.models.user import User
from app.schemas.account_invitation import (
    AccountInvitationCancelRequest,
    AccountInvitationCreatedResponse,
    AccountInvitationCreateRequest,
    AccountInvitationListResponse,
    AccountInvitationMemberResponse,
    AccountInvitationResponse,
)
from app.services.account_invitation_service import (
    ACCOUNT_INVITATION_CONTRACT_VERSION,
    AccountInvitationError,
    AccountInvitationService,
)

router = APIRouter()
admin_invitation_mutation_limiter = InProcessRateLimiter(
    max_requests=30,
    window_seconds=3600,
)


def _client_key(request: Request, operation: str) -> str:
    peer = request.client.host if request.client else "unknown"
    return f"{operation}:{peer}"


def _enforce_mutation_limit(request: Request, operation: str) -> None:
    decision = admin_invitation_mutation_limiter.check(_client_key(request, operation))
    if not decision.allowed:
        raise MedicalRecordsAPIException(
            error_code="rate_limit_exceeded",
            http_status_code=status.HTTP_429_TOO_MANY_REQUESTS,
            message="邀请操作过于频繁，请稍后再试",
            description="管理员邀请操作超过本进程限速",
            request=request,
            headers={
                "Retry-After": str(decision.retry_after_seconds),
                "Cache-Control": "no-store",
            },
        )


def _raise_http(error: AccountInvitationError, request: Request):
    raise MedicalRecordsAPIException(
        error_code=error.code,
        http_status_code=error.status_code,
        message=error.message,
        description="管理员邀请操作未完成",
        request=request,
        headers={"Cache-Control": "no-store"},
    ) from error


def _serialize(
    service: AccountInvitationService,
    invitation: AccountInvitation,
) -> AccountInvitationResponse:
    activated_member = None
    if invitation.activated_user is not None:
        activated_member = AccountInvitationMemberResponse(
            username=invitation.activated_user.username,
            display_name=invitation.activated_user.full_name,
        )
    return AccountInvitationResponse(
        id=invitation.public_id,
        recipient_label=invitation.recipient_label,
        status=service.status_for(invitation),
        expires_at=invitation.expires_at,
        created_at=invitation.created_at,
        activated_at=invitation.activated_at,
        declined_at=invitation.declined_at,
        cancelled_at=invitation.cancelled_at,
        activated_member=activated_member,
    )


@router.post(
    "",
    response_model=AccountInvitationCreatedResponse,
    status_code=status.HTTP_201_CREATED,
)
def create_account_invitation(
    payload: AccountInvitationCreateRequest,
    request: Request,
    response: Response,
    db: Session = Depends(deps.get_db),
    current_user: User = Depends(deps.get_current_admin_user),
) -> AccountInvitationCreatedResponse:
    _enforce_mutation_limit(request, "create")
    service = AccountInvitationService(db)
    try:
        created = service.create_invitation(
            actor=current_user,
            recipient_label=payload.recipient_label,
            expires_in_hours=payload.expires_in_hours,
        )
    except AccountInvitationError as error:
        _raise_http(error, request)
    response.headers["Cache-Control"] = "no-store"
    return AccountInvitationCreatedResponse(
        contract_version=ACCOUNT_INVITATION_CONTRACT_VERSION,
        invitation=_serialize(service, created.invitation),
        activation_path=f"/activate#token={created.token}",
    )


@router.get("", response_model=AccountInvitationListResponse)
def list_account_invitations(
    request: Request,
    response: Response,
    skip: int = 0,
    limit: int = 100,
    db: Session = Depends(deps.get_db),
    current_user: User = Depends(deps.get_current_admin_user),
) -> AccountInvitationListResponse:
    service = AccountInvitationService(db)
    try:
        invitations = service.list_invitations(
            current_user,
            skip=skip,
            limit=limit,
        )
    except AccountInvitationError as error:
        _raise_http(error, request)
    response.headers["Cache-Control"] = "no-store"
    items = [_serialize(service, invitation) for invitation in invitations]
    return AccountInvitationListResponse(
        contract_version=ACCOUNT_INVITATION_CONTRACT_VERSION,
        items=items,
        total=len(items),
    )


@router.post(
    "/{public_id}/cancel",
    response_model=AccountInvitationResponse,
)
def cancel_account_invitation(
    public_id: str,
    payload: AccountInvitationCancelRequest,
    request: Request,
    response: Response,
    db: Session = Depends(deps.get_db),
    current_user: User = Depends(deps.get_current_admin_user),
) -> AccountInvitationResponse:
    _enforce_mutation_limit(request, "cancel")
    service = AccountInvitationService(db)
    try:
        invitation = service.cancel(
            actor=current_user,
            public_id=public_id,
            reason=payload.reason,
        )
    except AccountInvitationError as error:
        _raise_http(error, request)
    response.headers["Cache-Control"] = "no-store"
    return _serialize(service, invitation)
