import hashlib
import json

from fastapi import HTTPException
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session, joinedload

from app.models.activity_log import ActivityLog
from app.models.base import get_utc_now
from app.models.health_imports import HealthSourceUploadBatch, HealthSourceUploadItem
from app.models.user import User
from app.schemas.health_imports import HealthSourceUploadBatchCreate
from app.services.admin_delegated_upload_service import (
    AdminDelegatedUploadContext,
)


class HealthSourceUploadService:
    """Persist and recover the lifecycle of a multi-file original upload."""

    def get_batch(
        self,
        db: Session,
        batch_id: int,
    ) -> HealthSourceUploadBatch | None:
        return (
            db.query(HealthSourceUploadBatch)
            .options(joinedload(HealthSourceUploadBatch.items))
            .filter(HealthSourceUploadBatch.id == batch_id)
            .first()
        )

    def list_batches(
        self,
        db: Session,
        patient_id: int,
        *,
        unfinished_only: bool = False,
        limit: int = 50,
        created_by_user_id: int | None = None,
    ) -> list[HealthSourceUploadBatch]:
        query = (
            db.query(HealthSourceUploadBatch)
            .options(joinedload(HealthSourceUploadBatch.items))
            .filter(HealthSourceUploadBatch.patient_id == patient_id)
            .order_by(HealthSourceUploadBatch.created_at.desc())
        )
        if unfinished_only:
            query = query.filter(
                HealthSourceUploadBatch.status.in_(("open", "partial"))
            )
        if created_by_user_id is not None:
            query = query.filter(
                HealthSourceUploadBatch.created_by_user_id == created_by_user_id
            )
        return query.limit(limit).all()

    def create_batch(
        self,
        db: Session,
        *,
        patient_id: int,
        current_user: User,
        batch_in: HealthSourceUploadBatchCreate,
        ip_address: str | None = None,
        delegated_context: AdminDelegatedUploadContext | None = None,
    ) -> tuple[HealthSourceUploadBatch, bool]:
        manifest_sha256 = self._manifest_sha256(batch_in)
        existing = self._get_by_idempotency_key(
            db,
            patient_id=patient_id,
            idempotency_key=batch_in.idempotency_key,
        )
        if existing is not None:
            self._assert_same_manifest(existing, manifest_sha256)
            return existing, False

        batch = HealthSourceUploadBatch(
            patient_id=patient_id,
            created_by_user_id=current_user.id,
            idempotency_key=batch_in.idempotency_key,
            manifest_sha256=manifest_sha256,
            document_type=batch_in.document_type,
            report_date=batch_in.report_date,
            facility=batch_in.facility,
            status="open",
            expected_file_count=len(batch_in.documents),
            expected_total_bytes=sum(
                document.size_bytes for document in batch_in.documents
            ),
        )
        for document in sorted(batch_in.documents, key=lambda item: item.sequence):
            batch.items.append(
                HealthSourceUploadItem(
                    client_item_id=document.client_item_id,
                    sequence=document.sequence,
                    original_filename=document.original_filename,
                    mime_type=document.mime_type,
                    size_bytes=document.size_bytes,
                    client_sha256=document.client_sha256,
                    status="pending",
                    attempt_count=0,
                )
            )
        try:
            db.add(batch)
            db.flush()
            db.add(
                ActivityLog.create_activity(
                    action="created",
                    entity_type="health_source_upload_batch",
                    description="Created a household health source upload batch",
                    user_id=current_user.id,
                    patient_id=patient_id,
                    entity_id=batch.id,
                    metadata={
                        "expected_file_count": batch.expected_file_count,
                        "expected_total_bytes": batch.expected_total_bytes,
                        **(
                            delegated_context.audit_metadata(result="completed")
                            if delegated_context is not None
                            else {}
                        ),
                    },
                    ip_address=ip_address,
                )
            )
            db.commit()
        except IntegrityError:
            db.rollback()
            existing = self._get_by_idempotency_key(
                db,
                patient_id=patient_id,
                idempotency_key=batch_in.idempotency_key,
            )
            if existing is None:
                raise
            self._assert_same_manifest(existing, manifest_sha256)
            return existing, False
        return self.get_batch(db, batch.id), True

    def get_item_for_upload(
        self,
        db: Session,
        *,
        patient_id: int,
        batch_id: int,
        item_id: int,
    ) -> tuple[HealthSourceUploadBatch, HealthSourceUploadItem]:
        batch = self.get_batch(db, batch_id)
        if batch is None or batch.patient_id != patient_id:
            raise HTTPException(status_code=404, detail="Source upload batch not found")
        if batch.status not in {"open", "partial"}:
            raise HTTPException(
                status_code=409,
                detail="Source upload batch is closed",
                headers={"X-Error-Code": "upload_batch_closed"},
            )
        item = next(
            (candidate for candidate in batch.items if candidate.id == item_id), None
        )
        if item is None:
            raise HTTPException(status_code=404, detail="Source upload item not found")
        if item.status == "uploaded":
            return batch, item
        if item.status == "duplicate":
            raise HTTPException(
                status_code=409,
                detail="Duplicate source document",
                headers={
                    "X-Error-Code": "duplicate_source_document",
                    "X-Duplicate-Source-Document-ID": str(
                        item.duplicate_source_document_id
                    ),
                },
            )
        if item.status not in {"pending", "failed"}:
            raise HTTPException(
                status_code=409,
                detail="Source upload item cannot be retried",
                headers={"X-Error-Code": "upload_item_closed"},
            )
        return batch, item

    def complete_batch(
        self,
        db: Session,
        batch: HealthSourceUploadBatch,
        *,
        current_user: User,
        ip_address: str | None = None,
        delegated_context: AdminDelegatedUploadContext | None = None,
    ) -> HealthSourceUploadBatch:
        if batch.status == "cancelled":
            raise HTTPException(
                status_code=409,
                detail="Cancelled upload batch cannot be completed",
                headers={"X-Error-Code": "upload_batch_closed"},
            )
        if batch.status == "completed":
            return batch
        if any(item.status == "pending" for item in batch.items):
            raise HTTPException(
                status_code=409,
                detail="Upload batch still contains pending files",
                headers={"X-Error-Code": "upload_batch_incomplete"},
            )

        if any(item.status == "failed" for item in batch.items):
            batch.status = "partial"
            batch.completed_at = None
        else:
            batch.status = "completed"
            batch.completed_at = get_utc_now()
        db.add(batch)
        db.add(
            ActivityLog.create_activity(
                action="completed",
                entity_type="health_source_upload_batch",
                description="Completed a household health source upload batch",
                user_id=current_user.id,
                patient_id=batch.patient_id,
                entity_id=batch.id,
                metadata={
                    "status": batch.status,
                    **(
                        delegated_context.audit_metadata(result="completed")
                        if delegated_context is not None
                        else {}
                    ),
                },
                ip_address=ip_address,
            )
        )
        db.commit()
        return self.get_batch(db, batch.id)

    def cancel_batch(
        self,
        db: Session,
        batch: HealthSourceUploadBatch,
        *,
        current_user: User,
        ip_address: str | None = None,
        delegated_context: AdminDelegatedUploadContext | None = None,
    ) -> HealthSourceUploadBatch:
        if batch.status == "completed":
            raise HTTPException(
                status_code=409,
                detail="Completed upload batch cannot be cancelled",
                headers={"X-Error-Code": "upload_batch_closed"},
            )
        if batch.status == "cancelled":
            return batch

        for item in batch.items:
            if item.status in {"pending", "failed"}:
                item.status = "cancelled"
                item.last_error_code = None
        batch.status = "cancelled"
        batch.cancelled_at = get_utc_now()
        db.add(batch)
        db.add(
            ActivityLog.create_activity(
                action="cancelled",
                entity_type="health_source_upload_batch",
                description="Cancelled a household health source upload batch",
                user_id=current_user.id,
                patient_id=batch.patient_id,
                entity_id=batch.id,
                metadata={
                    "preserved_file_count": sum(
                        item.status in {"uploaded", "duplicate"} for item in batch.items
                    ),
                    **(
                        delegated_context.audit_metadata(result="completed")
                        if delegated_context is not None
                        else {}
                    ),
                },
                ip_address=ip_address,
            )
        )
        db.commit()
        return self.get_batch(db, batch.id)

    @staticmethod
    def mark_item_failed(
        db: Session,
        *,
        item: HealthSourceUploadItem,
        error_code: str,
        actual_sha256: str | None = None,
    ) -> None:
        item.status = "failed"
        item.last_error_code = error_code[:50]
        item.actual_sha256 = actual_sha256
        db.add(item)
        db.commit()

    @staticmethod
    def _manifest_sha256(batch_in: HealthSourceUploadBatchCreate) -> str:
        payload = batch_in.model_dump(mode="json", exclude={"idempotency_key"})
        payload["documents"] = [
            item.model_dump(mode="json")
            for item in sorted(batch_in.documents, key=lambda item: item.sequence)
        ]
        canonical = json.dumps(
            payload,
            ensure_ascii=False,
            separators=(",", ":"),
            sort_keys=True,
        )
        return hashlib.sha256(canonical.encode("utf-8")).hexdigest()

    @staticmethod
    def _assert_same_manifest(
        batch: HealthSourceUploadBatch,
        manifest_sha256: str,
    ) -> None:
        if batch.manifest_sha256 != manifest_sha256:
            raise HTTPException(
                status_code=409,
                detail="Idempotency key was already used for a different manifest",
                headers={"X-Error-Code": "upload_batch_manifest_conflict"},
            )

    @staticmethod
    def _get_by_idempotency_key(
        db: Session,
        *,
        patient_id: int,
        idempotency_key: str,
    ) -> HealthSourceUploadBatch | None:
        return (
            db.query(HealthSourceUploadBatch)
            .options(joinedload(HealthSourceUploadBatch.items))
            .filter(
                HealthSourceUploadBatch.patient_id == patient_id,
                HealthSourceUploadBatch.idempotency_key == idempotency_key,
            )
            .first()
        )


health_source_upload_service = HealthSourceUploadService()
