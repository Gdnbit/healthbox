"""Self-service complete health archive export endpoints."""

from typing import Annotated

from fastapi import (
    APIRouter,
    BackgroundTasks,
    Depends,
    HTTPException,
    Query,
    Request,
    status,
)
from fastapi.responses import FileResponse
from sqlalchemy.orm import Session, sessionmaker

from app.api import deps
from app.models.health_archive_export import HealthArchiveExport
from app.models.user import User
from app.schemas.health_archive_export import (
    HealthArchiveExportCreate,
    HealthArchiveExportListResponse,
    HealthArchiveExportResponse,
)
from app.services.health_archive_export_service import (
    HealthArchiveExportError,
    health_archive_export_service,
)
from app.services.health_archive_export_worker import (
    health_archive_export_worker,
)

router = APIRouter()


def _client_ip(request: Request) -> str | None:
    return request.client.host if request.client else None


def _response(task: HealthArchiveExport) -> HealthArchiveExportResponse:
    result = HealthArchiveExportResponse.model_validate(task)
    return result.model_copy(update={"can_download": task.status == "ready"})


def _raise_export_error(error: HealthArchiveExportError) -> None:
    raise HTTPException(
        status_code=error.status_code,
        detail={"code": error.code, "message": error.message},
    ) from error


def _schedule_archive(
    *,
    background_tasks: BackgroundTasks,
    db: Session,
    task: HealthArchiveExport,
) -> None:
    if task.status != "queued":
        return
    if health_archive_export_worker.notify():
        return
    worker_session = sessionmaker(
        autocommit=False,
        autoflush=False,
        bind=db.get_bind(),
    )
    background_tasks.add_task(
        health_archive_export_service.process_task,
        worker_session,
        task.id,
    )


@router.post(
    "",
    response_model=HealthArchiveExportResponse,
    status_code=status.HTTP_202_ACCEPTED,
)
def create_complete_archive(
    *,
    request: Request,
    background_tasks: BackgroundTasks,
    task_in: HealthArchiveExportCreate,
    db: Session = Depends(deps.get_db),
    current_user: User = Depends(deps.get_current_user),
):
    try:
        task = health_archive_export_service.create_task(
            db,
            actor=current_user,
            patient_id=task_in.patient_id,
            idempotency_key=task_in.idempotency_key,
            ip_address=_client_ip(request),
            user_agent=request.headers.get("user-agent"),
        )
        _schedule_archive(
            background_tasks=background_tasks,
            db=db,
            task=task,
        )
        return _response(task)
    except HealthArchiveExportError as error:
        _raise_export_error(error)


@router.get("", response_model=HealthArchiveExportListResponse)
def list_complete_archives(
    *,
    patient_id: Annotated[int, Query(gt=0)],
    limit: Annotated[int, Query(ge=1, le=50)] = 10,
    db: Session = Depends(deps.get_db),
    current_user: User = Depends(deps.get_current_user),
):
    try:
        tasks = health_archive_export_service.list_tasks(
            db,
            actor=current_user,
            patient_id=patient_id,
            limit=limit,
        )
        return HealthArchiveExportListResponse(
            items=[_response(task) for task in tasks],
            total=len(tasks),
        )
    except HealthArchiveExportError as error:
        _raise_export_error(error)


@router.get(
    "/{task_id}",
    response_model=HealthArchiveExportResponse,
)
def get_complete_archive(
    *,
    task_id: int,
    db: Session = Depends(deps.get_db),
    current_user: User = Depends(deps.get_current_user),
):
    try:
        task = health_archive_export_service.get_owned_task(
            db,
            actor=current_user,
            task_id=task_id,
        )
        return _response(task)
    except HealthArchiveExportError as error:
        _raise_export_error(error)


@router.post(
    "/{task_id}/cancel",
    response_model=HealthArchiveExportResponse,
)
def cancel_complete_archive(
    *,
    request: Request,
    task_id: int,
    db: Session = Depends(deps.get_db),
    current_user: User = Depends(deps.get_current_user),
):
    try:
        task = health_archive_export_service.cancel_task(
            db,
            actor=current_user,
            task_id=task_id,
            ip_address=_client_ip(request),
            user_agent=request.headers.get("user-agent"),
        )
        return _response(task)
    except HealthArchiveExportError as error:
        _raise_export_error(error)


@router.get("/{task_id}/download")
def download_complete_archive(
    *,
    request: Request,
    task_id: int,
    db: Session = Depends(deps.get_db),
    current_user: User = Depends(deps.get_current_user),
):
    try:
        task, archive_path = health_archive_export_service.prepare_download(
            db,
            actor=current_user,
            task_id=task_id,
            ip_address=_client_ip(request),
            user_agent=request.headers.get("user-agent"),
        )
        return FileResponse(
            path=archive_path,
            filename=task.archive_filename,
            media_type="application/zip",
            headers={
                "Cache-Control": "no-store",
                "Pragma": "no-cache",
                "X-Content-Type-Options": "nosniff",
                "X-Download-Options": "noopen",
            },
        )
    except HealthArchiveExportError as error:
        _raise_export_error(error)
