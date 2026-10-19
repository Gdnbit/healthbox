import hashlib
import json
import math
from collections import Counter
from datetime import date

from fastapi import HTTPException, status
from sqlalchemy import func
from sqlalchemy.orm import Session, joinedload

from app.models.activity_log import ActivityLog
from app.models.base import get_utc_now
from app.models.health_background import HealthBackgroundEntry
from app.models.health_coverage import HealthCoverageStatement
from app.models.health_imports import (
    HealthFormalMetricRevision,
    HealthImportBatch,
    HealthImportItem,
    HealthSourceDocument,
)
from app.models.labs import LabResult, LabTestComponent
from app.models.user import User
from app.schemas.health_imports import (
    CandidateObservation,
    HealthImportBatchCreate,
    HealthImportBatchReview,
    HealthImportSubjectMismatchConfirmation,
    HealthSourceDocumentDependencySummary,
)
from app.services.admin_delegated_upload_service import (
    AdminDelegatedUploadContext,
)
from app.services.admin_cross_subject_action_service import (
    AdminCrossSubjectActionContext,
)
from app.services.health_candidate_rules import candidate_validation_issues
from app.services.health_subject_identity_service import SubjectIdentityAssessment
from app.services.health_formal_metric_revision_service import (
    health_formal_metric_revision_service,
)


def _normalize_text(value: str | None) -> str:
    return " ".join((value or "").strip().lower().split())


def _candidate_result_key(candidate: CandidateObservation | HealthImportItem) -> str:
    result_type = candidate.result_type or "quantitative"
    if result_type == "quantitative":
        value = candidate.numeric_value
        return "" if value is None else format(float(value), ".12g")
    if result_type == "qualitative":
        return _normalize_text(candidate.qualitative_value)
    return _normalize_text(candidate.textual_value)


def _component_result_key(component: LabTestComponent) -> str:
    result_type = component.result_type or "quantitative"
    if result_type == "quantitative":
        return "" if component.value is None else format(float(component.value), ".12g")
    if result_type == "qualitative":
        return _normalize_text(component.qualitative_value)
    return _normalize_text(component.textual_value)


def _optional_float_equal(left: float | None, right: float | None) -> bool:
    if left is None or right is None:
        return left is None and right is None
    return math.isclose(float(left), float(right), rel_tol=1e-12, abs_tol=1e-12)


def _candidate_key(candidate: CandidateObservation | HealthImportItem) -> tuple:
    observed_date = candidate.observed_date
    metric_name = candidate.canonical_test_name or candidate.test_name
    return (
        observed_date.isoformat() if observed_date else "",
        _normalize_text(metric_name),
        _normalize_text(candidate.unit),
        candidate.result_type or "quantitative",
        _candidate_result_key(candidate),
    )


