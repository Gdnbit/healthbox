"""Public, token-gated account invitation endpoints."""

from fastapi import APIRouter, Depends, Request, Response, status
from sqlalchemy.orm import Session

from app.api import deps
from app.core.http.error_handling import MedicalRecordsAPIException
from app.core.rate_limit import InProcessRateLimiter
from app.schemas.account_invitation import (
    AccountInvitationActivateRequest,
    AccountInvitationActivateResponse,
    AccountInvitationInspectResponse,
    AccountInvitationTokenRequest,
    PublicPrivacyNoticeResponse,
)
from app.services import privacy_consent_service
from app.services.account_invitation_service import (
    ACCOUNT_INVITATION_CONTRACT_VERSION,
    AccountInvitationError,
    AccountInvitationService,
)

router = APIRouter()
public_invitation_inspect_limiter = InProcessRateLimiter(
    max_requests=60,
    window_seconds=900,
)
public_invitation_activate_limiter = InProcessRateLimiter(
    max_requests=20,
    window_seconds=900,
)
public_invitation_decline_limiter = InProcessRateLimiter(
    max_requests=30,
    window_seconds=900,
)


def _client_key(request: Request, operation: str) -> str:
    peer = request.client.host if request.client else "unknown"
    return f"{operation}:{peer}"


def _enforce_limit(
    limiter: InProcessRateLimiter,
    request: Request,
    operation: str,
) -> None:
    decision = limiter.check(_client_key(request, operation))
    if not decision.allowed:
        raise MedicalRecordsAPIException(
            error_code="rate_limit_exceeded",
            http_status_code=status.HTTP_429_TOO_MANY_REQUESTS,
            message="请求过于频繁，请稍后再试",
            description="公开邀请操作超过本进程限速",
            request=request,
            headers={
                "Retry-After": str(decision.retry_after_seconds),
                "Cache-Control": "no-store",
            },
        )


def _raise_public(error: AccountInvitationError, request: Request):
    if error.code == "account_invitation_unavailable":
        raise MedicalRecordsAPIException(
            error_code="account_invitation_unavailable",
            http_status_code=status.HTTP_404_NOT_FOUND,
            message="邀请链接无效或已失效",
            description="无法使用这个邀请链接",
            request=request,
            headers={"Cache-Control": "no-store"},
        ) from error
    messages = {
        "account_capacity_reached": "当前账号容量已满，请联系管理员",
        "username_unavailable": "这个用户名不可用，请更换后重试",
        "privacy_notice_version_conflict": "隐私说明已更新，请重新阅读后确认",
        "password_policy_failed": "密码不符合安全要求",
        "account_activation_failed": "暂时无法完成激活，请稍后重试",
    }
    raise MedicalRecordsAPIException(
        error_code=error.code,
        http_status_code=error.status_code,
        message=messages.get(error.code, "暂时无法完成操作"),
        description="受邀账号激活操作未完成",
        request=request,
        headers={"Cache-Control": "no-store"},
    ) from error


@router.post(
    "/inspect",
    response_model=AccountInvitationInspectResponse,
)
def inspect_account_invitation(
    payload: AccountInvitationTokenRequest,
    request: Request,
    response: Response,
    db: Session = Depends(deps.get_db),
) -> AccountInvitationInspectResponse:
    _enforce_limit(public_invitation_inspect_limiter, request, "inspect")
    try:
        invitation = AccountInvitationService(db).inspect(
            token=payload.token.get_secret_value()
        )
    except AccountInvitationError as error:
        _raise_public(error, request)
    response.headers["Cache-Control"] = "no-store"
    return AccountInvitationInspectResponse(
        contract_version=ACCOUNT_INVITATION_CONTRACT_VERSION,
        valid=True,
        expires_at=invitation.expires_at,
        privacy_notice=PublicPrivacyNoticeResponse.model_validate(
            privacy_consent_service.current_notice_document()
        ),
    )


@router.post(
    "/activate",
    response_model=AccountInvitationActivateResponse,
    status_code=status.HTTP_201_CREATED,
)
def activate_account_invitation(
    payload: AccountInvitationActivateRequest,
    request: Request,
    response: Response,
    db: Session = Depends(deps.get_db),
) -> AccountInvitationActivateResponse:
    _enforce_limit(public_invitation_activate_limiter, request, "activate")
    try:
        result = AccountInvitationService(db).activate(
            token=payload.token.get_secret_value(),
            username=payload.username,
            display_name=payload.display_name,
            birth_date=payload.birth_date,
            gender=payload.gender,
            password=payload.password.get_secret_value(),
            privacy_notice_version=payload.privacy_notice_version,
            privacy_notice_accepted=payload.privacy_notice_accepted,
        )
    except AccountInvitationError as error:
        _raise_public(error, request)
    response.headers["Cache-Control"] = "no-store"
    return AccountInvitationActivateResponse(
        contract_version=ACCOUNT_INVITATION_CONTRACT_VERSION,
        status="activated",
        username=result.user.username,
        display_name=result.user.full_name,
        login_path="/login",
    )


@router.post(
    "/decline",
    status_code=status.HTTP_204_NO_CONTENT,
)
def decline_account_invitation(
    payload: AccountInvitationTokenRequest,
    request: Request,
    db: Session = Depends(deps.get_db),
) -> Response:
    _enforce_limit(public_invitation_decline_limiter, request, "decline")
    AccountInvitationService(db).decline(token=payload.token.get_secret_value())
    return Response(
        status_code=status.HTTP_204_NO_CONTENT,
        headers={"Cache-Control": "no-store"},
    )
