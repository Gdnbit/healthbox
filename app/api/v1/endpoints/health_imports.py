import hashlib
import os
import uuid
from datetime import date
from pathlib import Path
from typing import Literal, Optional

from fastapi import (
    APIRouter,
    BackgroundTasks,
    Body,
    Depends,
    File,
    Form,
    HTTPException,
    Query,
    Request,
    UploadFile,
    status,
)
from fastapi.responses import FileResponse, Response
from sqlalchemy.orm import Session, sessionmaker

from app.api import deps
from app.core.config import settings
from app.core.constants import (
    HEALTH_SOURCE_MIME_EXTENSIONS,
    MAX_HEALTH_SOURCE_IMAGE_FILE_SIZE,
    MAX_HEALTH_SOURCE_PDF_FILE_SIZE,
)
from app.core.utils.datetime_utils import get_utc_now
from app.models.activity_log import ActivityLog
from app.models.files import EntityFile
from app.models.health_imports import (
    HealthImportBatch,
    HealthSourceDocument,
    HealthSourceParseTask,
    HealthSourceSimilarityRelation,
    HealthSourceUploadBatch,
    HealthSourceUploadItem,
)
from app.models.labs import LabResult, LabTestComponent
from app.models.patient import Patient
from app.models.user import User
from app.schemas.health_imports import (
    HealthCsvPreviewResponse,
    HealthImportBatchCreate,
    HealthImportBatchResponse,
    HealthImportBatchReview,
    HealthImportCommitRequest,
    HealthImportCommitResponse,
    HealthImportRollbackResponse,
    HealthFormalMetricRevisionCreate,
    HealthFormalMetricRevisionHistoryResponse,
    HealthSourceDocumentDependencySummary,
    HealthSourceDocumentLifecycleResponse,
    HealthSourceDocumentResponse,
    HealthSourceDocumentWithdraw,
    HealthParserReadinessResponse,
    HealthSourceParseTaskResponse,
    HealthSourceParseTaskStart,
    HealthSourceSimilarityRelationResponse,
    HealthSourceSimilarityReview,
    HealthSourceUploadBatchCreate,
    HealthSourceUploadBatchResponse,
)
from app.services.health_csv_parser import MAX_CSV_ROWS, parse_health_csv
from app.services.admin_delegated_upload_service import (
    AdminDelegatedUploadContext,
    AdminDelegatedUploadError,
    assert_delegated_batch_scope,
    assert_delegated_source_scope,
    authorize_admin_delegated_upload,
)
from app.services.admin_cross_subject_action_service import (
    AdminCrossSubjectActionContext,
    OWNER_SOURCE_RESTORE_CAPABILITY,
    OWNER_SOURCE_WITHDRAW_CAPABILITY,
)
from app.services.health_import_service import health_import_service
from app.services.health_formal_metric_revision_service import (
    health_formal_metric_revision_service,
)
from app.services.health_source_parse_service import (
    health_source_parse_service,
    probe_local_parser_readiness,
)
from app.services.health_source_parse_worker import health_source_parse_worker
from app.services.health_source_upload_service import health_source_upload_service
from app.services.health_source_similarity_service import (
    SUPPORTED_IMAGE_MIME_TYPES,
    health_source_similarity_service,
    render_image_thumbnail,
)

router = APIRouter()

ALLOWED_SOURCE_MIME_TYPES = HEALTH_SOURCE_MIME_EXTENSIONS
SOURCE_DOCUMENT_PREVIEW_MIME_TYPES = {
    "application/pdf",
    "image/jpeg",
    "image/png",
    "image/webp",
}
SOURCE_EXTENSION_MIME_TYPES = {
    ".heic": "image/heic",
    ".heif": "image/heif",
    ".jpeg": "image/jpeg",
    ".jpg": "image/jpeg",
    ".pdf": "application/pdf",
    ".png": "image/png",
    ".tif": "image/tiff",
    ".tiff": "image/tiff",
    ".webp": "image/webp",
}
ALLOWED_DOCUMENT_TYPES = {
    "checkup",
    "laboratory",
    "imaging",
    "prescription",
    "visit",
    "other",
}
MAX_SOURCE_IMAGE_FILE_SIZE = MAX_HEALTH_SOURCE_IMAGE_FILE_SIZE
MAX_SOURCE_PDF_FILE_SIZE = MAX_HEALTH_SOURCE_PDF_FILE_SIZE
SOURCE_FILE_SIZE_LIMITS = {
    mime_type: (
        MAX_SOURCE_PDF_FILE_SIZE
        if mime_type == "application/pdf"
        else MAX_SOURCE_IMAGE_FILE_SIZE
    )
    for mime_type in ALLOWED_SOURCE_MIME_TYPES
}
MAX_CSV_FILE_SIZE = 2 * 1024 * 1024


def _get_batch_or_404(db: Session, batch_id: int) -> HealthImportBatch:
    batch = health_import_service.get_batch(db, batch_id)
    if batch is None:
        raise HTTPException(status_code=404, detail="Import batch not found")
    return batch


def _get_formal_component_or_404(
    db: Session, component_id: int
) -> tuple[LabTestComponent, LabResult]:
    component = (
        db.query(LabTestComponent).filter(LabTestComponent.id == component_id).first()
    )
    if component is None:
        raise HTTPException(status_code=404, detail="Formal metric not found")
    lab_result = (
        db.query(LabResult).filter(LabResult.id == component.lab_result_id).first()
    )
    if lab_result is None:
        raise HTTPException(status_code=404, detail="Formal metric parent not found")
    if component.import_batch_id is None:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail={"code": "formal_metric_revision_not_managed"},
            headers={"X-Error-Code": "formal_metric_revision_not_managed"},
        )
    return component, lab_result


def _get_source_document_or_404(
    db: Session, source_document_id: int
) -> HealthSourceDocument:
    source = health_import_service.get_source_document(db, source_document_id)
    if source is None:
        raise HTTPException(status_code=404, detail="Source document not found")
    return source


def _resolve_local_source_file(
    db: Session,
    source: HealthSourceDocument,
    current_user: User,
) -> tuple[Patient, EntityFile, Path]:
    """Resolve a retained local source without authorizing its disclosure."""

    patient = db.query(Patient).filter(Patient.id == source.patient_id).first()
    if patient is None:
        raise HTTPException(status_code=404, detail="Patient not found")

    if patient.owner_user_id != current_user.id:
        from app.core.constants import is_admin_role

        if not is_admin_role(current_user.role):
            raise HTTPException(status_code=404, detail="Source document not found")

    if source.primary_file_id is None:
        raise HTTPException(status_code=404, detail="Source file not found")
    entity_file = (
        db.query(EntityFile)
        .filter(
            EntityFile.id == source.primary_file_id,
            EntityFile.entity_type == "source-document",
            EntityFile.entity_id == source.id,
            EntityFile.storage_backend == "local",
        )
        .first()
    )
    if entity_file is None:
        raise HTTPException(status_code=404, detail="Source file not found")
    file_path = Path(entity_file.file_path)
    if not file_path.is_file():
        raise HTTPException(status_code=404, detail="Source file not found")
    return patient, entity_file, file_path


