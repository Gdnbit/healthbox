from datetime import date, datetime, timezone

from fastapi.testclient import TestClient
from sqlalchemy.orm import Session

from app.crud.patient import patient as patient_crud
from app.models.activity_log import ActivityLog
from app.models.health_coverage import HealthCoverageStatement
from app.models.health_imports import HealthSourceDocument
from app.schemas.patient import PatientCreate
from tests.utils.user import create_random_user, create_user_token_headers


def _payload(**overrides):
    payload = {
        "exam_date": "2026-02-10",
        "metric_key": "  Synthetic Metric A ",
        "metric_name": "Synthetic Metric A",
        "metric_code": "SYN-A",
        "absence_reason": "not-performed",
        "verification_status": "confirmed",
        "note": "Synthetic note that must not enter activity metadata.",
    }
    payload.update(overrides)
    return payload


def _other_patient_and_source(db_session: Session):
    other_user = create_random_user(db_session)
    other_patient = patient_crud.create_for_user(
        db_session,
        user_id=other_user["user"].id,
        patient_data=PatientCreate(
            first_name="Coverage",
            last_name="Fixture",
            birth_date=date(1990, 1, 1),
            gender="F",
            address="Synthetic address",
        ),
    )
    other_user["user"].active_patient_id = other_patient.id
    source = HealthSourceDocument(
        patient_id=other_patient.id,
        created_by_user_id=other_user["user"].id,
        display_name="Synthetic foreign source",
        original_filename="synthetic-foreign.pdf",
        document_type="checkup",
        report_date=date(2026, 2, 10),
        mime_type="application/pdf",
        size_bytes=10,
        sha256="c" * 64,
        storage_backend="local",
        status="uploaded",
        created_at=datetime.now(timezone.utc),
        updated_at=datetime.now(timezone.utc),
    )
    db_session.add(source)
    db_session.commit()
    db_session.refresh(source)
    return other_user, other_patient, source


def test_coverage_statement_versions_conflicts_audit_and_export(
    client: TestClient,
    db_session: Session,
    user_with_patient,
    authenticated_headers,
):
    patient_id = user_with_patient["patient"].id
    created_response = client.post(
        f"/api/v1/health-coverage/patients/{patient_id}",
        json=_payload(),
        headers=authenticated_headers,
    )
    assert created_response.status_code == 201, created_response.text
    first = created_response.json()
    assert first["metric_key"] == "synthetic metric a"
    assert first["absence_reason_system"] == (
        "http://terminology.hl7.org/CodeSystem/data-absent-reason"
    )
    assert first["version_number"] == 1
    assert first["is_current"] is True

    duplicate = client.post(
        f"/api/v1/health-coverage/patients/{patient_id}",
        json=_payload(note="Another synthetic note"),
        headers=authenticated_headers,
    )
    assert duplicate.status_code == 409

    revised_response = client.post(
        f"/api/v1/health-coverage/statements/{first['id']}/revise",
        json=_payload(
            absence_reason="unknown",
            expected_version=1,
            change_note="Synthetic correction body must remain out of audit metadata.",
        ),
        headers=authenticated_headers,
    )
    assert revised_response.status_code == 200, revised_response.text
    second = revised_response.json()
    assert second["record_key"] == first["record_key"]
    assert second["version_number"] == 2
    assert second["supersedes_statement_id"] == first["id"]
    assert second["absence_reason"] == "unknown"

    stale = client.post(
        f"/api/v1/health-coverage/statements/{first['id']}/revise",
        json=_payload(
            expected_version=1,
            change_note="Synthetic stale update",
        ),
        headers=authenticated_headers,
    )
    assert stale.status_code == 409

    current = client.get(
        f"/api/v1/health-coverage/patients/{patient_id}",
        headers=authenticated_headers,
    )
    assert current.status_code == 200
    assert [item["id"] for item in current.json()] == [second["id"]]

    audit_rows = (
        db_session.query(ActivityLog)
        .filter(ActivityLog.entity_type == "health_coverage_statement")
        .order_by(ActivityLog.id.asc())
        .all()
    )
    assert [row.action for row in audit_rows] == ["created", "revised"]
    assert all("note" not in (row.event_metadata or {}) for row in audit_rows)
    assert all("change_note" not in (row.event_metadata or {}) for row in audit_rows)
    assert all("Synthetic" not in str(row.event_metadata) for row in audit_rows)

    voided_response = client.post(
        f"/api/v1/health-coverage/statements/{second['id']}/void",
        json={
            "expected_version": 2,
            "reason": "Synthetic withdrawal body must remain out of audit metadata.",
        },
        headers=authenticated_headers,
    )
    assert voided_response.status_code == 200, voided_response.text
    assert voided_response.json()["status"] == "voided"
    assert voided_response.json()["version_number"] == 3

    assert (
        client.get(
            f"/api/v1/health-coverage/patients/{patient_id}",
            headers=authenticated_headers,
        ).json()
        == []
    )
    history = client.get(
        f"/api/v1/health-coverage/patients/{patient_id}",
        params={"include_history": True, "include_voided": True},
        headers=authenticated_headers,
    ).json()
    assert [item["version_number"] for item in history] == [1, 2, 3]

    exported_response = client.get(
        "/api/v1/export/data",
        params={"format": "json", "scope": "all"},
        headers=authenticated_headers,
    )
    assert exported_response.status_code == 200, exported_response.text
    exported = exported_response.json()["health_coverage_statements"]
    assert [item["version_number"] for item in exported] == [1, 2, 3]
    assert all(
        item["absence_reason_system"]
        == "http://terminology.hl7.org/CodeSystem/data-absent-reason"
        for item in exported
    )
    assert "file_path" not in exported_response.text


