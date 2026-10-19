"""Sanitized structured-dashboard output for direct archive-circle peers."""

from collections import defaultdict
from datetime import date, datetime

from sqlalchemy.orm import Session

from app.core.utils.datetime_utils import get_utc_now
from app.models.activity_log import ActionType, ActivityLog, EntityType
from app.models.clinical import Vitals
from app.models.labs import LabResult, LabTestComponent
from app.models.patient import Patient
from app.models.user import User
from app.services.archive_circle_service import ARCHIVE_CIRCLE_SCOPE, ArchiveCircleError
from app.services.health_metric_units import (
    VITAL_DISPLAY_UNITS,
    normalize_vital_value_for_display,
)
from app.services.patient_access import PatientAccessService

VITAL_DEFINITIONS = (
    ("blood_pressure", "血压", "mmHg", "systolic_bp", "diastolic_bp", 0),
    ("weight", "体重", VITAL_DISPLAY_UNITS["weight"], "weight", None, 1),
    ("blood_glucose", "血糖", "mg/dL", "blood_glucose", None, 2),
    ("a1c", "糖化血红蛋白", "%", "a1c", None, 3),
    ("heart_rate", "心率", "次/分", "heart_rate", None, 4),
    (
        "oxygen_saturation",
        "血氧饱和度",
        "%",
        "oxygen_saturation",
        None,
        5,
    ),
    (
        "temperature",
        "体温",
        VITAL_DISPLAY_UNITS["temperature"],
        "temperature",
        None,
        6,
    ),
    (
        "respiratory_rate",
        "呼吸频率",
        "次/分",
        "respiratory_rate",
        None,
        7,
    ),
)


def _date_value(value: date | datetime | None) -> str | None:
    if value is None:
        return None
    return value.isoformat()


class ArchiveDashboardService:
    """Build a bounded DTO that contains no narrative or source metadata."""

    def __init__(self, db: Session):
        self.db = db

    def get_dashboard(
        self,
        *,
        actor: User,
        patient_id: int,
    ) -> dict:
        patient = self.db.query(Patient).filter(Patient.id == patient_id).first()
        access = PatientAccessService(self.db)
        if patient is None or not access.can_access_structured_dashboard(
            actor,
            patient,
        ):
            raise ArchiveCircleError(
                "archive_subject_not_found",
                "Archive subject was not found",
                404,
            )

        basis = "owner" if patient.owner_user_id == actor.id else "archive_circle"
        metrics = self._vital_metrics(patient.id) + self._lab_metrics(patient.id)
        metrics.sort(
            key=lambda metric: (
                0 if metric["kind"] == "vital" else 1,
                metric["priority"],
                metric["label"],
                metric["id"],
            )
        )
        for metric in metrics:
            metric.pop("priority", None)

        audit = ActivityLog.create_activity(
            action=ActionType.VIEWED,
            entity_type=EntityType.ARCHIVE_CIRCLE,
            entity_id=patient.id,
            user_id=actor.id,
            patient_id=patient.id,
            description="Member viewed a sanitized structured health dashboard",
            metadata={
                "actor_user_id": actor.id,
                "target_patient_id": patient.id,
                "access_basis": basis,
                "scope": ARCHIVE_CIRCLE_SCOPE,
                "resource": "dashboard",
                "result": "allowed",
            },
        )
        self.db.add(audit)
        try:
            self.db.commit()
        except Exception as error:
            self.db.rollback()
            raise ArchiveCircleError(
                "archive_dashboard_audit_failed",
                "Dashboard access was denied because it could not be audited",
                503,
            ) from error

        subject_rows = access.get_structured_dashboard_subjects(actor)
        subject = next(row for row in subject_rows if row["patient_id"] == patient.id)
        return {
            "subject": subject,
            "metrics": metrics,
            "loaded_at": get_utc_now(),
        }

    def _vital_metrics(self, patient_id: int) -> list[dict]:
        rows = (
            self.db.query(Vitals)
            .filter(Vitals.patient_id == patient_id)
            .order_by(Vitals.recorded_date, Vitals.id)
            .limit(10000)
            .all()
        )
        metrics = []
        for (
            metric_id,
            label,
            unit,
            primary_field,
            secondary_field,
            priority,
        ) in VITAL_DEFINITIONS:
            points = []
            for row in rows:
                value = getattr(row, primary_field)
                if value is None:
                    continue
                points.append(
                    {
                        "id": f"vital:{metric_id}:{row.id}",
                        "date": _date_value(row.recorded_date),
                        "value": normalize_vital_value_for_display(
                            metric_id,
                            float(value),
                        ),
                        "secondary_value": (
                            float(getattr(row, secondary_field))
                            if secondary_field
                            and getattr(row, secondary_field) is not None
                            else None
                        ),
                        "status": None,
                        "reference_min": None,
                        "reference_max": None,
                        "reference_text": None,
                    }
                )
            if len(points) >= 2:
                metrics.append(
                    {
                        "id": f"vital:{metric_id}",
                        "kind": "vital",
                        "label": label,
                        "unit": unit,
                        "points": points,
                        "latest_status": points[-1]["status"],
                        "priority": priority,
                    }
                )
        return metrics

    def _lab_metrics(self, patient_id: int) -> list[dict]:
        rows = (
            self.db.query(LabTestComponent, LabResult)
            .join(
                LabResult,
                LabResult.id == LabTestComponent.lab_result_id,
            )
            .filter(
                LabResult.patient_id == patient_id,
                LabResult.status == "completed",
                LabTestComponent.value.isnot(None),
            )
            .order_by(
                LabResult.completed_date,
                LabTestComponent.created_at,
                LabTestComponent.id,
            )
            .limit(10000)
            .all()
        )
        grouped: dict[tuple[str, str], list[tuple]] = defaultdict(list)
        for component, result in rows:
            trend_name = (
                component.canonical_test_name or component.test_name or ""
            ).strip()
            grouped[(trend_name, component.unit or "")].append((component, result))

        metrics = []
        for (trend_name, unit), values in grouped.items():
            points = []
            for component, result in values:
                observed = (
                    result.completed_date or component.created_at or result.created_at
                )
                if observed is None:
                    continue
                points.append(
                    {
                        "id": f"lab:{component.id}",
                        "date": _date_value(observed),
                        "value": float(component.value),
                        "secondary_value": None,
                        "status": component.status,
                        "reference_min": component.ref_range_min,
                        "reference_max": component.ref_range_max,
                        "reference_text": component.ref_range_text,
                    }
                )
            if len(points) < 2:
                continue
            metrics.append(
                {
                    "id": f"lab:{trend_name}:{unit}",
                    "kind": "lab",
                    "label": values[-1][0].test_name or trend_name,
                    "unit": unit,
                    "points": points,
                    "latest_status": points[-1]["status"],
                    "priority": 100,
                }
            )
        return metrics