def _get_source_upload_batch_or_404(
    db: Session, batch_id: int
) -> HealthSourceUploadBatch:
    batch = health_source_upload_service.get_batch(db, batch_id)
    if batch is None:
        raise HTTPException(status_code=404, detail="Source upload batch not found")
    return batch


def _get_source_parse_task_or_404(db: Session, task_id: int) -> HealthSourceParseTask:
    task = health_source_parse_service.get_task(db, task_id)
    if task is None:
        raise HTTPException(status_code=404, detail="Source parsing task not found")
    return task


def _source_upload_batch_response(
    db: Session,
    batch: HealthSourceUploadBatch,
    *,
    include_similarity: bool,
) -> HealthSourceUploadBatchResponse:
    response = HealthSourceUploadBatchResponse.model_validate(batch)
    if not include_similarity:
        return response
    source_document_ids = [
        item.source_document_id
        for item in batch.items
        if item.source_document_id is not None
    ]
    relations = health_source_similarity_service.list_relations_for_sources(
        db,
        source_document_ids,
    )
    serialized = health_source_similarity_service.serialize_relations(db, relations)
    by_source: dict[int, list[dict]] = {}
    for relation in serialized:
        by_source.setdefault(relation["source_document_id"], []).append(relation)
        by_source.setdefault(relation["related_source_document_id"], []).append(
            relation
        )
    for item in response.items:
        if item.source_document_id is None:
            continue
        item_relations = by_source.get(item.source_document_id, [])
        item.near_duplicate_candidates = [
            HealthSourceSimilarityRelationResponse.model_validate(relation)
            for relation in item_relations
            if relation["relation_type"] == "near_duplicate"
        ]
        item.partial_overlap_candidates = [
            HealthSourceSimilarityRelationResponse.model_validate(relation)
            for relation in item_relations
            if relation["relation_type"] == "partial_overlap"
        ]
    return response


def _schedule_source_parse(
    background_tasks: BackgroundTasks,
    db: Session,
    task: HealthSourceParseTask,
) -> None:
    if task.status != "queued":
        return
    if health_source_parse_worker.notify():
        return
    worker_session = sessionmaker(
        autocommit=False,
        autoflush=False,
        expire_on_commit=False,
        bind=db.get_bind(),
    )
    background_tasks.add_task(
        health_source_parse_service.process_task,
        worker_session,
        task.id,
    )


def _safe_original_filename(filename: str | None) -> str:
    normalized = (filename or "").replace("\\", "/").split("/")[-1].strip()
    if not normalized or len(normalized) > 255 or "\x00" in normalized:
        raise HTTPException(status_code=422, detail="Invalid source document filename")
    return normalized


def _raise_delegated_upload_http(error: AdminDelegatedUploadError) -> None:
    raise HTTPException(
        status_code=error.status_code,
        detail={"code": error.code, "message": error.message},
        headers={"X-Error-Code": error.code},
    ) from error


def _verify_archive_owner_access(
    patient_id: int,
    db: Session,
    current_user: User,
    *,
    request: Request | None = None,
    delegated_upload: str | None = None,
    delegated_upload_reason: str | None = None,
    delegated_operation: str = "archive_access",
) -> AdminDelegatedUploadContext | None:
    """Keep sources self-owned unless the explicit default-off capability applies."""

    if delegated_upload is not None or delegated_upload_reason is not None:
        try:
            _, context = authorize_admin_delegated_upload(
                db,
                actor=current_user,
                patient_id=patient_id,
                requested_capability=delegated_upload,
                reason=delegated_upload_reason,
                operation=delegated_operation,
                ip_address=(
                    request.client.host if request and request.client else None
                ),
                user_agent=request.headers.get("user-agent") if request else None,
            )
        except AdminDelegatedUploadError as error:
            _raise_delegated_upload_http(error)
        return context
    patient = db.query(Patient).filter(Patient.id == patient_id).first()
    if patient is None:
        raise HTTPException(status_code=404, detail="Patient not found")
    if patient.owner_user_id == current_user.id:
        deps.verify_patient_access(
            patient_id,
            db,
            current_user,
            required_permission="edit",
        )
        return None
    deps.verify_patient_access(
        patient_id,
        db,
        current_user,
        required_permission="edit",
    )
    raise HTTPException(
        status_code=403,
        detail="Only the archive owner can access report sources and imports",
    )


def _verify_source_lifecycle_access(
    source: HealthSourceDocument,
    db: Session,
    current_user: User,
    *,
    request: Request,
    required_admin_capability: str,
    admin_operation: str,
    admin_action: str | None,
    admin_action_reason: str | None,
    delegated_upload: str | None,
    delegated_upload_reason: str | None,
    delegated_operation: str,
) -> tuple[
    AdminDelegatedUploadContext | None,
    AdminCrossSubjectActionContext | None,
]:
    """Keep delegated upload and later cross-subject maintenance independent."""

    if admin_action is not None or admin_action_reason is not None:
        admin_context = deps.verify_patient_revision_access(
            source.patient_id,
            db,
            current_user,
            request=request,
            requested_admin_action=admin_action,
            admin_action_reason=admin_action_reason,
            required_capability=required_admin_capability,
            operation=admin_operation,
            object_type="health_source_document",
            object_id=source.id,
        )
        return None, admin_context
    delegated_context = _verify_archive_owner_access(
        source.patient_id,
        db,
        current_user,
        request=request,
        delegated_upload=delegated_upload,
        delegated_upload_reason=delegated_upload_reason,
        delegated_operation=delegated_operation,
    )
    return delegated_context, None


def _resolved_source_mime_type(file: UploadFile, filename: str) -> str:
    declared = (file.content_type or "").lower()
    if declared in ALLOWED_SOURCE_MIME_TYPES:
        return declared
    if declared in {"", "application/octet-stream"}:
        inferred = SOURCE_EXTENSION_MIME_TYPES.get(Path(filename).suffix.lower())
        if inferred:
            return inferred
    raise HTTPException(status_code=415, detail="Unsupported source document type")


def _has_heif_signature(content: bytes) -> bool:
    if len(content) < 16 or content[4:8] != b"ftyp":
        return False
    declared_box_size = int.from_bytes(content[:4], byteorder="big")
    end = min(
        len(content), declared_box_size if declared_box_size >= 16 else len(content), 64
    )
    brands = {content[offset : offset + 4] for offset in range(8, end - 3, 4)}
    return bool(
        brands
        & {
            b"heic",
            b"heix",
            b"hevc",
            b"hevx",
            b"heim",
            b"heis",
            b"hevm",
            b"hevs",
            b"heif",
            b"mif1",
            b"msf1",
        }
    )


