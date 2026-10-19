"""Owner-only household health AI capability and question endpoints."""

from fastapi import APIRouter, Depends, Header, HTTPException, Query, Request, Response
from sqlalchemy.orm import Session

from app.api import deps
from app.models.user import User
from app.schemas.health_ai import (
    HealthAiAnswerDeleteResponse,
    HealthAiAnswerListResponse,
    HealthAiCapabilityResponse,
    HealthAiQuestionRequest,
    HealthAiQuestionResponse,
)
from app.services.admin_health_ai_service import build_persisted_health_ai_runtime
from app.services.health_ai_provider import HealthAiRuntime
from app.services.health_ai_service import HealthAiError, HealthAiService

router = APIRouter()


def get_health_ai_runtime(
    db: Session = Depends(deps.get_db),
) -> HealthAiRuntime:
    return build_persisted_health_ai_runtime(db)


def _raise_http(error: HealthAiError):
    headers = {
        "X-Error-Code": error.code,
        "Cache-Control": "no-store",
        **error.headers,
    }
    raise HTTPException(
        status_code=error.status_code,
        detail={"code": error.code, "message": error.message},
        headers=headers,
    ) from error


@router.get(
    "/subjects/{patient_id}/capabilities",
    response_model=HealthAiCapabilityResponse,
)
def get_health_ai_capabilities(
    patient_id: int,
    response: Response,
    db: Session = Depends(deps.get_db),
    current_user: User = Depends(deps.get_current_user),
    runtime: HealthAiRuntime = Depends(get_health_ai_runtime),
):
    response.headers["Cache-Control"] = "no-store"
    try:
        return HealthAiService(db, runtime).capability(
            actor=current_user,
            patient_id=patient_id,
        )
    except HealthAiError as error:
        _raise_http(error)


@router.post(
    "/subjects/{patient_id}/questions",
    response_model=HealthAiQuestionResponse,
)
async def ask_health_ai_question(
    patient_id: int,
    question: HealthAiQuestionRequest,
    request: Request,
    response: Response,
    idempotency_key: str | None = Header(
        default=None,
        alias="Idempotency-Key",
    ),
    db: Session = Depends(deps.get_db),
    current_user: User = Depends(deps.get_current_user),
    runtime: HealthAiRuntime = Depends(get_health_ai_runtime),
):
    response.headers["Cache-Control"] = "no-store"
    try:
        result = await HealthAiService(db, runtime).answer(
            actor=current_user,
            patient_id=patient_id,
            request=question,
            idempotency_key=idempotency_key,
            ip_address=request.client.host if request.client else None,
            user_agent=request.headers.get("user-agent"),
        )
        for header, value in result.headers.items():
            response.headers[header] = value
        return result.payload
    except HealthAiError as error:
        _raise_http(error)


@router.get(
    "/subjects/{patient_id}/answers",
    response_model=HealthAiAnswerListResponse,
)
def list_health_ai_answers(
    patient_id: int,
    response: Response,
    limit: int = Query(default=20, ge=1, le=50),
    offset: int = Query(default=0, ge=0),
    db: Session = Depends(deps.get_db),
    current_user: User = Depends(deps.get_current_user),
    runtime: HealthAiRuntime = Depends(get_health_ai_runtime),
):
    response.headers["Cache-Control"] = "no-store"
    try:
        return HealthAiService(db, runtime).list_answers(
            actor=current_user,
            patient_id=patient_id,
            limit=limit,
            offset=offset,
        )
    except HealthAiError as error:
        _raise_http(error)


@router.get(
    "/subjects/{patient_id}/answers/{answer_id}",
    response_model=HealthAiQuestionResponse,
)
def get_health_ai_answer(
    patient_id: int,
    answer_id: int,
    response: Response,
    db: Session = Depends(deps.get_db),
    current_user: User = Depends(deps.get_current_user),
    runtime: HealthAiRuntime = Depends(get_health_ai_runtime),
):
    response.headers["Cache-Control"] = "no-store"
    try:
        return HealthAiService(db, runtime).get_answer(
            actor=current_user,
            patient_id=patient_id,
            answer_id=answer_id,
        )
    except HealthAiError as error:
        _raise_http(error)


@router.delete(
    "/subjects/{patient_id}/answers/{answer_id}",
    response_model=HealthAiAnswerDeleteResponse,
)
def delete_health_ai_answer(
    patient_id: int,
    answer_id: int,
    request: Request,
    response: Response,
    db: Session = Depends(deps.get_db),
    current_user: User = Depends(deps.get_current_user),
    runtime: HealthAiRuntime = Depends(get_health_ai_runtime),
):
    response.headers["Cache-Control"] = "no-store"
    try:
        return HealthAiService(db, runtime).delete_answer(
            actor=current_user,
            patient_id=patient_id,
            answer_id=answer_id,
            ip_address=request.client.host if request.client else None,
            user_agent=request.headers.get("user-agent"),
        )
    except HealthAiError as error:
        _raise_http(error)
