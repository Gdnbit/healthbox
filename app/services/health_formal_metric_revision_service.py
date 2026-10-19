import hashlib
import json

from fastapi import HTTPException, status
from sqlalchemy.orm import Session

from app.models.activity_log import ActivityLog
from app.models.health_imports import HealthFormalMetricRevision
from app.models.labs import LabResult, LabTestComponent
from app.models.user import User
from app.schemas.health_imports import (
    HealthFormalMetricRevisionCreate,
    HealthFormalMetricRevisionHistoryResponse,
    HealthFormalMetricRevisionResult,
)

FORMAL_METRIC_REVISION_CONTRACT_VERSION = "household-formal-metric-revision@1.0.0"

REVISION_VALUE_FIELDS = (
    "result_type",
    "numeric_value",
    "qualitative_value",
    "textual_value",
    "unit",
    "ref_range_min",
    "ref_range_max",
    "ref_range_text",
    "result_status",
)


def _revision_error(code: str, detail: str) -> HTTPException:
    return HTTPException(
        status_code=status.HTTP_409_CONFLICT,
        detail={"code": code, "message": detail},
        headers={"X-Error-Code": code},
    )


class HealthFormalMetricRevisionService:
    """Append-only revisions with a compatibility projection for trend readers."""

    @staticmethod
    def _snapshot_from_component(
        component: LabTestComponent,
    ) -> dict[str, object]:
        return {
            "result_type": component.result_type or "quantitative",
            "numeric_value": component.value,
            "qualitative_value": component.qualitative_value,
            "textual_value": component.textual_value,
            "unit": component.unit,
            "ref_range_min": component.ref_range_min,
            "ref_range_max": component.ref_range_max,
            "ref_range_text": component.ref_range_text,
            "result_status": component.status,
        }

    @staticmethod
    def _result_payload(
        result: HealthFormalMetricRevisionResult,
    ) -> dict[str, object]:
        return result.model_dump()

    @staticmethod
    def _request_hash(request_in: HealthFormalMetricRevisionCreate) -> str:
        payload = request_in.model_dump(mode="json")
        encoded = json.dumps(payload, sort_keys=True, separators=(",", ":")).encode()
        return hashlib.sha256(encoded).hexdigest()

    def ensure_initial_revision(
        self,
        db: Session,
        *,
        component: LabTestComponent,
        patient_id: int,
        current_user: User,
    ) -> HealthFormalMetricRevision:
        existing = (
            db.query(HealthFormalMetricRevision)
            .filter(HealthFormalMetricRevision.component_id == component.id)
            .order_by(HealthFormalMetricRevision.version.asc())
            .first()
        )
        if existing is not None:
            return existing
        if component.import_batch_id is None:
            raise _revision_error(
                "formal_metric_revision_not_managed",
                "Only formally imported components use this revision history",
            )

        snapshot = self._snapshot_from_component(component)
        request_hash = hashlib.sha256(
            json.dumps(snapshot, sort_keys=True, separators=(",", ":")).encode()
        ).hexdigest()
        revision = HealthFormalMetricRevision(
            component_id=component.id,
            patient_id=patient_id,
            version=1,
            action="created",
            supersedes_revision_id=None,
            reason=None,
            idempotency_key=f"initial:{component.import_batch_id}:{component.id}",
            request_hash=request_hash,
            created_by_user_id=current_user.id,
            **snapshot,
        )
        db.add(revision)
        db.flush()
        return revision

    def _latest_revision(
        self, db: Session, component_id: int
    ) -> HealthFormalMetricRevision | None:
        return (
            db.query(HealthFormalMetricRevision)
            .filter(HealthFormalMetricRevision.component_id == component_id)
            .order_by(HealthFormalMetricRevision.version.desc())
            .first()
        )

    def build_history(
        self,
        db: Session,
        *,
        component: LabTestComponent,
        current_user: User,
    ) -> HealthFormalMetricRevisionHistoryResponse:
        lab_result = (
            db.query(LabResult).filter(LabResult.id == component.lab_result_id).one()
        )
        current = self._latest_revision(db, component.id)
        if current is None:
            raise _revision_error(
                "formal_metric_revision_history_missing",
                "This imported component has no immutable revision history",
            )
        revisions = (
            db.query(HealthFormalMetricRevision)
            .filter(HealthFormalMetricRevision.component_id == component.id)
            .order_by(HealthFormalMetricRevision.version.desc())
            .all()
        )
        return HealthFormalMetricRevisionHistoryResponse(
            contract_version=FORMAL_METRIC_REVISION_CONTRACT_VERSION,
            component_id=component.id,
            patient_id=lab_result.patient_id,
            lab_result_id=component.lab_result_id,
            test_name=component.test_name,
            canonical_test_name=component.canonical_test_name,
            test_code=component.test_code,
            observed_date=lab_result.completed_date,
            source_document_id=component.source_document_id,
            source_page=component.source_page,
            source_locator=component.source_locator,
            import_batch_id=component.import_batch_id,
            current_revision_id=current.id,
            revisions=revisions,
        )

    def revise(
        self,
        db: Session,
        *,
        component_id: int,
        current_user: User,
        revision_in: HealthFormalMetricRevisionCreate,
        ip_address: str | None = None,
    ) -> HealthFormalMetricRevisionHistoryResponse:
        component = (
            db.query(LabTestComponent)
            .filter(LabTestComponent.id == component_id)
            .with_for_update()
            .one()
        )
        lab_result = (
            db.query(LabResult).filter(LabResult.id == component.lab_result_id).one()
        )
        if component.import_batch_id is None:
            raise _revision_error(
                "formal_metric_revision_not_managed",
                "Only formally imported components use this revision history",
            )

        request_hash = self._request_hash(revision_in)
        replay = (
            db.query(HealthFormalMetricRevision)
            .filter(
                HealthFormalMetricRevision.component_id == component.id,
                HealthFormalMetricRevision.idempotency_key
                == revision_in.idempotency_key,
            )
            .first()
        )
        if replay is not None:
            if replay.request_hash != request_hash:
                raise _revision_error(
                    "formal_metric_revision_idempotency_conflict",
                    "This idempotency key is already bound to another revision request",
                )
            return self.build_history(
                db, component=component, current_user=current_user
            )

        current = self._latest_revision(db, component.id)
        if current is None:
            raise _revision_error(
                "formal_metric_revision_history_missing",
                "This imported component has no immutable revision history",
            )
        if current.id != revision_in.expected_current_revision_id:
            raise _revision_error(
                "formal_metric_revision_conflict",
                "The formal metric changed after this form was opened",
            )

        next_snapshot = self._result_payload(revision_in.result)
        current_snapshot = {
            field: getattr(current, field) for field in REVISION_VALUE_FIELDS
        }
        changed_fields = sorted(
            field
            for field in REVISION_VALUE_FIELDS
            if current_snapshot[field] != next_snapshot[field]
        )
        if not changed_fields:
            raise _revision_error(
                "formal_metric_revision_no_change",
                "The proposed revision does not change the formal metric",
            )

        revision = HealthFormalMetricRevision(
            component_id=component.id,
            patient_id=lab_result.patient_id,
            version=current.version + 1,
            action="revised",
            supersedes_revision_id=current.id,
            reason=revision_in.reason,
            idempotency_key=revision_in.idempotency_key,
            request_hash=request_hash,
            created_by_user_id=current_user.id,
            **next_snapshot,
        )
        db.add(revision)
        db.flush()

        component.result_type = revision.result_type
        component.value = revision.numeric_value
        component.qualitative_value = revision.qualitative_value
        component.textual_value = revision.textual_value
        component.unit = revision.unit
        component.ref_range_min = revision.ref_range_min
        component.ref_range_max = revision.ref_range_max
        component.ref_range_text = revision.ref_range_text
        component.status = revision.result_status

        db.add(
            ActivityLog.create_activity(
                action="revised",
                entity_type="health_formal_metric",
                description="Created an immutable revision of a formal health metric",
                user_id=current_user.id,
                patient_id=lab_result.patient_id,
                entity_id=component.id,
                metadata={
                    "contract_version": FORMAL_METRIC_REVISION_CONTRACT_VERSION,
                    "component_id": component.id,
                    "revision_id": revision.id,
                    "supersedes_revision_id": current.id,
                    "version": revision.version,
                    "changed_fields": changed_fields,
                    "reason_recorded": True,
                },
                ip_address=ip_address,
            )
        )
        db.commit()
        db.refresh(component)
        return self.build_history(db, component=component, current_user=current_user)


health_formal_metric_revision_service = HealthFormalMetricRevisionService()