def _validate_file_signature(content: bytes, mime_type: str) -> None:
    signature_matches = {
        "application/pdf": content.startswith(b"%PDF-"),
        "image/heic": _has_heif_signature(content),
        "image/heif": _has_heif_signature(content),
        "image/jpeg": content.startswith(b"\xff\xd8\xff"),
        "image/png": content.startswith(b"\x89PNG\r\n\x1a\n"),
        "image/tiff": content.startswith((b"II*\x00", b"MM\x00*")),
        "image/webp": (
            len(content) >= 12
            and content.startswith(b"RIFF")
            and content[8:12] == b"WEBP"
        ),
    }
    if not signature_matches.get(mime_type, False):
        raise HTTPException(
            status_code=422,
            detail="File content does not match the declared media type",
            headers={"X-Error-Code": "signature_mismatch"},
        )


def _upload_error_code(error: HTTPException) -> str:
    if error.headers and error.headers.get("X-Error-Code"):
        return error.headers["X-Error-Code"]
    return {
        413: "source_too_large",
        415: "unsupported_source_type",
    }.get(error.status_code, "source_validation_failed")


def _validate_upload_item_manifest(
    *,
    item: HealthSourceUploadItem,
    original_filename: str,
    mime_type: str,
    size_bytes: int,
    actual_sha256: str,
) -> None:
    if (
        item.original_filename != original_filename
        or item.mime_type != mime_type
        or item.size_bytes != size_bytes
    ):
        raise HTTPException(
            status_code=422,
            detail="Uploaded file does not match its batch manifest",
            headers={"X-Error-Code": "upload_manifest_mismatch"},
        )
    if item.client_sha256 and item.client_sha256 != actual_sha256:
        raise HTTPException(
            status_code=422,
            detail="Uploaded file checksum does not match its batch manifest",
            headers={"X-Error-Code": "sha256_mismatch"},
        )


def _validate_upload_batch_metadata(
    *,
    batch: HealthSourceUploadBatch,
    document_type: str,
    report_date: date | None,
    facility: str | None,
) -> None:
    normalized_facility = facility.strip() if facility else None
    if (
        batch.document_type != document_type
        or batch.report_date != report_date
        or batch.facility != normalized_facility
    ):
        raise HTTPException(
            status_code=422,
            detail="Source document metadata does not match its batch manifest",
            headers={"X-Error-Code": "upload_manifest_mismatch"},
        )


@router.post(
    "/patients/{patient_id}/source-upload-batches",
    response_model=HealthSourceUploadBatchResponse,
    status_code=status.HTTP_201_CREATED,
)
def create_source_upload_batch(
    *,
    request: Request,
    db: Session = Depends(deps.get_db),
    patient_id: int,
    batch_in: HealthSourceUploadBatchCreate,
    delegated_upload: Optional[str] = Query(default=None),
    delegated_upload_reason: Optional[str] = Query(default=None),
    current_user: User = Depends(deps.get_current_user),
):
    """Create a durable manifest before any original-file bytes are transferred."""

    delegated_context = _verify_archive_owner_access(
        patient_id,
        db,
        current_user,
        request=request,
        delegated_upload=delegated_upload,
        delegated_upload_reason=delegated_upload_reason,
        delegated_operation="create_upload_batch",
    )
    batch, _ = health_source_upload_service.create_batch(
        db,
        patient_id=patient_id,
        current_user=current_user,
        batch_in=batch_in,
        ip_address=request.client.host if request.client else None,
        delegated_context=delegated_context,
    )
    return _source_upload_batch_response(
        db,
        batch,
        include_similarity=delegated_context is None,
    )


@router.get(
    "/patients/{patient_id}/source-upload-batches",
    response_model=list[HealthSourceUploadBatchResponse],
)
def list_source_upload_batches(
    *,
    request: Request,
    db: Session = Depends(deps.get_db),
    patient_id: int,
    unfinished_only: bool = Query(False),
    limit: int = Query(50, ge=1, le=100),
    delegated_upload: Optional[str] = Query(default=None),
    delegated_upload_reason: Optional[str] = Query(default=None),
    current_user: User = Depends(deps.get_current_user),
):
    delegated_context = _verify_archive_owner_access(
        patient_id,
        db,
        current_user,
        request=request,
        delegated_upload=delegated_upload,
        delegated_upload_reason=delegated_upload_reason,
        delegated_operation="list_upload_batches",
    )
    batches = health_source_upload_service.list_batches(
        db,
        patient_id,
        unfinished_only=unfinished_only,
        limit=limit,
        created_by_user_id=(
            delegated_context.actor_user_id if delegated_context is not None else None
        ),
    )
    return [
        _source_upload_batch_response(
            db,
            batch,
            include_similarity=delegated_context is None,
        )
        for batch in batches
    ]


@router.get(
    "/source-upload-batches/{batch_id}",
    response_model=HealthSourceUploadBatchResponse,
)
def get_source_upload_batch(
    *,
    request: Request,
    db: Session = Depends(deps.get_db),
    batch_id: int,
    delegated_upload: Optional[str] = Query(default=None),
    delegated_upload_reason: Optional[str] = Query(default=None),
    current_user: User = Depends(deps.get_current_user),
):
    batch = _get_source_upload_batch_or_404(db, batch_id)
    delegated_context = _verify_archive_owner_access(
        batch.patient_id,
        db,
        current_user,
        request=request,
        delegated_upload=delegated_upload,
        delegated_upload_reason=delegated_upload_reason,
        delegated_operation="get_upload_batch",
    )
    try:
        assert_delegated_batch_scope(batch, delegated_context)
    except AdminDelegatedUploadError as error:
        _raise_delegated_upload_http(error)
    return _source_upload_batch_response(
        db,
        batch,
        include_similarity=delegated_context is None,
    )


@router.post(
    "/source-upload-batches/{batch_id}/complete",
    response_model=HealthSourceUploadBatchResponse,
)
def complete_source_upload_batch(
    *,
    request: Request,
    db: Session = Depends(deps.get_db),
    batch_id: int,
    delegated_upload: Optional[str] = Query(default=None),
    delegated_upload_reason: Optional[str] = Query(default=None),
    current_user: User = Depends(deps.get_current_user),
):
    batch = _get_source_upload_batch_or_404(db, batch_id)
    delegated_context = _verify_archive_owner_access(
        batch.patient_id,
        db,
        current_user,
        request=request,
        delegated_upload=delegated_upload,
        delegated_upload_reason=delegated_upload_reason,
        delegated_operation="complete_upload_batch",
    )
    try:
        assert_delegated_batch_scope(batch, delegated_context)
    except AdminDelegatedUploadError as error:
        _raise_delegated_upload_http(error)
    completed = health_source_upload_service.complete_batch(
        db,
        batch,
        current_user=current_user,
        ip_address=request.client.host if request.client else None,
        delegated_context=delegated_context,
    )
    return _source_upload_batch_response(
        db,
        completed,
        include_similarity=delegated_context is None,
    )


