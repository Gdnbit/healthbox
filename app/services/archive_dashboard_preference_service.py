"""Server persistence for viewer-by-subject dashboard display preferences."""

from sqlalchemy.orm import Session

from app.models.dashboard_preferences import DashboardPreference
from app.models.patient import Patient
from app.models.user import User
from app.services.archive_circle_service import ArchiveCircleError
from app.services.patient_access import PatientAccessService


class ArchiveDashboardPreferenceService:
    """Read and upsert display-only preferences after subject authorization."""

    def __init__(self, db: Session):
        self.db = db

    def get_preferences(self, *, actor: User, patient_id: int) -> dict:
        self._authorize(actor=actor, patient_id=patient_id)
        row = self._get_row(user_id=actor.id, patient_id=patient_id)
        if row is None:
            return {
                "patient_id": patient_id,
                "pinned_metric_ids": [],
                "ranges_by_metric_id": {},
                "updated_at": None,
            }
        return self._serialize(row)

    def update_preferences(
        self,
        *,
        actor: User,
        patient_id: int,
        pinned_metric_ids: list[str],
        ranges_by_metric_id: dict[str, str],
    ) -> dict:
        self._authorize(actor=actor, patient_id=patient_id)
        row = self._get_row(user_id=actor.id, patient_id=patient_id)
        if row is None:
            row = DashboardPreference(
                user_id=actor.id,
                patient_id=patient_id,
                pinned_metric_ids=list(pinned_metric_ids),
                ranges_by_metric_id=dict(ranges_by_metric_id),
            )
            self.db.add(row)
        else:
            row.pinned_metric_ids = list(pinned_metric_ids)
            row.ranges_by_metric_id = dict(ranges_by_metric_id)

        try:
            self.db.commit()
            self.db.refresh(row)
        except Exception as error:
            self.db.rollback()
            raise ArchiveCircleError(
                "dashboard_preferences_save_failed",
                "Dashboard preferences could not be saved",
                503,
            ) from error
        return self._serialize(row)

    def _authorize(self, *, actor: User, patient_id: int) -> Patient:
        patient = self.db.query(Patient).filter(Patient.id == patient_id).first()
        if patient is None or not PatientAccessService(
            self.db
        ).can_access_structured_dashboard(actor, patient):
            raise ArchiveCircleError(
                "archive_subject_not_found",
                "Archive subject was not found",
                404,
            )
        return patient

    def _get_row(
        self,
        *,
        user_id: int,
        patient_id: int,
    ) -> DashboardPreference | None:
        return (
            self.db.query(DashboardPreference)
            .filter(
                DashboardPreference.user_id == user_id,
                DashboardPreference.patient_id == patient_id,
            )
            .first()
        )

    @staticmethod
    def _serialize(row: DashboardPreference) -> dict:
        return {
            "patient_id": row.patient_id,
            "pinned_metric_ids": list(row.pinned_metric_ids or []),
            "ranges_by_metric_id": dict(row.ranges_by_metric_id or {}),
            "updated_at": row.updated_at,
        }
