from datetime import date, datetime, timedelta, timezone

from fastapi.testclient import TestClient
from sqlalchemy.orm import Session

from app.crud.patient import patient as patient_crud
from app.models.labs import LabResult, LabTestComponent
from app.schemas.patient import PatientCreate
from tests.utils.user import create_random_user, create_user_token_headers


def _component(
    db: Session,
    *,
    patient_id: int,
    name: str,
    value: float,
    unit: str,
    status: str,
    observed: date,
    source_document_id: int | None = None,
) -> LabTestComponent:
    result = LabResult(
        patient_id=patient_id,
        test_name="Synthetic alert fixture panel",
        status="completed",
        completed_date=observed,
        is_panel=True,
        tags=[],
        created_at=datetime.now(timezone.utc),
        updated_at=datetime.now(timezone.utc),
    )
    db.add(result)
    db.flush()
    component = LabTestComponent(
        lab_result_id=result.id,
        test_name=name,
        canonical_test_name=name,
        result_type="quantitative",
        value=value,
        unit=unit,
        status=status,
        category="chemistry",
        source_document_id=source_document_id,
        source_page=3 if source_document_id else None,
        source_locator="synthetic-row" if source_document_id else None,
    )
    db.add(component)
    db.commit()
    db.refresh(component)
    return component


def test_source_status_alert_only_uses_latest_metric_value(
    client: TestClient,
    db_session: Session,
    user_with_patient,
    authenticated_headers,
):
    patient_id = user_with_patient["patient"].id
    _component(
        db_session,
        patient_id=patient_id,
        name="Synthetic marker latest normal",
        value=15,
        unit="unit/L",
        status="critical",
        observed=date(2025, 1, 1),
    )
    _component(
        db_session,
        patient_id=patient_id,
        name="Synthetic marker latest normal",
        value=11,
        unit="unit/L",
        status="normal",
        observed=date(2026, 1, 1),
    )
    flagged = _component(
        db_session,
        patient_id=patient_id,
        name="Synthetic marker flagged",
        value=22,
        unit="unit/L",
        status="high",
        observed=date(2026, 1, 2),
    )

    response = client.get(
        f"/api/v1/health-alerts/patients/{patient_id}/alerts",
        headers=authenticated_headers,
    )
    assert response.status_code == 200, response.text
    payload = response.json()
    assert payload["active_count"] == 1
    assert payload["muted_count"] == 0
    alert = payload["alerts"][0]
    assert alert["alert_type"] == "source_status"
    assert alert["rule_id"] == "builtin.report_status"
    assert alert["evidence"]["component_id"] == flagged.id
    assert alert["evidence"]["status"] == "high"
    assert alert["calculated_at"]
    assert alert["limitations"]


def test_threshold_rule_is_versioned_and_recomputed(
    client: TestClient,
    db_session: Session,
    user_with_patient,
    authenticated_headers,
):
    patient_id = user_with_patient["patient"].id
    _component(
        db_session,
        patient_id=patient_id,
        name="Synthetic threshold marker",
        value=12.5,
        unit="unit/L",
        status="normal",
        observed=date(2026, 1, 2),
    )
    rule_payload = {
        "name": "Synthetic threshold review",
        "rule_type": "threshold",
        "test_name": "Synthetic threshold marker",
        "unit": "unit/L",
        "operator": "gt",
        "threshold_value": 10,
        "enabled": True,
    }
    created = client.post(
        f"/api/v1/health-alerts/patients/{patient_id}/rules",
        json=rule_payload,
        headers=authenticated_headers,
    )
    assert created.status_code == 201, created.text
    rule = created.json()
    assert rule["version"] == 1

    evaluated = client.get(
        f"/api/v1/health-alerts/patients/{patient_id}/alerts",
        headers=authenticated_headers,
    )
    threshold_alerts = [
        alert
        for alert in evaluated.json()["alerts"]
        if alert["alert_type"] == "threshold"
    ]
    assert len(threshold_alerts) == 1
    assert threshold_alerts[0]["rule_version"] == 1
    assert threshold_alerts[0]["evidence"]["threshold_value"] == 10

    rule_payload["threshold_value"] = 20
    updated = client.put(
        f"/api/v1/health-alerts/rules/{rule['id']}",
        json=rule_payload,
        headers=authenticated_headers,
    )
    assert updated.status_code == 200, updated.text
    assert updated.json()["version"] == 2
    recomputed = client.get(
        f"/api/v1/health-alerts/patients/{patient_id}/alerts",
        headers=authenticated_headers,
    )
    assert not [
        alert
        for alert in recomputed.json()["alerts"]
        if alert["alert_type"] == "threshold"
    ]