@router.post(
    "/source-upload-batches/{batch_id}/cancel",
    response_model=HealthSourceUploadBatchResponse,
)
def cancel_source_upload_batch(
    *,
    request: Request,
    db: Session = Depends(deps.get_db),
    batch_id: int,
    delegated_upload: Optional[str] = Query(default=None),
    delegated_upload_reason: Optional[str] = Query(default=None),
    current_user: User = Depends(deps.get_current_user),
):
    batch = _get_source_upload_batch_or_404(db, batch_id)
    delegated_context = _verify_archive_owner_access(
        batch.patient_id,
        db,
        current_user,
        request=request,
        delegated_upload=delegated_upload,
        delegated_upload_reason=delegated_upload_reason,
        delegated_operation="cancel_upload_batch",
    )
    try:
        assert_delegated_batch_scope(batch, delegated_context)
    except AdminDelegatedUploadError as error:
        _raise_delegated_upload_http(error)
    cancelled = health_source_upload_service.cancel_batch(
        db,
        batch,
        current_user=current_user,
        ip_address=request.client.host if request.client else None,
        delegated_context=delegated_context,
    )
    return _source_upload_batch_response(
        db,
        cancelled,
        include_similarity=delegated_context is None,
    )


@router.get(
    "/patients/{patient_id}/source-similarity-relations",
    response_model=list[HealthSourceSimilarityRelationResponse],
)
def list_source_similarity_relations(
    *,
    db: Session = Depends(deps.get_db),
    patient_id: int,
    review_status: Optional[Literal["pending", "confirmed", "dismissed"]] = Query(
        default=None
    ),
    limit: int = Query(default=50, ge=1, le=100),
    current_user: User = Depends(deps.get_current_user),
):
    """List only the archive owner's reviewable image relationships."""

    _verify_archive_owner_access(patient_id, db, current_user)
    relations = health_source_similarity_service.list_relations(
        db,
        patient_id=patient_id,
        review_status=review_status,
        limit=limit,
    )
    return health_source_similarity_service.serialize_relations(db, relations)


@router.post(
    "/source-similarity-relations/{relation_id}/review",
    response_model=HealthSourceSimilarityRelationResponse,
)
def review_source_similarity_relation(
    *,
    request: Request,
    db: Session = Depends(deps.get_db),
    relation_id: int,
    review: HealthSourceSimilarityReview,
    current_user: User = Depends(deps.get_current_user),
):
    relation = health_source_similarity_service.get_relation(db, relation_id)
    if relation is None:
        raise HTTPException(
            status_code=404,
            detail="Source similarity relationship not found",
        )
    _verify_archive_owner_access(relation.patient_id, db, current_user)
    try:
        relation, changed = health_source_similarity_service.review(
            relation,
            decision=review.decision,
            current_user=current_user,
        )
    except ValueError as error:
        if str(error) != "similarity_review_conflict":
            raise
        raise HTTPException(
            status_code=409,
            detail="Source similarity relationship was already reviewed",
            headers={"X-Error-Code": "similarity_review_conflict"},
        ) from error

    if changed:
        db.add(relation)
        db.add(
            ActivityLog.create_activity(
                action="reviewed",
                entity_type="health_source_similarity_relation",
                description="Reviewed a source image similarity candidate",
                user_id=current_user.id,
                patient_id=relation.patient_id,
                entity_id=relation.id,
                metadata={
                    "decision": review.decision,
                    "relation_type": relation.relation_type,
                    "source_document_id": relation.source_document_id,
                    "related_source_document_id": relation.related_source_document_id,
                    "algorithm_version": relation.algorithm_version,
                    "originals_changed": False,
                },
                ip_address=request.client.host if request.client else None,
            )
        )
        db.commit()
        db.refresh(relation)
    return health_source_similarity_service.serialize_relations(db, [relation])[0]


@router.get("/source-documents/{source_document_id}/thumbnail")
def thumbnail_source_document(
    *,
    db: Session = Depends(deps.get_db),
    source_document_id: int,
    current_user: User = Depends(deps.get_current_user),
):
    """Render a transient metadata-free JPEG for owner-only comparison."""

    source = _get_source_document_or_404(db, source_document_id)
    _verify_archive_owner_access(source.patient_id, db, current_user)
    if source.mime_type not in SUPPORTED_IMAGE_MIME_TYPES:
        raise HTTPException(
            status_code=415,
            detail="Source document does not support an image thumbnail",
            headers={"X-Error-Code": "source_thumbnail_unsupported"},
        )
    _, _, file_path = _resolve_local_source_file(db, source, current_user)
    try:
        if (
            file_path.stat().st_size <= 0
            or file_path.stat().st_size > MAX_SOURCE_IMAGE_FILE_SIZE
        ):
            raise ValueError("Source image is outside the supported size")
        thumbnail = render_image_thumbnail(file_path.read_bytes(), max_edge=480)
    except (OSError, ValueError) as error:
        raise HTTPException(
            status_code=422,
            detail="Source image thumbnail could not be generated",
            headers={"X-Error-Code": "source_thumbnail_unavailable"},
        ) from error
    return Response(
        content=thumbnail,
        media_type="image/jpeg",
        headers={
            "Cache-Control": "no-store",
            "Content-Disposition": 'inline; filename="source-thumbnail.jpg"',
            "X-Content-Type-Options": "nosniff",
        },
    )


