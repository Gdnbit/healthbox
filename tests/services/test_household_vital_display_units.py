from datetime import datetime, timezone

from app.models.clinical import Vitals
from app.services.archive_dashboard_service import ArchiveDashboardService
from app.services.health_metric_units import normalize_vital_value_for_display


def test_household_vital_display_conversion_contract():
    assert normalize_vital_value_for_display("weight", 150) == 68.0
    assert normalize_vital_value_for_display("temperature", 98.6) == 37.0
    assert normalize_vital_value_for_display("heart_rate", 72) == 72.0


def test_shared_dashboard_converts_values_and_units_together(
    db_session,
    test_patient,
):
    db_session.add_all(
        [
            Vitals(
                patient_id=test_patient.id,
                recorded_date=datetime(2025, 1, 1, tzinfo=timezone.utc),
                weight=150,
                temperature=98.6,
            ),
            Vitals(
                patient_id=test_patient.id,
                recorded_date=datetime(2026, 1, 1, tzinfo=timezone.utc),
                weight=160,
                temperature=100.4,
            ),
        ]
    )
    db_session.commit()

    metrics = ArchiveDashboardService(db_session)._vital_metrics(test_patient.id)
    by_id = {metric["id"]: metric for metric in metrics}

    assert by_id["vital:weight"]["unit"] == "kg"
    assert [point["value"] for point in by_id["vital:weight"]["points"]] == [
        68.0,
        72.6,
    ]
    assert by_id["vital:temperature"]["unit"] == "°C"
    assert [point["value"] for point in by_id["vital:temperature"]["points"]] == [
        37.0,
        38.0,
    ]
