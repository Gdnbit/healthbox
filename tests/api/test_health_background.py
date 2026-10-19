from datetime import date, datetime, timezone

from fastapi.testclient import TestClient
from sqlalchemy.orm import Session

from app.crud.patient import patient as patient_crud
from app.models.activity_log import ActivityLog
from app.models.health_imports import HealthSourceDocument
from app.schemas.patient import PatientCreate
from tests.utils.user import create_random_user, create_user_token_headers


def _payload(**overrides):
    payload = {
        "category": "lifestyle",
        "title": "Synthetic daily routine",
        "narrative": "Synthetic fixture narrative for version testing only.",
        "effective_date": "2026-02-01",
        "verification_status": "confirmed",
    }
    payload.update(overrides)
    return payload


def test_background_revision_is_immutable_and_conflict_safe(
    client: TestClient,
    db_session: Session,
    user_with_patient,
    authenticated_headers,
):
    patient_id = user_with_patient["patient"].id
    created = client.post(
        f"/api/v1/health-background/patients/{patient_id}",
        json=_payload(),
        headers=authenticated_headers,
    )
    assert created.status_code == 201, created.text
    first = created.json()
    assert first["version_number"] == 1
    assert first["is_current"] is True

    revision_payload = _payload(
        narrative="Revised synthetic fixture narrative.",
        expected_version=1,
        change_note="Synthetic correction",
    )
    revised = client.post(
        f"/api/v1/health-background/entries/{first['id']}/revise",
        json=revision_payload,
        headers=authenticated_headers,
    )
    assert revised.status_code == 200, revised.text
    second = revised.json()
    assert second["record_key"] == first["record_key"]
    assert second["version_number"] == 2
    assert second["supersedes_entry_id"] == first["id"]

    stale = client.post(
        f"/api/v1/health-background/entries/{first['id']}/revise",
        json=revision_payload,
        headers=authenticated_headers,
    )
    assert stale.status_code == 409

    current = client.get(
        f"/api/v1/health-background/patients/{patient_id}",
        headers=authenticated_headers,
    ).json()
    assert [entry["id"] for entry in current] == [second["id"]]
    history = client.get(
        f"/api/v1/health-background/patients/{patient_id}",
        params={"include_history": True, "include_voided": True},
        headers=authenticated_headers,
    ).json()
    assert {entry["version_number"] for entry in history} == {1, 2}

    audit_rows = (
        db_session.query(ActivityLog)
        .filter(ActivityLog.entity_type == "health_background")
        .all()
    )
    assert len(audit_rows) == 2
    assert all("narrative" not in (row.event_metadata or {}) for row in audit_rows)
    assert all("Synthetic fixture" not in str(row.event_metadata) for row in audit_rows)

    exported = client.get(
        "/api/v1/export/data",
        params={"format": "json", "scope": "health_background"},
        headers=authenticated_headers,
    )
    assert exported.status_code == 200, exported.text
    versions = exported.json()["health_background"]
    assert [entry["version_number"] for entry in versions] == [1, 2]
    assert versions[1]["source_document_id"] is None
    assert "file_path" not in exported.text


def test_background_void_hides_current_but_preserves_history(
    client: TestClient, user_with_patient, authenticated_headers
):
    patient_id = user_with_patient["patient"].id
    first = client.post(
        f"/api/v1/health-background/patients/{patient_id}",
        json=_payload(category="general"),
        headers=authenticated_headers,
    ).json()
    voided_response = client.post(
        f"/api/v1/health-background/entries/{first['id']}/void",
        json={"expected_version": 1, "reason": "Synthetic record withdrawn"},
        headers=authenticated_headers,
    )
    assert voided_response.status_code == 200, voided_response.text
    voided = voided_response.json()
    assert voided["status"] == "voided"
    assert voided["version_number"] == 2
    assert (
        client.get(
            f"/api/v1/health-background/patients/{patient_id}",
            headers=authenticated_headers,
        ).json()
        == []
    )
    history = client.get(
        f"/api/v1/health-background/patients/{patient_id}",
        params={"include_history": True, "include_voided": True},
        headers=authenticated_headers,
    ).json()
    assert len(history) == 2


def test_background_access_and_source_patient_are_enforced(
    client: TestClient,
    db_session: Session,
    user_with_patient,
    authenticated_headers,
):
    orphan_location = client.post(
        f"/api/v1/health-background/patients/{user_with_patient['patient'].id}",
        json=_payload(source_page=2),
        headers=authenticated_headers,
    )
    assert orphan_location.status_code == 422

    other_user = create_random_user(db_session)
    other_patient = patient_crud.create_for_user(
        db_session,
        user_id=other_user["user"].id,
        patient_data=PatientCreate(
            first_name="Background",
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
        display_name="Synthetic other source",
        original_filename="synthetic-other.pdf",
        document_type="other",
        mime_type="application/pdf",
        size_bytes=10,
        sha256="a" * 64,
        storage_backend="local",
        status="uploaded",
        created_at=datetime.now(timezone.utc),
        updated_at=datetime.now(timezone.utc),
    )
    db_session.add(source)
    db_session.commit()

    mismatch = client.post(
        f"/api/v1/health-background/patients/{user_with_patient['patient'].id}",
        json=_payload(source_document_id=source.id, source_page=1),
        headers=authenticated_headers,
    )
    assert mismatch.status_code == 422

    other_headers = create_user_token_headers(other_user["user"].username)
    forbidden = client.get(
        f"/api/v1/health-background/patients/{user_with_patient['patient'].id}",
        headers=other_headers,
    )
    assert forbidden.status_code == 403