@router.post(
    "/source-documents",
    response_model=HealthSourceDocumentResponse,
    status_code=status.HTTP_201_CREATED,
)
async def upload_source_document(
    *,
    request: Request,
    db: Session = Depends(deps.get_db),
    patient_id: int = Form(...),
    file: UploadFile = File(...),
    display_name: Optional[str] = Form(None),
    document_type: str = Form("other"),
    report_date: Optional[date] = Form(None),
    facility: Optional[str] = Form(None),
    allow_duplicate: bool = Form(False),
    source_upload_batch_id: Optional[int] = Form(None),
    source_upload_item_id: Optional[int] = Form(None),
    delegated_upload: Optional[str] = Form(None),
    delegated_upload_reason: Optional[str] = Form(None),
    current_user: User = Depends(deps.get_current_user),
) -> HealthSourceDocument:
    """Store an original document locally and retain verifiable provenance metadata."""

    delegated_context = _verify_archive_owner_access(
        patient_id,
        db,
        current_user,
        request=request,
        delegated_upload=delegated_upload,
        delegated_upload_reason=delegated_upload_reason,
        delegated_operation="upload_source_document",
    )
    if (source_upload_batch_id is None) != (source_upload_item_id is None):
        raise HTTPException(
            status_code=422,
            detail="Upload batch and item IDs must be provided together",
        )

    upload_batch: HealthSourceUploadBatch | None = None
    upload_item: HealthSourceUploadItem | None = None
    if source_upload_batch_id is not None and source_upload_item_id is not None:
        upload_batch, upload_item = health_source_upload_service.get_item_for_upload(
            db,
            patient_id=patient_id,
            batch_id=source_upload_batch_id,
            item_id=source_upload_item_id,
        )
        try:
            assert_delegated_batch_scope(upload_batch, delegated_context)
        except AdminDelegatedUploadError as error:
            _raise_delegated_upload_http(error)
        if upload_item.status == "uploaded" and upload_item.source_document_id:
            stored_source = (
                db.query(HealthSourceDocument)
                .filter(
                    HealthSourceDocument.id == upload_item.source_document_id,
                    HealthSourceDocument.patient_id == patient_id,
                )
                .first()
            )
            if stored_source is not None:
                return stored_source
        upload_item.attempt_count += 1
        upload_item.status = "pending"
        upload_item.last_error_code = None
        db.add(upload_item)
        db.commit()
        db.refresh(upload_item)

    sha256: str | None = None
    try:
        if document_type not in ALLOWED_DOCUMENT_TYPES:
            raise HTTPException(
                status_code=422,
                detail="Unsupported document type",
            )
        if upload_batch is not None:
            _validate_upload_batch_metadata(
                batch=upload_batch,
                document_type=document_type,
                report_date=report_date,
                facility=facility,
            )

        original_filename = _safe_original_filename(file.filename)
        mime_type = _resolved_source_mime_type(file, original_filename)
        extension = ALLOWED_SOURCE_MIME_TYPES[mime_type]
        file_size_limit = SOURCE_FILE_SIZE_LIMITS[mime_type]

        content = await file.read(file_size_limit + 1)
        if not content:
            raise HTTPException(
                status_code=422,
                detail="Source document is empty",
                headers={"X-Error-Code": "source_empty"},
            )
        if len(content) > file_size_limit:
            limit_mib = file_size_limit // (1024 * 1024)
            raise HTTPException(
                status_code=413,
                detail=f"Source document exceeds {limit_mib} MiB",
                headers={"X-Error-Code": "source_too_large"},
            )
        _validate_file_signature(content, mime_type)

        sha256 = hashlib.sha256(content).hexdigest()
        if upload_item is not None:
            _validate_upload_item_manifest(
                item=upload_item,
                original_filename=original_filename,
                mime_type=mime_type,
                size_bytes=len(content),
                actual_sha256=sha256,
            )

        clean_display_name = (display_name or Path(original_filename).stem).strip()
        if not clean_display_name or len(clean_display_name) > 255:
            raise HTTPException(
                status_code=422,
                detail="Invalid source document name",
            )
        clean_facility = facility.strip() if facility else None
        if clean_facility and len(clean_facility) > 255:
            raise HTTPException(
                status_code=422,
                detail="Facility name is too long",
            )
    except HTTPException as error:
        if upload_item is not None:
            health_source_upload_service.mark_item_failed(
                db,
                item=upload_item,
                error_code=_upload_error_code(error),
                actual_sha256=sha256,
            )
        raise
    except Exception as error:
        if upload_item is not None:
            health_source_upload_service.mark_item_failed(
                db,
                item=upload_item,
                error_code="source_read_failed",
                actual_sha256=sha256,
            )
        raise HTTPException(
            status_code=500,
            detail="Source document could not be read",
        ) from error

    duplicate = (
        db.query(HealthSourceDocument)
        .filter(
            HealthSourceDocument.patient_id == patient_id,
            HealthSourceDocument.sha256 == sha256,
        )
        .order_by(HealthSourceDocument.created_at.desc())
        .first()
    )
    if duplicate is not None and duplicate.status == "archived":
        if upload_item is not None:
            upload_item.status = "duplicate"
            upload_item.actual_sha256 = sha256
            upload_item.source_document_id = None
            upload_item.duplicate_source_document_id = duplicate.id
            upload_item.last_error_code = "withdrawn_source_document"
            db.commit()
        raise HTTPException(
            status_code=409,
            detail="Matching source document is withdrawn; restore it instead",
            headers={
                "X-Error-Code": "withdrawn_source_document",
                "X-Duplicate-Source-Document-ID": str(duplicate.id),
            },
        )
    if duplicate is not None and not allow_duplicate:
        if upload_item is not None:
            upload_item.status = "duplicate"
            upload_item.actual_sha256 = sha256
            upload_item.source_document_id = None
            upload_item.duplicate_source_document_id = duplicate.id
            upload_item.last_error_code = None
            db.add(
                ActivityLog.create_activity(
                    action="duplicate_detected",
                    entity_type="health_source_upload_item",
                    description="Matched an upload item to an existing source document",
                    user_id=current_user.id,
                    patient_id=patient_id,
                    entity_id=upload_item.id,
                    metadata={
                        "source_upload_batch_id": source_upload_batch_id,
                        "duplicate_source_document_id": duplicate.id,
                        **(
                            delegated_context.audit_metadata(result="completed")
                            if delegated_context is not None
                            else {}
                        ),
                    },
                    ip_address=request.client.host if request.client else None,
                )
            )
            db.commit()
        raise HTTPException(
            status_code=409,
            detail="Duplicate source document",
            headers={
                "X-Error-Code": "duplicate_source_document",
                "X-Duplicate-Source-Document-ID": str(duplicate.id),
            },
        )

    source = HealthSourceDocument(
        patient_id=patient_id,
        created_by_user_id=current_user.id,
        display_name=clean_display_name,
        original_filename=original_filename,
        document_type=document_type,
        report_date=report_date,
        facility=clean_facility,
        mime_type=mime_type,
        size_bytes=len(content),
        sha256=sha256,
        storage_backend="local",
        status="uploaded",
        duplicate_of_source_document_id=duplicate.id if duplicate else None,
    )
    db.add(source)
    db.flush()

    source_dir = Path(settings.UPLOAD_DIR) / "files" / "source-documents"
    source_dir.mkdir(parents=True, exist_ok=True)
    file_path = source_dir / f"{uuid.uuid4().hex}{extension}"
    try:
        with open(file_path, "wb") as stored_file:
            stored_file.write(content)
        entity_file = EntityFile(
            entity_type="source-document",
            entity_id=source.id,
            file_name=original_filename,
            file_path=str(file_path),
            file_type=mime_type,
            file_size=len(content),
            description="Original household health source document",
            category="source-document",
            uploaded_at=get_utc_now(),
            storage_backend="local",
            sync_status="synced",
        )
        db.add(entity_file)
        db.flush()
        source.primary_file_id = entity_file.id
        similarity_relations: list[HealthSourceSimilarityRelation] = []
        similarity_scan_status = (
            "not_applicable"
            if mime_type not in SUPPORTED_IMAGE_MIME_TYPES
            else "completed"
        )
        if mime_type in SUPPORTED_IMAGE_MIME_TYPES:
            try:
                with db.begin_nested():
                    similarity_relations = (
                        health_source_similarity_service.register_candidates(
                            db,
                            source=source,
                            content=content,
                        )
                    )
            except Exception:
                # Original preservation has priority over optional candidate hints.
                similarity_relations = []
                similarity_scan_status = "failed_closed"
        if upload_item is not None:
            upload_item.status = "uploaded"
            upload_item.actual_sha256 = sha256
            upload_item.source_document_id = source.id
            upload_item.duplicate_source_document_id = None
            upload_item.last_error_code = None
        db.add(
            ActivityLog.create_activity(
                action="uploaded",
                entity_type="health_source_document",
                description="Uploaded a household health source document",
                user_id=current_user.id,
                patient_id=patient_id,
                entity_id=source.id,
                metadata={
                    "size_bytes": len(content),
                    "mime_type": mime_type,
                    "duplicate_override": duplicate is not None,
                    "source_upload_batch_id": source_upload_batch_id,
                    "similarity_scan_status": similarity_scan_status,
                    "similarity_candidate_count": len(similarity_relations),
                    **(
                        delegated_context.audit_metadata(result="completed")
                        if delegated_context is not None
                        else {}
                    ),
                },
                ip_address=request.client.host if request.client else None,
            )
        )
        db.commit()
        db.refresh(source)
        return source
    except Exception:
        db.rollback()
        if file_path.exists():
            os.remove(file_path)
        if upload_item is not None:
            persisted_item = (
                db.query(HealthSourceUploadItem)
                .filter(HealthSourceUploadItem.id == upload_item.id)
                .first()
            )
            if persisted_item is not None:
                health_source_upload_service.mark_item_failed(
                    db,
                    item=persisted_item,
                    error_code="storage_failed",
                    actual_sha256=sha256,
                )
        raise