def test_overdue_alert_can_be_muted_and_unmuted(
    client: TestClient,
    db_session: Session,
    user_with_patient,
    authenticated_headers,
):
    patient_id = user_with_patient["patient"].id
    _component(
        db_session,
        patient_id=patient_id,
        name="Synthetic overdue marker",
        value=7,
        unit="unit/L",
        status="normal",
        observed=date(2020, 1, 1),
    )
    created = client.post(
        f"/api/v1/health-alerts/patients/{patient_id}/rules",
        json={
            "name": "Synthetic overdue review",
            "rule_type": "overdue",
            "test_name": "Synthetic overdue marker",
            "unit": "unit/L",
            "overdue_days": 30,
            "enabled": True,
        },
        headers=authenticated_headers,
    )
    assert created.status_code == 201, created.text

    evaluated = client.get(
        f"/api/v1/health-alerts/patients/{patient_id}/alerts",
        headers=authenticated_headers,
    ).json()
    alert = next(
        item for item in evaluated["alerts"] if item["alert_type"] == "overdue"
    )
    mute_until = datetime.now(timezone.utc) + timedelta(days=30)
    muted = client.post(
        f"/api/v1/health-alerts/patients/{patient_id}/alerts/{alert['alert_id']}/mute",
        json={"muted_until": mute_until.isoformat(), "reason": "Synthetic test mute"},
        headers=authenticated_headers,
    )
    assert muted.status_code == 200, muted.text

    hidden = client.get(
        f"/api/v1/health-alerts/patients/{patient_id}/alerts",
        headers=authenticated_headers,
    ).json()
    assert hidden["active_count"] == 0
    assert hidden["muted_count"] == 1
    assert hidden["alerts"] == []

    included = client.get(
        f"/api/v1/health-alerts/patients/{patient_id}/alerts",
        params={"include_muted": True},
        headers=authenticated_headers,
    ).json()
    assert included["alerts"][0]["muted_until"]

    unmuted = client.delete(
        f"/api/v1/health-alerts/patients/{patient_id}/alerts/{alert['alert_id']}/mute",
        headers=authenticated_headers,
    )
    assert unmuted.status_code == 204
    visible_again = client.get(
        f"/api/v1/health-alerts/patients/{patient_id}/alerts",
        headers=authenticated_headers,
    ).json()
    assert visible_again["active_count"] == 1


def test_health_alert_access_isolated_by_patient(
    client: TestClient,
    db_session: Session,
    user_with_patient,
):
    other_user = create_random_user(db_session)
    other_patient = patient_crud.create_for_user(
        db_session,
        user_id=other_user["user"].id,
        patient_data=PatientCreate(
            first_name="Alert",
            last_name="Fixture",
            birth_date=date(1995, 1, 1),
            gender="F",
            address="Example address",
        ),
    )
    other_user["user"].active_patient_id = other_patient.id
    db_session.commit()
    other_headers = create_user_token_headers(other_user["user"].username)

    response = client.get(
        f"/api/v1/health-alerts/patients/{user_with_patient['patient'].id}/alerts",
        headers=other_headers,
    )
    assert response.status_code == 403
