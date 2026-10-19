import unicodedata
from uuid import uuid4

from fastapi import HTTPException
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.models.activity_log import ActivityLog
from app.models.health_coverage import HealthCoverageStatement
from app.models.health_imports import HealthSourceDocument
from app.models.user import User
from app.schemas.health_coverage import HealthCoverageCreate, HealthCoverageRevision
from app.services.admin_cross_subject_action_service import (
    AdminCrossSubjectActionContext,
)

DATA_ABSENT_REASON_SYSTEM = "http://terminology.hl7.org/CodeSystem/data-absent-reason"


def normalize_coverage_metric_key(value: str) -> str:
    return " ".join(unicodedata.normalize("NFKC", value).strip().casefold().split())


class HealthCoverageService:
    """Manage versioned absence assertions without creating empty observations."""

    def list_statements(
        self,
        db: Session,
        *,
        patient_id: int,
        include_history: bool = False,
        include_voided: bool = False,
    ) -> list[HealthCoverageStatement]:
        query = db.query(HealthCoverageStatement).filter(
            HealthCoverageStatement.patient_id == patient_id
        )
        if not include_history:
            query = query.filter(HealthCoverageStatement.is_current.is_(True))
        if not include_voided:
            query = query.filter(HealthCoverageStatement.status != "voided")
        return query.order_by(
            HealthCoverageStatement.exam_date.desc(),
            HealthCoverageStatement.metric_key.asc(),
            HealthCoverageStatement.record_key.asc(),
            HealthCoverageStatement.version_number.asc(),
        ).all()

    def create(
        self,
        db: Session,
        *,
        patient_id: int,
        current_user: User,
        statement_in: HealthCoverageCreate,
    ) -> HealthCoverageStatement:
        values = self._content_values(statement_in)
        self._validate_source(db, patient_id, values["source_document_id"])
        self._assert_identity_available(
            db,
            patient_id=patient_id,
            exam_date=values["exam_date"],
            metric_key=values["metric_key"],
        )
        statement = HealthCoverageStatement(
            patient_id=patient_id,
            created_by_user_id=current_user.id,
            record_key=str(uuid4()),
            version_number=1,
            absence_reason_system=DATA_ABSENT_REASON_SYSTEM,
            status="active",
            is_current=True,
            **values,
        )
        db.add(statement)
        self._flush_or_conflict(db)
        self._audit(db, statement, current_user, "created")
        db.commit()
        db.refresh(statement)
        return statement

    def revise(
        self,
        db: Session,
        *,
        statement_id: int,
        current_user: User,
        revision_in: HealthCoverageRevision,
        admin_context: AdminCrossSubjectActionContext | None = None,
    ) -> HealthCoverageStatement:
        current = self._get_for_update(db, statement_id)
        self._assert_current_version(current, revision_in.expected_version)
        previous_state = {
            "previous_record_id": current.id,
            "previous_version_number": current.version_number,
            "previous_status": current.status,
        }
        values = self._content_values(
            revision_in, exclude={"expected_version", "change_note"}
        )
        self._validate_source(db, current.patient_id, values["source_document_id"])
        self._assert_identity_available(
            db,
            patient_id=current.patient_id,
            exam_date=values["exam_date"],
            metric_key=values["metric_key"],
            exclude_record_key=current.record_key,
        )

        current.is_current = False
        current.status = "superseded"
        revised = HealthCoverageStatement(
            patient_id=current.patient_id,
            created_by_user_id=current_user.id,
            record_key=current.record_key,
            version_number=current.version_number + 1,
            supersedes_statement_id=current.id,
            absence_reason_system=DATA_ABSENT_REASON_SYSTEM,
            status="active",
            is_current=True,
            change_note=revision_in.change_note,
            **values,
        )
        db.add(revised)
        self._flush_or_conflict(db)
        self._audit(
            db,
            revised,
            current_user,
            "revised",
            admin_context=admin_context,
            previous_state=previous_state,
        )
        db.commit()
        db.refresh(revised)
        return revised

    def void(
        self,
        db: Session,
        *,
        statement_id: int,
        expected_version: int,
        reason: str,
        current_user: User,
        admin_context: AdminCrossSubjectActionContext | None = None,
    ) -> HealthCoverageStatement:
        current = self._get_for_update(db, statement_id)
        self._assert_current_version(current, expected_version)
        previous_state = {
            "previous_record_id": current.id,
            "previous_version_number": current.version_number,
            "previous_status": current.status,
        }
        current.is_current = False
        current.status = "superseded"
        voided = HealthCoverageStatement(
            patient_id=current.patient_id,
            created_by_user_id=current_user.id,
            record_key=current.record_key,
            version_number=current.version_number + 1,
            supersedes_statement_id=current.id,
            exam_date=current.exam_date,
            metric_key=current.metric_key,
            metric_name=current.metric_name,
            metric_code=current.metric_code,
            absence_reason=current.absence_reason,
            absence_reason_system=current.absence_reason_system,
            verification_status=current.verification_status,
            note=current.note,
            source_document_id=current.source_document_id,
            source_page=current.source_page,
            source_locator=current.source_locator,
            status="voided",
            is_current=True,
            change_note=reason,
        )
        db.add(voided)
        db.flush()
        self._audit(
            db,
            voided,
            current_user,
            "voided",
            admin_context=admin_context,
            previous_state=previous_state,
        )
        db.commit()
        db.refresh(voided)
        return voided

    def get_statement(self, db: Session, statement_id: int) -> HealthCoverageStatement:
        statement = (
            db.query(HealthCoverageStatement)
            .filter(HealthCoverageStatement.id == statement_id)
            .first()
        )
        if statement is None:
            raise HTTPException(status_code=404, detail="Coverage statement not found")
        return statement

    @staticmethod
    def _content_values(statement_in, exclude: set[str] | None = None) -> dict:
        values = statement_in.model_dump(exclude=exclude or {"change_note"})
        values["metric_key"] = normalize_coverage_metric_key(values["metric_key"])
        if not values["metric_key"]:
            raise HTTPException(status_code=422, detail="Metric key cannot be empty")
        return values

    def _get_for_update(
        self, db: Session, statement_id: int
    ) -> HealthCoverageStatement:
        statement = (
            db.query(HealthCoverageStatement)
            .filter(HealthCoverageStatement.id == statement_id)
            .with_for_update()
            .first()
        )
        if statement is None:
            raise HTTPException(status_code=404, detail="Coverage statement not found")
        return statement

    @staticmethod
    def _assert_current_version(
        statement: HealthCoverageStatement, expected_version: int
    ) -> None:
        if not statement.is_current or statement.status == "voided":
            raise HTTPException(
                status_code=409, detail="Coverage statement version is not current"
            )
        if statement.version_number != expected_version:
            raise HTTPException(
                status_code=409,
                detail="Coverage statement changed; reload before saving",
            )

    @staticmethod
    def _validate_source(
        db: Session, patient_id: int, source_document_id: int | None
    ) -> None:
        if source_document_id is None:
            return
        source = (
            db.query(HealthSourceDocument)
            .filter(HealthSourceDocument.id == source_document_id)
            .first()
        )
        if source is None or source.patient_id != patient_id:
            raise HTTPException(
                status_code=422,
                detail="Source document must belong to the same patient",
            )
        if source.status == "archived":
            raise HTTPException(
                status_code=409,
                detail="Source document is not available for new records",
            )

    @staticmethod
    def _assert_identity_available(
        db: Session,
        *,
        patient_id: int,
        exam_date,
        metric_key: str,
        exclude_record_key: str | None = None,
    ) -> None:
        query = db.query(HealthCoverageStatement).filter(
            HealthCoverageStatement.patient_id == patient_id,
            HealthCoverageStatement.exam_date == exam_date,
            HealthCoverageStatement.metric_key == metric_key,
            HealthCoverageStatement.is_current.is_(True),
            HealthCoverageStatement.status != "voided",
        )
        if exclude_record_key is not None:
            query = query.filter(
                HealthCoverageStatement.record_key != exclude_record_key
            )
        if query.first() is not None:
            raise HTTPException(
                status_code=409,
                detail="A current coverage statement already exists for this date and metric",
            )

    @staticmethod
    def _flush_or_conflict(db: Session) -> None:
        try:
            db.flush()
        except IntegrityError as error:
            db.rollback()
            raise HTTPException(
                status_code=409,
                detail="Coverage statement conflicts with an existing current statement",
            ) from error

    @staticmethod
    def _audit(
        db: Session,
        statement: HealthCoverageStatement,
        current_user: User,
        action: str,
        admin_context: AdminCrossSubjectActionContext | None = None,
        previous_state: dict | None = None,
    ) -> None:
        metadata = {
            "record_key": statement.record_key,
            "version_number": statement.version_number,
            "status": statement.status,
            "source_document_id": statement.source_document_id,
        }
        if admin_context is None:
            metadata.update(
                {
                    "absence_reason": statement.absence_reason,
                    "verification_status": statement.verification_status,
                }
            )
        if admin_context is not None:
            metadata.update(
                admin_context.audit_metadata(
                    result="completed",
                    **(previous_state or {}),
                    resulting_record_id=statement.id,
                    resulting_version_number=statement.version_number,
                    resulting_status=statement.status,
                )
            )
        db.add(
            ActivityLog.create_activity(
                action=action,
                entity_type="health_coverage_statement",
                description=f"Health coverage statement {action}",
                user_id=current_user.id,
                patient_id=statement.patient_id,
                entity_id=statement.id,
                metadata=metadata,
            )
        )


health_coverage_service = HealthCoverageService()