@router.get(
    "/patients/{patient_id}/source-documents",
    response_model=list[HealthSourceDocumentResponse],
)
def list_source_documents(
    *,
    request: Request,
    db: Session = Depends(deps.get_db),
    patient_id: int,
    include_archived: bool = Query(default=False),
    owner_access: Optional[str] = Query(default=None),
    owner_access_reason: Optional[str] = Query(default=None),
    current_user: User = Depends(deps.get_current_user),
):
    patient = db.query(Patient).filter(Patient.id == patient_id).first()
    if patient is None:
        raise HTTPException(status_code=404, detail="Patient not found")
    if patient.owner_user_id == current_user.id:
        _verify_archive_owner_access(patient_id, db, current_user)
    else:
        deps.verify_patient_read_access(
            patient_id,
            db,
            current_user,
            request=request,
            requested_owner_access=owner_access,
            owner_access_reason=owner_access_reason,
            resource="source_document_metadata",
            allow_standard_access=False,
        )
    return health_import_service.list_source_documents(
        db, patient_id, include_archived=include_archived
    )


@router.get("/source-documents/{source_document_id}/download")
def download_source_document(
    *,
    request: Request,
    db: Session = Depends(deps.get_db),
    source_document_id: int,
    owner_access: Optional[str] = Query(default=None),
    owner_access_reason: Optional[str] = Query(default=None),
    current_user: User = Depends(deps.get_current_user),
):
    """Download one retained original through an owner-only or audited path."""

    source = _get_source_document_or_404(db, source_document_id)
    patient, _, file_path = _resolve_local_source_file(db, source, current_user)

    if patient.owner_user_id == current_user.id:
        _verify_archive_owner_access(source.patient_id, db, current_user)
    else:
        deps.verify_patient_read_access(
            source.patient_id,
            db,
            current_user,
            request=request,
            requested_owner_access=owner_access,
            owner_access_reason=owner_access_reason,
            resource="source_document_download",
            allow_standard_access=False,
            source_document_id=source.id,
        )

    return FileResponse(
        path=file_path,
        filename=source.original_filename,
        media_type=source.mime_type,
        headers={
            "Cache-Control": "no-store",
            "Pragma": "no-cache",
            "X-Content-Type-Options": "nosniff",
        },
    )


@router.get("/source-documents/{source_document_id}/preview")
def preview_source_document(
    *,
    request: Request,
    db: Session = Depends(deps.get_db),
    source_document_id: int,
    owner_access: Optional[str] = Query(default=None),
    owner_access_reason: Optional[str] = Query(default=None),
    current_user: User = Depends(deps.get_current_user),
):
    """Preview a browser-safe retained original without duplicating the file."""

    source = _get_source_document_or_404(db, source_document_id)
    patient, entity_file, file_path = _resolve_local_source_file(
        db, source, current_user
    )
    source_mime_type = (source.mime_type or "").strip().lower()
    stored_mime_type = (entity_file.file_type or "").strip().lower()
    if (
        source_mime_type not in SOURCE_DOCUMENT_PREVIEW_MIME_TYPES
        or stored_mime_type != source_mime_type
    ):
        raise HTTPException(
            status_code=status.HTTP_415_UNSUPPORTED_MEDIA_TYPE,
            detail="Source format is not supported for browser preview",
        )

    if patient.owner_user_id == current_user.id:
        _verify_archive_owner_access(source.patient_id, db, current_user)
    else:
        deps.verify_patient_read_access(
            source.patient_id,
            db,
            current_user,
            request=request,
            requested_owner_access=owner_access,
            owner_access_reason=owner_access_reason,
            resource="source_document_preview",
            allow_standard_access=False,
            source_document_id=source.id,
        )

    return FileResponse(
        path=file_path,
        filename=source.original_filename,
        media_type=source_mime_type,
        content_disposition_type="inline",
        headers={
            "Cache-Control": "no-store",
            "Pragma": "no-cache",
            "X-Content-Type-Options": "nosniff",
            "Content-Security-Policy": (
                "sandbox; default-src 'none'; frame-ancestors 'self'"
            ),
        },
    )