class HealthImportService:
    """Review-first import workflow. Parsers never write official records directly."""

    def get_source_document(
        self, db: Session, source_document_id: int
    ) -> HealthSourceDocument | None:
        return (
            db.query(HealthSourceDocument)
            .filter(HealthSourceDocument.id == source_document_id)
            .first()
        )

    def list_source_documents(
        self, db: Session, patient_id: int, *, include_archived: bool = False
    ) -> list[HealthSourceDocument]:
        query = db.query(HealthSourceDocument).filter(
            HealthSourceDocument.patient_id == patient_id
        )
        if not include_archived:
            query = query.filter(HealthSourceDocument.status != "archived")
        return query.order_by(
            HealthSourceDocument.report_date.desc(),
            HealthSourceDocument.created_at.desc(),
        ).all()

    def get_source_document_dependencies(
        self, db: Session, source: HealthSourceDocument
    ) -> HealthSourceDocumentDependencySummary:
        batch_counts = dict(
            db.query(HealthImportBatch.status, func.count(HealthImportBatch.id))
            .filter(HealthImportBatch.source_document_id == source.id)
            .group_by(HealthImportBatch.status)
            .all()
        )
        import_batches_total = sum(batch_counts.values())
        import_batches_committed = batch_counts.get("committed", 0)
        import_batches_open = sum(
            batch_counts.get(batch_status, 0)
            for batch_status in ("pending_review", "reviewed")
        )
        formal_lab_components = (
            db.query(func.count(LabTestComponent.id))
            .filter(LabTestComponent.source_document_id == source.id)
            .scalar()
            or 0
        )
        health_background_entries = (
            db.query(func.count(HealthBackgroundEntry.id))
            .filter(HealthBackgroundEntry.source_document_id == source.id)
            .scalar()
            or 0
        )
        health_coverage_statements = (
            db.query(func.count(HealthCoverageStatement.id))
            .filter(HealthCoverageStatement.source_document_id == source.id)
            .scalar()
            or 0
        )
        duplicate_documents = (
            db.query(func.count(HealthSourceDocument.id))
            .filter(HealthSourceDocument.duplicate_of_source_document_id == source.id)
            .scalar()
            or 0
        )
        return HealthSourceDocumentDependencySummary(
            source_document_id=source.id,
            import_batches_total=import_batches_total,
            import_batches_open=import_batches_open,
            import_batches_committed=import_batches_committed,
            formal_lab_components=formal_lab_components,
            health_background_entries=health_background_entries,
            health_coverage_statements=health_coverage_statements,
            duplicate_documents=duplicate_documents,
            has_derived_data=any(
                (
                    import_batches_total,
                    formal_lab_components,
                    health_background_entries,
                    health_coverage_statements,
                )
            ),
        )

    def withdraw_source_document(
        self,
        db: Session,
        *,
        source: HealthSourceDocument,
        current_user: User,
        reason: str | None = None,
        ip_address: str | None = None,
        delegated_context: AdminDelegatedUploadContext | None = None,
        admin_context: AdminCrossSubjectActionContext | None = None,
    ) -> HealthSourceDocumentDependencySummary:
        dependencies = self.get_source_document_dependencies(db, source)
        if source.status == "archived":
            return dependencies

        previous_status = source.status
        source.withdrawal_previous_status = source.status
        source.status = "archived"
        source.withdrawn_at = get_utc_now()
        source.withdrawn_by_user_id = current_user.id
        source.withdrawal_reason = reason
        db.add(
            ActivityLog.create_activity(
                action="withdrawn",
                entity_type="health_source_document",
                description="Withdrew a household health source document",
                user_id=current_user.id,
                patient_id=source.patient_id,
                entity_id=source.id,
                metadata={
                    "reason_recorded": reason is not None,
                    **dependencies.model_dump(exclude={"source_document_id"}),
                    **(
                        delegated_context.audit_metadata(result="completed")
                        if delegated_context is not None
                        else {}
                    ),
                    **(
                        admin_context.audit_metadata(
                            result="completed",
                            previous_status=previous_status,
                            resulting_status=source.status,
                        )
                        if admin_context is not None
                        else {}
                    ),
                },
                ip_address=ip_address,
            )
        )
        db.commit()
        db.refresh(source)
        return dependencies

    def restore_source_document(
        self,
        db: Session,
        *,
        source: HealthSourceDocument,
        current_user: User,
        ip_address: str | None = None,
        delegated_context: AdminDelegatedUploadContext | None = None,
        admin_context: AdminCrossSubjectActionContext | None = None,
    ) -> HealthSourceDocumentDependencySummary:
        dependencies = self.get_source_document_dependencies(db, source)
        if source.status != "archived":
            return dependencies

        previous_status = source.status
        restored_status = source.withdrawal_previous_status
        source.status = (
            restored_status
            if restored_status and restored_status != "archived"
            else "uploaded"
        )
        source.withdrawn_at = None
        source.withdrawn_by_user_id = None
        source.withdrawal_reason = None
        source.withdrawal_previous_status = None
        db.add(
            ActivityLog.create_activity(
                action="restored",
                entity_type="health_source_document",
                description="Restored a household health source document",
                user_id=current_user.id,
                patient_id=source.patient_id,
                entity_id=source.id,
                metadata={
                    **dependencies.model_dump(exclude={"source_document_id"}),
                    **(
                        delegated_context.audit_metadata(result="completed")
                        if delegated_context is not None
                        else {}
                    ),
                    **(
                        admin_context.audit_metadata(
                            result="completed",
                            previous_status=previous_status,
                            resulting_status=source.status,
                        )
                        if admin_context is not None
                        else {}
                    ),
                },
                ip_address=ip_address,
            )
        )
        db.commit()
        db.refresh(source)
        return dependencies

    def get_batch(self, db: Session, batch_id: int) -> HealthImportBatch | None:
        return (
            db.query(HealthImportBatch)
            .options(joinedload(HealthImportBatch.items))
            .filter(HealthImportBatch.id == batch_id)
            .first()
        )

    def list_batches(self, db: Session, patient_id: int) -> list[HealthImportBatch]:
        return (
            db.query(HealthImportBatch)
            .options(joinedload(HealthImportBatch.items))
            .filter(HealthImportBatch.patient_id == patient_id)
            .order_by(HealthImportBatch.created_at.desc())
            .all()
        )

    def create_batch(
        self,
        db: Session,
        *,
        patient_id: int,
        current_user: User,
        batch_in: HealthImportBatchCreate,
        subject_identity: SubjectIdentityAssessment | None = None,
    ) -> HealthImportBatch:
        source = self.get_source_document(db, batch_in.source_document_id)
        if source is None or source.patient_id != patient_id:
            raise HTTPException(status_code=404, detail="Source document not found")
        if source.status == "archived":
            raise HTTPException(
                status_code=409, detail="Source document is not available for import"
            )

        idempotency_key = batch_in.idempotency_key or self._build_idempotency_key(
            batch_in
        )
        existing = (
            db.query(HealthImportBatch)
            .options(joinedload(HealthImportBatch.items))
            .filter(
                HealthImportBatch.patient_id == patient_id,
                HealthImportBatch.idempotency_key == idempotency_key,
            )
            .first()
        )
        if existing is not None:
            return existing

        batch = HealthImportBatch(
            patient_id=patient_id,
            source_document_id=source.id,
            created_by_user_id=current_user.id,
            idempotency_key=idempotency_key,
            parser_name=batch_in.parser_name,
            parser_version=batch_in.parser_version,
            status="pending_review",
            summary={},
            subject_identity_status=(
                subject_identity.status if subject_identity else "unavailable"
            ),
            subject_identity_observed_name=(
                subject_identity.observed_name if subject_identity else None
            ),
            subject_identity_confidence=(
                subject_identity.confidence if subject_identity else None
            ),
            subject_identity_assessment_version=(
                subject_identity.assessment_version if subject_identity else None
            ),
            subject_identity_evidence=(
                subject_identity.evidence if subject_identity else None
            ),
        )
        db.add(batch)
        db.flush()

        seen_keys: dict[tuple, int] = {}
        for sequence, candidate in enumerate(batch_in.candidates, start=1):
            duplicate_component = self._find_existing_duplicate(
                db, patient_id=patient_id, candidate=candidate
            )
            candidate_key = _candidate_key(candidate)
            duplicate_reason = None
            decision = "pending"
            if duplicate_component is not None:
                decision = "duplicate"
                duplicate_reason = "existing_component"
            elif candidate_key in seen_keys:
                decision = "duplicate"
                duplicate_reason = f"same_batch_sequence:{seen_keys[candidate_key]}"

            item = HealthImportItem(
                batch=batch,
                sequence=sequence,
                **candidate.model_dump(),
                decision=decision,
                duplicate_of_component_id=(
                    duplicate_component.id if duplicate_component is not None else None
                ),
                duplicate_reason=duplicate_reason,
                validation_issues=candidate_validation_issues(candidate),
            )
            db.add(item)
            seen_keys.setdefault(candidate_key, sequence)

        db.flush()
        self._refresh_summary(batch)
        self._add_activity(
            db,
            action="created",
            description="Created a health import review batch",
            user_id=current_user.id,
            patient_id=patient_id,
            entity_id=batch.id,
            metadata={"candidate_count": len(batch_in.candidates)},
        )
        db.commit()
        return self._reload_batch(db, batch.id)

    def review_batch(
        self,
        db: Session,
        *,
        batch: HealthImportBatch,
        current_user: User,
        review_in: HealthImportBatchReview,
    ) -> HealthImportBatch:
        if batch.status not in {"pending_review", "reviewed"}:
            raise HTTPException(
                status_code=409,
                detail="Only pending or reviewed batches can be changed",
            )

        items_by_id = {item.id: item for item in batch.items}
        if len({item.item_id for item in review_in.items}) != len(review_in.items):
            raise HTTPException(
                status_code=422, detail="Review item IDs must be unique"
            )

        for review in review_in.items:
            item = items_by_id.get(review.item_id)
            if item is None:
                raise HTTPException(status_code=404, detail="Import item not found")

            if review.candidate is not None:
                for field, value in review.candidate.model_dump().items():
                    setattr(item, field, value)
                item.validation_issues = candidate_validation_issues(review.candidate)

            duplicate_component = self._find_existing_duplicate(
                db, patient_id=batch.patient_id, candidate=item
            )
            duplicate_reason = None
            item.duplicate_of_component_id = None
            if duplicate_component is not None:
                duplicate_reason = "existing_component"
                item.duplicate_of_component_id = duplicate_component.id
            else:
                same_batch_duplicate = next(
                    (
                        other
                        for other in sorted(
                            batch.items, key=lambda candidate: candidate.sequence
                        )
                        if other.id != item.id
                        and _candidate_key(other) == _candidate_key(item)
                    ),
                    None,
                )
                if same_batch_duplicate is not None:
                    duplicate_reason = (
                        f"same_batch_sequence:{same_batch_duplicate.sequence}"
                    )

            if review.decision == "accepted" and duplicate_reason:
                if not review.duplicate_override_reason:
                    raise HTTPException(
                        status_code=409,
                        detail="Accepting a duplicate requires an override reason",
                    )
                item.duplicate_override_reason = review.duplicate_override_reason
            elif review.decision == "accepted":
                item.duplicate_override_reason = None

            item.decision = review.decision
            item.duplicate_reason = duplicate_reason
            item.review_notes = review.review_notes

        if all(item.decision != "pending" for item in batch.items):
            batch.status = "reviewed"
            batch.reviewed_at = get_utc_now()
        else:
            batch.status = "pending_review"
            batch.reviewed_at = None

        self._refresh_summary(batch)
        self._add_activity(
            db,
            action="updated",
            description="Reviewed health import candidates",
            user_id=current_user.id,
            patient_id=batch.patient_id,
            entity_id=batch.id,
            metadata={"reviewed_count": len(review_in.items)},
        )
        db.commit()
        return self._reload_batch(db, batch.id)

    def commit_batch(
        self,
        db: Session,
        *,
        batch: HealthImportBatch,
        current_user: User,
        subject_mismatch_confirmation: (
            HealthImportSubjectMismatchConfirmation | None
        ) = None,
    ) -> tuple[HealthImportBatch, list[int], list[int]]:
        if batch.status == "committed":
            return (
                batch,
                sorted(
                    {
                        item.created_lab_result_id
                        for item in batch.items
                        if item.created_lab_result_id is not None
                    }
                ),
                sorted(
                    item.created_component_id
                    for item in batch.items
                    if item.created_component_id is not None
                ),
            )
        if batch.status != "reviewed":
            raise HTTPException(status_code=409, detail="Batch must be reviewed first")

        accepted_items = [item for item in batch.items if item.decision == "accepted"]
        if not accepted_items:
            raise HTTPException(status_code=409, detail="Batch has no accepted items")

        source = batch.source_document or self.get_source_document(
            db, batch.source_document_id
        )
        if source is None:
            raise HTTPException(status_code=409, detail="Source document is missing")

        self._confirm_subject_mismatch_for_commit(
            db,
            batch=batch,
            current_user=current_user,
            confirmation=subject_mismatch_confirmation,
        )

        lab_results_by_date: dict[date | None, LabResult] = {}
        for item in accepted_items:
            parent = lab_results_by_date.get(item.observed_date)
            if parent is None:
                parent = LabResult(
                    patient_id=batch.patient_id,
                    test_name=source.display_name,
                    test_category=(
                        "imaging" if source.document_type == "imaging" else "other"
                    ),
                    test_type=(
                        "screening" if source.document_type == "checkup" else "routine"
                    ),
                    facility=source.facility,
                    status="completed",
                    completed_date=item.observed_date,
                    notes=(
                        f"Imported from source document #{source.id} "
                        f"through review batch #{batch.id}."
                    ),
                    is_panel=True,
                    tags=[
                        f"source-document:{source.id}",
                        f"import-batch:{batch.id}",
                    ],
                    created_at=get_utc_now(),
                    updated_at=get_utc_now(),
                )
                db.add(parent)
                db.flush()
                lab_results_by_date[item.observed_date] = parent

            component = LabTestComponent(
                lab_result_id=parent.id,
                test_name=item.test_name,
                test_code=item.test_code,
                result_type=item.result_type,
                value=item.numeric_value,
                qualitative_value=item.qualitative_value,
                textual_value=item.textual_value,
                unit=item.unit,
                ref_range_min=item.ref_range_min,
                ref_range_max=item.ref_range_max,
                ref_range_text=item.ref_range_text,
                status=item.result_status,
                category=item.category,
                display_order=item.sequence,
                canonical_test_name=item.canonical_test_name,
                source_document_id=source.id,
                source_page=item.source_page,
                source_locator=item.source_locator,
                import_batch_id=batch.id,
            )
            db.add(component)
            db.flush()
            health_formal_metric_revision_service.ensure_initial_revision(
                db,
                component=component,
                patient_id=batch.patient_id,
                current_user=current_user,
            )
            item.created_lab_result_id = parent.id
            item.created_component_id = component.id

        batch.status = "committed"
        batch.committed_at = get_utc_now()
        self._refresh_summary(batch)
        created_lab_result_ids = sorted(
            parent.id for parent in lab_results_by_date.values()
        )
        created_component_ids = sorted(
            item.created_component_id
            for item in accepted_items
            if item.created_component_id is not None
        )
        self._add_activity(
            db,
            action="completed",
            description="Committed a reviewed health import batch",
            user_id=current_user.id,
            patient_id=batch.patient_id,
            entity_id=batch.id,
            metadata={
                "lab_result_count": len(created_lab_result_ids),
                "component_count": len(created_component_ids),
            },
        )
        db.commit()
        return (
            self._reload_batch(db, batch.id),
            created_lab_result_ids,
            created_component_ids,
        )

    def _confirm_subject_mismatch_for_commit(
        self,
        db: Session,
        *,
        batch: HealthImportBatch,
        current_user: User,
        confirmation: HealthImportSubjectMismatchConfirmation | None,
    ) -> None:
        mismatch = batch.subject_identity_status == "suspected_mismatch"
        if not mismatch:
            if confirmation is not None:
                raise HTTPException(
                    status_code=status.HTTP_409_CONFLICT,
                    detail={"code": "subject_mismatch_confirmation_invalid"},
                    headers={"X-Error-Code": "subject_mismatch_confirmation_invalid"},
                )
            return

        if batch.subject_mismatch_confirmed_at is not None:
            return
        if confirmation is None:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail={
                    "code": "subject_mismatch_confirmation_required",
                    "batch_id": batch.id,
                },
                headers={"X-Error-Code": "subject_mismatch_confirmation_required"},
            )
        valid = (
            confirmation.acknowledged is True
            and confirmation.target_patient_id == batch.patient_id
            and confirmation.observed_name == batch.subject_identity_observed_name
            and confirmation.assessment_version
            == batch.subject_identity_assessment_version
        )
        if not valid:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail={"code": "subject_mismatch_confirmation_invalid"},
                headers={"X-Error-Code": "subject_mismatch_confirmation_invalid"},
            )

        batch.subject_mismatch_confirmed_by_user_id = current_user.id
        batch.subject_mismatch_confirmed_at = get_utc_now()
        self._add_activity(
            db,
            action="confirmed_subject_mismatch",
            description="Confirmed a suspected report subject mismatch for batch commit",
            user_id=current_user.id,
            patient_id=batch.patient_id,
            entity_id=batch.id,
            metadata={
                "assessment_version": batch.subject_identity_assessment_version,
                "confirmation_scope": "single_import_batch",
                "result": "confirmed_for_current_subject",
            },
        )

    def rollback_batch(
        self,
        db: Session,
        *,
        batch: HealthImportBatch,
        current_user: User,
    ) -> tuple[HealthImportBatch, list[int], list[int]]:
        if batch.status == "rolled_back":
            return batch, [], []
        if batch.status != "committed":
            raise HTTPException(
                status_code=409, detail="Only committed batches can roll back"
            )

        created_items = [
            item for item in batch.items if item.created_component_id is not None
        ]
        components: list[LabTestComponent] = []
        for item in created_items:
            component = (
                db.query(LabTestComponent)
                .filter(LabTestComponent.id == item.created_component_id)
                .first()
            )
            if component is None:
                raise HTTPException(
                    status_code=409,
                    detail=(
                        "Rollback blocked because an imported record was changed or removed"
                    ),
                )
            revision_count = (
                db.query(func.count(HealthFormalMetricRevision.id))
                .filter(HealthFormalMetricRevision.component_id == component.id)
                .scalar()
                or 0
            )
            if revision_count > 1:
                raise HTTPException(
                    status_code=status.HTTP_409_CONFLICT,
                    detail={"code": "formal_metric_revision_exists"},
                    headers={"X-Error-Code": "formal_metric_revision_exists"},
                )
            if not self._component_matches_item(component, item):
                raise HTTPException(
                    status_code=409,
                    detail=(
                        "Rollback blocked because an imported record was changed or removed"
                    ),
                )
            components.append(component)

        deleted_component_ids = sorted(component.id for component in components)
        lab_result_ids = sorted({component.lab_result_id for component in components})
        external_duplicate_reference = (
            db.query(HealthImportItem)
            .filter(
                HealthImportItem.batch_id != batch.id,
                HealthImportItem.duplicate_of_component_id.in_(deleted_component_ids),
            )
            .first()
        )
        if external_duplicate_reference is not None:
            raise HTTPException(
                status_code=409,
                detail="Rollback blocked because another review batch references an imported record",
            )

        # Clear provenance foreign keys before deleting the records they point to.
        for item in created_items:
            item.created_component_id = None
            item.created_lab_result_id = None
        db.flush()
        for component in components:
            db.delete(component)
        db.flush()

        deleted_lab_result_ids: list[int] = []
        for lab_result_id in lab_result_ids:
            remaining = (
                db.query(LabTestComponent)
                .filter(LabTestComponent.lab_result_id == lab_result_id)
                .count()
            )
            parent = db.query(LabResult).filter(LabResult.id == lab_result_id).first()
            if (
                remaining == 0
                and parent is not None
                and f"import-batch:{batch.id}" in (parent.tags or [])
            ):
                db.delete(parent)
                deleted_lab_result_ids.append(lab_result_id)

        batch.status = "rolled_back"
        batch.rolled_back_at = get_utc_now()
        self._refresh_summary(batch)
        self._add_activity(
            db,
            action="deleted",
            description="Rolled back a health import batch",
            user_id=current_user.id,
            patient_id=batch.patient_id,
            entity_id=batch.id,
            metadata={
                "lab_result_count": len(deleted_lab_result_ids),
                "component_count": len(deleted_component_ids),
            },
        )
        db.commit()
        return (
            self._reload_batch(db, batch.id),
            deleted_lab_result_ids,
            deleted_component_ids,
        )

    @staticmethod
    def _build_idempotency_key(batch_in: HealthImportBatchCreate) -> str:
        payload = batch_in.model_dump(mode="json", exclude={"idempotency_key"})
        encoded = json.dumps(payload, sort_keys=True, separators=(",", ":")).encode()
        return hashlib.sha256(encoded).hexdigest()

    @staticmethod
    def _refresh_summary(batch: HealthImportBatch) -> None:
        counts = Counter(item.decision for item in batch.items)
        batch.summary = {
            "total": len(batch.items),
            "pending": counts.get("pending", 0),
            "accepted": counts.get("accepted", 0),
            "rejected": counts.get("rejected", 0),
            "duplicate": counts.get("duplicate", 0),
            "quality_issue_count": sum(
                len(item.validation_issues or []) for item in batch.items
            ),
        }

    @staticmethod
    def _add_activity(
        db: Session,
        *,
        action: str,
        description: str,
        user_id: int,
        patient_id: int,
        entity_id: int,
        metadata: dict,
    ) -> None:
        db.add(
            ActivityLog.create_activity(
                action=action,
                entity_type="health_import_batch",
                description=description,
                user_id=user_id,
                patient_id=patient_id,
                entity_id=entity_id,
                metadata=metadata,
            )
        )

    @staticmethod
    def _reload_batch(db: Session, batch_id: int) -> HealthImportBatch:
        batch = (
            db.query(HealthImportBatch)
            .options(joinedload(HealthImportBatch.items))
            .filter(HealthImportBatch.id == batch_id)
            .first()
        )
        assert batch is not None
        return batch

    @staticmethod
    def _find_existing_duplicate(
        db: Session,
        *,
        patient_id: int,
        candidate: CandidateObservation | HealthImportItem,
    ) -> LabTestComponent | None:
        query = (
            db.query(LabTestComponent)
            .join(LabResult, LabTestComponent.lab_result_id == LabResult.id)
            .filter(LabResult.patient_id == patient_id)
        )
        if candidate.observed_date is None:
            query = query.filter(LabResult.completed_date.is_(None))
        else:
            query = query.filter(LabResult.completed_date == candidate.observed_date)

        candidate_name = _normalize_text(
            candidate.canonical_test_name or candidate.test_name
        )
        candidate_unit = _normalize_text(candidate.unit)
        candidate_result = _candidate_result_key(candidate)
        for component in query.limit(1000).all():
            component_name = _normalize_text(
                component.canonical_test_name or component.test_name
            )
            if component_name != candidate_name:
                continue
            if _normalize_text(component.unit) != candidate_unit:
                continue
            if (component.result_type or "quantitative") != candidate.result_type:
                continue
            if _component_result_key(component) == candidate_result:
                return component
        return None

    @staticmethod
    def _component_matches_item(
        component: LabTestComponent, item: HealthImportItem
    ) -> bool:
        result_type = component.result_type or "quantitative"
        parent = component.lab_result
        if parent is None or parent.completed_date != item.observed_date:
            return False

        unchanged_metadata = (
            component.import_batch_id == item.batch_id
            and component.source_document_id == item.batch.source_document_id
            and component.source_page == item.source_page
            and component.source_locator == item.source_locator
            and component.test_name == item.test_name
            and component.canonical_test_name == item.canonical_test_name
            and component.test_code == item.test_code
            and component.abbreviation is None
            and result_type == item.result_type
            and component.unit == item.unit
            and _optional_float_equal(component.ref_range_min, item.ref_range_min)
            and _optional_float_equal(component.ref_range_max, item.ref_range_max)
            and component.ref_range_text == item.ref_range_text
            and component.status == item.result_status
            and component.category == item.category
            and component.display_order == item.sequence
            and component.notes is None
        )
        if not unchanged_metadata:
            return False
        if result_type == "quantitative":
            return _optional_float_equal(component.value, item.numeric_value)
        if result_type == "qualitative":
            return component.qualitative_value == item.qualitative_value
        return component.textual_value == item.textual_value


health_import_service = HealthImportService()