def test_coverage_statement_validation_rejects_unsafe_meaning(
    client: TestClient,
    user_with_patient,
    authenticated_headers,
):
    patient_id = user_with_patient["patient"].id

    future = client.post(
        f"/api/v1/health-coverage/patients/{patient_id}",
        json=_payload(exam_date="2099-01-01"),
        headers=authenticated_headers,
    )
    assert future.status_code == 422

    invalid_reason = client.post(
        f"/api/v1/health-coverage/patients/{patient_id}",
        json=_payload(absence_reason="not-recorded"),
        headers=authenticated_headers,
    )
    assert invalid_reason.status_code == 422

    orphan_locator = client.post(
        f"/api/v1/health-coverage/patients/{patient_id}",
        json=_payload(source_page=2, source_locator="Synthetic table"),
        headers=authenticated_headers,
    )
    assert orphan_locator.status_code == 422

    blank_identity = client.post(
        f"/api/v1/health-coverage/patients/{patient_id}",
        json=_payload(metric_key=" ", metric_name=" "),
        headers=authenticated_headers,
    )
    assert blank_identity.status_code == 422


def test_coverage_statement_access_and_source_patient_are_enforced(
    client: TestClient,
    db_session: Session,
    user_with_patient,
    authenticated_headers,
):
    patient_id = user_with_patient["patient"].id
    other_user, other_patient, foreign_source = _other_patient_and_source(db_session)

    mismatch = client.post(
        f"/api/v1/health-coverage/patients/{patient_id}",
        json=_payload(source_document_id=foreign_source.id, source_page=1),
        headers=authenticated_headers,
    )
    assert mismatch.status_code == 422
    assert db_session.query(HealthCoverageStatement).count() == 0

    other_headers = create_user_token_headers(other_user["user"].username)
    forbidden_read = client.get(
        f"/api/v1/health-coverage/patients/{patient_id}",
        headers=other_headers,
    )
    assert forbidden_read.status_code == 403

    foreign_created = client.post(
        f"/api/v1/health-coverage/patients/{other_patient.id}",
        json=_payload(source_document_id=foreign_source.id, source_page=1),
        headers=other_headers,
    )
    assert foreign_created.status_code == 201, foreign_created.text

    forbidden_revision = client.post(
        f"/api/v1/health-coverage/statements/{foreign_created.json()['id']}/revise",
        json=_payload(
            source_document_id=foreign_source.id,
            source_page=1,
            expected_version=1,
            change_note="Synthetic forbidden update",
        ),
        headers=authenticated_headers,
    )
    assert forbidden_revision.status_code == 403