@router.get(
    "/source-documents/{source_document_id}/dependencies",
    response_model=HealthSourceDocumentDependencySummary,
)
def get_source_document_dependencies(
    *,
    request: Request,
    db: Session = Depends(deps.get_db),
    source_document_id: int,
    delegated_upload: Optional[str] = Query(default=None),
    delegated_upload_reason: Optional[str] = Query(default=None),
    admin_action: Optional[str] = Query(default=None),
    admin_action_reason: Optional[str] = Query(default=None),
    current_user: User = Depends(deps.get_current_user),
):
    source = _get_source_document_or_404(db, source_document_id)
    dependency_capability = (
        OWNER_SOURCE_RESTORE_CAPABILITY
        if admin_action == OWNER_SOURCE_RESTORE_CAPABILITY
        else OWNER_SOURCE_WITHDRAW_CAPABILITY
    )
    delegated_context, _ = _verify_source_lifecycle_access(
        source,
        db,
        current_user,
        request=request,
        required_admin_capability=dependency_capability,
        admin_operation="inspect_source_dependencies",
        admin_action=admin_action,
        admin_action_reason=admin_action_reason,
        delegated_upload=delegated_upload,
        delegated_upload_reason=delegated_upload_reason,
        delegated_operation="get_source_dependencies",
    )
    try:
        assert_delegated_source_scope(source, delegated_context)
    except AdminDelegatedUploadError as error:
        _raise_delegated_upload_http(error)
    return health_import_service.get_source_document_dependencies(db, source)


@router.post(
    "/source-documents/{source_document_id}/withdraw",
    response_model=HealthSourceDocumentLifecycleResponse,
)
def withdraw_source_document(
    *,
    db: Session = Depends(deps.get_db),
    source_document_id: int,
    withdrawal: HealthSourceDocumentWithdraw,
    request: Request,
    delegated_upload: Optional[str] = Query(default=None),
    delegated_upload_reason: Optional[str] = Query(default=None),
    admin_action: Optional[str] = Query(default=None),
    admin_action_reason: Optional[str] = Query(default=None),
    current_user: User = Depends(deps.get_current_user),
):
    source = _get_source_document_or_404(db, source_document_id)
    delegated_context, admin_context = _verify_source_lifecycle_access(
        source,
        db,
        current_user,
        request=request,
        required_admin_capability=OWNER_SOURCE_WITHDRAW_CAPABILITY,
        admin_operation="withdraw_source_document",
        admin_action=admin_action,
        admin_action_reason=admin_action_reason,
        delegated_upload=delegated_upload,
        delegated_upload_reason=delegated_upload_reason,
        delegated_operation="withdraw_uploaded_source",
    )
    try:
        assert_delegated_source_scope(source, delegated_context)
    except AdminDelegatedUploadError as error:
        _raise_delegated_upload_http(error)
    dependencies = health_import_service.withdraw_source_document(
        db,
        source=source,
        current_user=current_user,
        reason=withdrawal.reason,
        ip_address=request.client.host if request.client else None,
        delegated_context=delegated_context,
        admin_context=admin_context,
    )
    return HealthSourceDocumentLifecycleResponse(
        document=source,
        dependencies=dependencies,
    )


@router.post(
    "/source-documents/{source_document_id}/restore",
    response_model=HealthSourceDocumentLifecycleResponse,
)
def restore_source_document(
    *,
    db: Session = Depends(deps.get_db),
    source_document_id: int,
    request: Request,
    delegated_upload: Optional[str] = Query(default=None),
    delegated_upload_reason: Optional[str] = Query(default=None),
    admin_action: Optional[str] = Query(default=None),
    admin_action_reason: Optional[str] = Query(default=None),
    current_user: User = Depends(deps.get_current_user),
):
    source = _get_source_document_or_404(db, source_document_id)
    delegated_context, admin_context = _verify_source_lifecycle_access(
        source,
        db,
        current_user,
        request=request,
        required_admin_capability=OWNER_SOURCE_RESTORE_CAPABILITY,
        admin_operation="restore_source_document",
        admin_action=admin_action,
        admin_action_reason=admin_action_reason,
        delegated_upload=delegated_upload,
        delegated_upload_reason=delegated_upload_reason,
        delegated_operation="restore_uploaded_source",
    )
    try:
        assert_delegated_source_scope(source, delegated_context)
    except AdminDelegatedUploadError as error:
        _raise_delegated_upload_http(error)
    dependencies = health_import_service.restore_source_document(
        db,
        source=source,
        current_user=current_user,
        ip_address=request.client.host if request.client else None,
        delegated_context=delegated_context,
        admin_context=admin_context,
    )
    return HealthSourceDocumentLifecycleResponse(
        document=source,
        dependencies=dependencies,
    )


@router.post(
    "/source-documents/{source_document_id}/parse-tasks",
    response_model=HealthSourceParseTaskResponse,
    status_code=status.HTTP_202_ACCEPTED,
)
def start_source_parse_task(
    *,
    background_tasks: BackgroundTasks,
    db: Session = Depends(deps.get_db),
    source_document_id: int,
    task_in: HealthSourceParseTaskStart,
    current_user: User = Depends(deps.get_current_user),
):
    source = _get_source_document_or_404(db, source_document_id)
    _verify_archive_owner_access(source.patient_id, db, current_user)
    task = health_source_parse_service.create_task(
        db,
        source=source,
        current_user=current_user,
        task_in=task_in,
    )
    _schedule_source_parse(background_tasks, db, task)
    return task


@router.get(
    "/patients/{patient_id}/parser-readiness",
    response_model=HealthParserReadinessResponse,
)
def get_source_parser_readiness(
    *,
    db: Session = Depends(deps.get_db),
    patient_id: int,
    current_user: User = Depends(deps.get_current_user),
):
    _verify_archive_owner_access(patient_id, db, current_user)
    return {
        **probe_local_parser_readiness(),
        "worker": health_source_parse_worker.status(),
        "checked_at": get_utc_now(),
    }


@router.get(
    "/patients/{patient_id}/parse-tasks",
    response_model=list[HealthSourceParseTaskResponse],
)
def list_source_parse_tasks(
    *,
    db: Session = Depends(deps.get_db),
    patient_id: int,
    current_user: User = Depends(deps.get_current_user),
):
    _verify_archive_owner_access(patient_id, db, current_user)
    return health_source_parse_service.list_tasks(db, patient_id)


@router.get(
    "/parse-tasks/{task_id}",
    response_model=HealthSourceParseTaskResponse,
)
def get_source_parse_task(
    *,
    db: Session = Depends(deps.get_db),
    task_id: int,
    current_user: User = Depends(deps.get_current_user),
):
    task = _get_source_parse_task_or_404(db, task_id)
    _verify_archive_owner_access(task.patient_id, db, current_user)
    return task


@router.post(
    "/parse-tasks/{task_id}/cancel",
    response_model=HealthSourceParseTaskResponse,
)
def cancel_source_parse_task(
    *,
    db: Session = Depends(deps.get_db),
    task_id: int,
    current_user: User = Depends(deps.get_current_user),
):
    task = _get_source_parse_task_or_404(db, task_id)
    _verify_archive_owner_access(task.patient_id, db, current_user)
    return health_source_parse_service.cancel_task(db, task)


