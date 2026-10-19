from uuid import uuid4

from fastapi import HTTPException
from sqlalchemy.orm import Session

from app.models.activity_log import ActivityLog
from app.models.health_background import HealthBackgroundEntry
from app.models.health_imports import HealthSourceDocument
from app.models.user import User
from app.schemas.health_background import (
    HealthBackgroundCreate,
    HealthBackgroundRevision,
)
from app.services.admin_cross_subject_action_service import (
    AdminCrossSubjectActionContext,
)


class HealthBackgroundService:
    """Create immutable background versions without logging narrative content."""

    def list_entries(
        self,
        db: Session,
        *,
        patient_id: int,
        include_history: bool = False,
        include_voided: bool = False,
    ) -> list[HealthBackgroundEntry]:
        query = db.query(HealthBackgroundEntry).filter(
            HealthBackgroundEntry.patient_id == patient_id
        )
        if not include_history:
            query = query.filter(HealthBackgroundEntry.is_current.is_(True))
        if not include_voided:
            query = query.filter(HealthBackgroundEntry.status != "voided")
        return query.order_by(
            HealthBackgroundEntry.effective_date.desc(),
            HealthBackgroundEntry.created_at.desc(),
            HealthBackgroundEntry.id.desc(),
        ).all()

    def create(
        self,
        db: Session,
        *,
        patient_id: int,
        current_user: User,
        entry_in: HealthBackgroundCreate,
    ) -> HealthBackgroundEntry:
        self._validate_source(db, patient_id, entry_in.source_document_id)
        values = entry_in.model_dump()
        entry = HealthBackgroundEntry(
            patient_id=patient_id,
            created_by_user_id=current_user.id,
            record_key=str(uuid4()),
            version_number=1,
            status="active",
            is_current=True,
            **values,
        )
        db.add(entry)
        db.flush()
        self._audit(db, entry, current_user, "created")
        db.commit()
        db.refresh(entry)
        return entry

    def revise(
        self,
        db: Session,
        *,
        entry_id: int,
        current_user: User,
        revision_in: HealthBackgroundRevision,
        admin_context: AdminCrossSubjectActionContext | None = None,
    ) -> HealthBackgroundEntry:
        current = self._get_for_update(db, entry_id)
        self._assert_current_version(current, revision_in.expected_version)
        self._validate_source(db, current.patient_id, revision_in.source_document_id)
        previous_state = {
            "previous_record_id": current.id,
            "previous_version_number": current.version_number,
            "previous_status": current.status,
        }

        values = revision_in.model_dump(exclude={"expected_version"})
        current.is_current = False
        current.status = "superseded"
        revised = HealthBackgroundEntry(
            patient_id=current.patient_id,
            created_by_user_id=current_user.id,
            record_key=current.record_key,
            version_number=current.version_number + 1,
            supersedes_entry_id=current.id,
            status="active",
            is_current=True,
            **values,
        )
        db.add(revised)
        db.flush()
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
        entry_id: int,
        expected_version: int,
        reason: str,
        current_user: User,
        admin_context: AdminCrossSubjectActionContext | None = None,
    ) -> HealthBackgroundEntry:
        current = self._get_for_update(db, entry_id)
        self._assert_current_version(current, expected_version)
        previous_state = {
            "previous_record_id": current.id,
            "previous_version_number": current.version_number,
            "previous_status": current.status,
        }
        current.is_current = False
        current.status = "superseded"
        voided = HealthBackgroundEntry(
            patient_id=current.patient_id,
            created_by_user_id=current_user.id,
            record_key=current.record_key,
            version_number=current.version_number + 1,
            supersedes_entry_id=current.id,
            category=current.category,
            title=current.title,
            narrative=current.narrative,
            effective_date=current.effective_date,
            verification_status=current.verification_status,
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

    def get_entry(self, db: Session, entry_id: int) -> HealthBackgroundEntry:
        entry = (
            db.query(HealthBackgroundEntry)
            .filter(HealthBackgroundEntry.id == entry_id)
            .first()
        )
        if entry is None:
            raise HTTPException(status_code=404, detail="Health background not found")
        return entry

    def _get_for_update(self, db: Session, entry_id: int) -> HealthBackgroundEntry:
        entry = (
            db.query(HealthBackgroundEntry)
            .filter(HealthBackgroundEntry.id == entry_id)
            .with_for_update()
            .first()
        )
        if entry is None:
            raise HTTPException(status_code=404, detail="Health background not found")
        return entry

    @staticmethod
    def _assert_current_version(
        entry: HealthBackgroundEntry, expected_version: int
    ) -> None:
        if not entry.is_current or entry.status == "voided":
            raise HTTPException(
                status_code=409, detail="Health background version is not current"
            )
        if entry.version_number != expected_version:
            raise HTTPException(
                status_code=409,
                detail="Health background changed; reload before saving",
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
    def _audit(
        db: Session,
        entry: HealthBackgroundEntry,
        current_user: User,
        action: str,
        admin_context: AdminCrossSubjectActionContext | None = None,
        previous_state: dict | None = None,
    ) -> None:
        metadata = {
            "record_key": entry.record_key,
            "version_number": entry.version_number,
            "status": entry.status,
            "source_document_id": entry.source_document_id,
        }
        if admin_context is None:
            metadata["category"] = entry.category
        if admin_context is not None:
            metadata.update(
                admin_context.audit_metadata(
                    result="completed",
                    **(previous_state or {}),
                    resulting_record_id=entry.id,
                    resulting_version_number=entry.version_number,
                    resulting_status=entry.status,
                )
            )
        db.add(
            ActivityLog.create_activity(
                action=action,
                entity_type="health_background",
                description=f"Health background {action}",
                user_id=current_user.id,
                patient_id=entry.patient_id,
                entity_id=entry.id,
                metadata=metadata,
            )
        )


health_background_service = HealthBackgroundService()