@router.post(
    "/parse-tasks/{task_id}/retry",
    response_model=HealthSourceParseTaskResponse,
    status_code=status.HTTP_202_ACCEPTED,
)
def retry_source_parse_task(
    *,
    background_tasks: BackgroundTasks,
    db: Session = Depends(deps.get_db),
    task_id: int,
    current_user: User = Depends(deps.get_current_user),
):
    task = _get_source_parse_task_or_404(db, task_id)
    _verify_archive_owner_access(task.patient_id, db, current_user)
    retried = health_source_parse_service.retry_task(db, task)
    _schedule_source_parse(background_tasks, db, retried)
    return retried


@router.post(
    "/patients/{patient_id}/csv-preview",
    response_model=HealthCsvPreviewResponse,
)
async def preview_health_csv(
    *,
    db: Session = Depends(deps.get_db),
    patient_id: int,
    file: UploadFile = File(...),
    current_user: User = Depends(deps.get_current_user),
) -> HealthCsvPreviewResponse:
    """Parse a bounded fixed-template CSV without storing files or records."""

    _verify_archive_owner_access(patient_id, db, current_user)
    original_filename = _safe_original_filename(file.filename)
    if Path(original_filename).suffix.lower() != ".csv":
        raise HTTPException(status_code=415, detail="Only CSV files are supported")

    content = await file.read(MAX_CSV_FILE_SIZE + 1)
    if not content:
        raise HTTPException(status_code=422, detail="CSV file is empty")
    if len(content) > MAX_CSV_FILE_SIZE:
        raise HTTPException(status_code=413, detail="CSV file exceeds 2 MiB")

    try:
        preview = parse_health_csv(content)
    except ValueError as exc:
        if str(exc) == "unsupported_encoding":
            raise HTTPException(
                status_code=422,
                detail="CSV must use UTF-8 or GB18030 encoding",
            ) from exc
        raise HTTPException(status_code=422, detail="CSV parsing failed") from exc

    if any(error.code == "row_limit" for error in preview.errors):
        raise HTTPException(
            status_code=422,
            detail=f"CSV contains more than {MAX_CSV_ROWS} non-empty rows",
        )
    return preview


@router.post(
    "/patients/{patient_id}/batches",
    response_model=HealthImportBatchResponse,
    status_code=status.HTTP_201_CREATED,
)
def create_import_batch(
    *,
    db: Session = Depends(deps.get_db),
    patient_id: int,
    batch_in: HealthImportBatchCreate,
    current_user: User = Depends(deps.get_current_user),
):
    _verify_archive_owner_access(patient_id, db, current_user)
    return health_import_service.create_batch(
        db,
        patient_id=patient_id,
        current_user=current_user,
        batch_in=batch_in,
    )


@router.get(
    "/patients/{patient_id}/batches",
    response_model=list[HealthImportBatchResponse],
)
def list_import_batches(
    *,
    db: Session = Depends(deps.get_db),
    patient_id: int,
    current_user: User = Depends(deps.get_current_user),
):
    _verify_archive_owner_access(patient_id, db, current_user)
    return health_import_service.list_batches(db, patient_id)


@router.get("/batches/{batch_id}", response_model=HealthImportBatchResponse)
def get_import_batch(
    *,
    db: Session = Depends(deps.get_db),
    batch_id: int,
    current_user: User = Depends(deps.get_current_user),
):
    batch = _get_batch_or_404(db, batch_id)
    _verify_archive_owner_access(batch.patient_id, db, current_user)
    return batch


@router.put("/batches/{batch_id}/review", response_model=HealthImportBatchResponse)
def review_import_batch(
    *,
    db: Session = Depends(deps.get_db),
    batch_id: int,
    review_in: HealthImportBatchReview,
    current_user: User = Depends(deps.get_current_user),
):
    batch = _get_batch_or_404(db, batch_id)
    _verify_archive_owner_access(batch.patient_id, db, current_user)
    return health_import_service.review_batch(
        db, batch=batch, current_user=current_user, review_in=review_in
    )


@router.post("/batches/{batch_id}/commit", response_model=HealthImportCommitResponse)
def commit_import_batch(
    *,
    db: Session = Depends(deps.get_db),
    batch_id: int,
    commit_in: HealthImportCommitRequest = Body(
        default_factory=HealthImportCommitRequest
    ),
    current_user: User = Depends(deps.get_current_user),
):
    batch = _get_batch_or_404(db, batch_id)
    _verify_archive_owner_access(batch.patient_id, db, current_user)
    committed, lab_result_ids, component_ids = health_import_service.commit_batch(
        db,
        batch=batch,
        current_user=current_user,
        subject_mismatch_confirmation=commit_in.subject_mismatch_confirmation,
    )
    return HealthImportCommitResponse(
        batch=committed,
        created_lab_result_ids=lab_result_ids,
        created_component_ids=component_ids,
    )


@router.post(
    "/batches/{batch_id}/rollback", response_model=HealthImportRollbackResponse
)
def rollback_import_batch(
    *,
    db: Session = Depends(deps.get_db),
    batch_id: int,
    current_user: User = Depends(deps.get_current_user),
):
    batch = _get_batch_or_404(db, batch_id)
    _verify_archive_owner_access(batch.patient_id, db, current_user)
    rolled_back, lab_result_ids, component_ids = health_import_service.rollback_batch(
        db, batch=batch, current_user=current_user
    )
    return HealthImportRollbackResponse(
        batch=rolled_back,
        deleted_lab_result_ids=lab_result_ids,
        deleted_component_ids=component_ids,
    )


@router.get(
    "/components/{component_id}/revisions",
    response_model=HealthFormalMetricRevisionHistoryResponse,
)
def list_formal_metric_revisions(
    *,
    db: Session = Depends(deps.get_db),
    component_id: int,
    current_user: User = Depends(deps.get_current_user),
):
    component, lab_result = _get_formal_component_or_404(db, component_id)
    _verify_archive_owner_access(lab_result.patient_id, db, current_user)
    return health_formal_metric_revision_service.build_history(
        db,
        component=component,
        current_user=current_user,
    )


@router.post(
    "/components/{component_id}/revisions",
    response_model=HealthFormalMetricRevisionHistoryResponse,
)
def revise_formal_metric(
    *,
    request: Request,
    db: Session = Depends(deps.get_db),
    component_id: int,
    revision_in: HealthFormalMetricRevisionCreate,
    current_user: User = Depends(deps.get_current_user),
):
    _, lab_result = _get_formal_component_or_404(db, component_id)
    _verify_archive_owner_access(lab_result.patient_id, db, current_user)
    return health_formal_metric_revision_service.revise(
        db,
        component_id=component_id,
        current_user=current_user,
        revision_in=revision_in,
        ip_address=request.client.host if request.client else None,
    )
