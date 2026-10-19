"""API-level scope and metadata-isolation tests for archive circles."""

import json
from datetime import date, datetime, timezone

from app.crud.patient import patient as patient_crud
from app.crud.user import user as user_crud
from app.models.activity_log import ActivityLog
from app.models.clinical import Vitals
from app.models.health_imports import HealthSourceDocument
from app.models.labs import LabResult, LabTestComponent
from app.schemas.patient import PatientCreate
from app.schemas.user import UserCreate
from app.services.archive_circle_service import ArchiveCircleService
from tests.utils.user import create_user_token_headers


def _create_api_member(db_session, suffix: str):
    user = user_crud.create(
        db_session,
        obj_in=UserCreate(
            username=f"circleapi{suffix}",
            email=f"circleapi{suffix}@synthetic.healthbox.example",
            password=f"SyntheticCircle{suffix}Password1",
            full_name=f"Synthetic Circle {suffix}",
            role="user",
        ),
    )
    patient = patient_crud.create_for_user(
        db_session,
        user_id=user.id,
        patient_data=PatientCreate(
            first_name=f"档案{suffix}",
            last_name="虚构",
            birth_date=date(1990, 1, 1),
            gender="F",
            address="Synthetic address",
        ),
    )
    user.active_patient_id = patient.id
    db_session.commit()
    return user, patient, create_user_token_headers(user.username)


def test_ordinary_subject_directory_is_deduplicated_and_hides_group_metadata(
    client,
    db_session,
    test_admin_user,
    admin_token_headers,
):
    first_user, first_patient, first_headers = _create_api_member(
        db_session, "directorya"
    )
    _, second_patient, _ = _create_api_member(db_session, "directoryb")
    service = ArchiveCircleService(db_session)
    first_circle = service.create_circle(
        actor=test_admin_user,
        name="仅管理员可见甲",
    )
    second_circle = service.create_circle(
        actor=test_admin_user,
        name="仅管理员可见乙",
    )
    for circle in (first_circle, second_circle):
        for patient in (first_patient, second_patient):
            service.add_member(
                actor=test_admin_user,
                circle_id=circle.id,
                patient_id=patient.id,
            )

    response = client.get(
        "/api/v1/archive-access/subjects",
        headers=first_headers,
    )
    assert response.status_code == 200, response.text
    payload = response.json()
    assert [item["patient_id"] for item in payload["subjects"]] == [
        first_patient.id,
        second_patient.id,
    ]
    assert payload["subjects"][0]["scope"] == "owner"
    assert payload["subjects"][1]["scope"] == "structured_dashboard"
    assert set(payload["subjects"][1]) == {
        "patient_id",
        "display_name",
        "scope",
        "available",
        "relationship_changed_at",
    }

    ordinary_text = json.dumps(payload, ensure_ascii=False)
    for forbidden in (
        "仅管理员可见甲",
        "仅管理员可见乙",
        "circle_id",
        "membership_id",
        first_user.email,
        first_user.username,
        "birth_date",
        "address",
    ):
        assert forbidden not in ordinary_text

    admin_response = client.get(
        "/api/v1/admin/archive-circles",
        headers=admin_token_headers,
    )
    assert admin_response.status_code == 200
    assert {item["name"] for item in admin_response.json()["circles"]} == {
        "仅管理员可见甲",
        "仅管理员可见乙",
    }

    denied = client.get(
        f"/api/v1/admin/archive-circles/{first_circle.id}",
        headers=first_headers,
    )
    assert denied.status_code in (401, 403, 404)


def test_structured_dashboard_is_sanitized_and_does_not_grant_broad_read_or_write(
    client,
    db_session,
    test_admin_user,
):
    viewer_user, viewer_patient, viewer_headers = _create_api_member(
        db_session, "scopeviewer"
    )
    _, target_patient, _ = _create_api_member(db_session, "scopetarget")
    service = ArchiveCircleService(db_session)
    circle = service.create_circle(actor=test_admin_user, name="虚构范围组")
    for patient in (viewer_patient, target_patient):
        service.add_member(
            actor=test_admin_user,
            circle_id=circle.id,
            patient_id=patient.id,
        )

    db_session.add_all(
        [
            Vitals(
                patient_id=target_patient.id,
                recorded_date=datetime(2025, 1, 1, tzinfo=timezone.utc),
                systolic_bp=120,
                diastolic_bp=80,
                notes="SYNTHETIC PRIVATE NARRATIVE",
                location="SYNTHETIC PRIVATE LOCATION",
                device_used="SYNTHETIC PRIVATE DEVICE",
            ),
            Vitals(
                patient_id=target_patient.id,
                recorded_date=datetime(2026, 1, 1, tzinfo=timezone.utc),
                systolic_bp=118,
                diastolic_bp=78,
                notes="SYNTHETIC PRIVATE NARRATIVE TWO",
            ),
        ]
    )
    lab_2025 = LabResult(
        patient_id=target_patient.id,
        test_name="Synthetic completed panel",
        status="completed",
        completed_date=date(2025, 2, 1),
        notes="SYNTHETIC PRIVATE LAB NARRATIVE",
    )
    lab_2026 = LabResult(
        patient_id=target_patient.id,
        test_name="Synthetic completed panel",
        status="completed",
        completed_date=date(2026, 2, 1),
    )
    db_session.add_all([lab_2025, lab_2026])
    db_session.flush()
    db_session.add_all(
        [
            LabTestComponent(
                lab_result_id=lab_2025.id,
                test_name="虚构指标",
                canonical_test_name="SYNTHETIC-METRIC",
                value=4.5,
                unit="mmol/L",
                status="normal",
                ref_range_min=3.0,
                ref_range_max=6.0,
                source_document_id=None,
                source_page=1,
                source_locator="SYNTHETIC PRIVATE LOCATOR",
                notes="SYNTHETIC PRIVATE COMPONENT NOTE",
            ),
            LabTestComponent(
                lab_result_id=lab_2026.id,
                test_name="虚构指标",
                canonical_test_name="SYNTHETIC-METRIC",
                value=4.8,
                unit="mmol/L",
                status="normal",
                ref_range_min=3.0,
                ref_range_max=6.0,
                source_document_id=None,
                source_page=2,
                source_locator="SYNTHETIC PRIVATE LOCATOR TWO",
            ),
        ]
    )
    source = HealthSourceDocument(
        patient_id=target_patient.id,
        created_by_user_id=target_patient.owner_user_id,
        display_name="SYNTHETIC PRIVATE REPORT",
        original_filename="synthetic-private.pdf",
        document_type="checkup",
        report_date=date(2026, 1, 1),
        facility="SYNTHETIC PRIVATE FACILITY",
        mime_type="application/pdf",
        size_bytes=123,
        sha256="f" * 64,
        storage_backend="local",
        status="uploaded",
    )
    db_session.add(source)
    db_session.commit()

    response = client.get(
        f"/api/v1/archive-access/subjects/{target_patient.id}/dashboard",
        headers=viewer_headers,
    )
    assert response.status_code == 200, response.text
    payload = response.json()
    assert payload["subject"]["patient_id"] == target_patient.id
    assert payload["subject"]["scope"] == "structured_dashboard"
    assert {metric["label"] for metric in payload["metrics"]} >= {
        "血压",
        "虚构指标",
    }

    rendered = json.dumps(payload, ensure_ascii=False)
    for forbidden in (
        "SYNTHETIC PRIVATE",
        "notes",
        "location",
        "device_used",
        "import_source",
        "practitioner_id",
        "source_document_id",
        "source_page",
        "source_locator",
        "original_filename",
        "facility",
    ):
        assert forbidden not in rendered

    broad_read = client.get(
        f"/api/v1/vitals/patient/{target_patient.id}",
        headers=viewer_headers,
    )
    source_read = client.get(
        f"/api/v1/health-imports/patients/{target_patient.id}/source-documents",
        headers=viewer_headers,
    )
    write = client.post(
        f"/api/v1/vitals/patient/{target_patient.id}/vitals/",
        headers=viewer_headers,
        json={
            "patient_id": target_patient.id,
            "recorded_date": "2026-03-01T00:00:00Z",
            "heart_rate": 70,
        },
    )
    assert broad_read.status_code in (403, 404)
    assert source_read.status_code in (403, 404)
    assert write.status_code in (403, 404)

    audit = (
        db_session.query(ActivityLog)
        .filter(
            ActivityLog.user_id == viewer_user.id,
            ActivityLog.patient_id == target_patient.id,
            ActivityLog.entity_type == "archive_circle",
            ActivityLog.action == "viewed",
        )
        .one()
    )
    assert audit.event_metadata == {
        "actor_user_id": viewer_user.id,
        "target_patient_id": target_patient.id,
        "access_basis": "archive_circle",
        "scope": "structured_dashboard",
        "resource": "dashboard",
        "result": "allowed",
    }


def test_dashboard_preferences_persist_per_viewer_and_subject(
    client,
    db_session,
    test_admin_user,
):
    first_user, first_patient, first_headers = _create_api_member(
        db_session, "preferencefirst"
    )
    second_user, second_patient, second_headers = _create_api_member(
        db_session, "preferencesecond"
    )
    _, target_patient, _ = _create_api_member(db_session, "preferencetarget")
    service = ArchiveCircleService(db_session)
    circle = service.create_circle(actor=test_admin_user, name="虚构偏好隔离组")
    for patient in (first_patient, second_patient, target_patient):
        service.add_member(
            actor=test_admin_user,
            circle_id=circle.id,
            patient_id=patient.id,
        )

    endpoint = (
        f"/api/v1/archive-access/subjects/{target_patient.id}" "/dashboard-preferences"
    )
    first_payload = {
        "pinned_metric_ids": [
            "vital:blood_pressure",
            "lab:SYNTHETIC-METRIC:mmol/L",
        ],
        "ranges_by_metric_id": {
            "vital:blood_pressure": "2y",
            "lab:SYNTHETIC-METRIC:mmol/L": "all",
        },
    }
    update = client.put(endpoint, headers=first_headers, json=first_payload)
    assert update.status_code == 200, update.text
    assert update.json() == {
        "patient_id": target_patient.id,
        **first_payload,
        "updated_at": update.json()["updated_at"],
    }
    assert update.json()["updated_at"] is not None

    first_read = client.get(endpoint, headers=first_headers)
    second_read = client.get(endpoint, headers=second_headers)
    own_read = client.get(
        (
            f"/api/v1/archive-access/subjects/{first_patient.id}"
            "/dashboard-preferences"
        ),
        headers=first_headers,
    )
    assert first_read.status_code == 200
    assert first_read.json()["pinned_metric_ids"] == first_payload["pinned_metric_ids"]
    assert second_read.status_code == 200
    assert second_read.json()["pinned_metric_ids"] == []
    assert second_read.json()["ranges_by_metric_id"] == {}
    assert second_read.json()["updated_at"] is None
    assert own_read.status_code == 200
    assert own_read.json()["pinned_metric_ids"] == []

    rendered = json.dumps(first_read.json(), ensure_ascii=False)
    for forbidden in (
        "value",
        "secondary_value",
        "reference_min",
        "reference_max",
        first_user.email,
        second_user.email,
    ):
        assert forbidden not in rendered


def test_dashboard_preferences_validate_input_and_recheck_subject_access(
    client,
    db_session,
    test_admin_user,
):
    _, viewer_patient, viewer_headers = _create_api_member(
        db_session, "preferenceviewer"
    )
    _, target_patient, _ = _create_api_member(db_session, "preferencelocked")
    _, outsider_patient, _ = _create_api_member(db_session, "preferenceoutsider")
    service = ArchiveCircleService(db_session)
    circle = service.create_circle(actor=test_admin_user, name="虚构偏好授权组")
    for patient in (viewer_patient, target_patient):
        service.add_member(
            actor=test_admin_user,
            circle_id=circle.id,
            patient_id=patient.id,
        )

    endpoint = (
        f"/api/v1/archive-access/subjects/{target_patient.id}" "/dashboard-preferences"
    )
    invalid_payloads = (
        {
            "pinned_metric_ids": [],
            "ranges_by_metric_id": {},
        },
        {
            "pinned_metric_ids": ["one", "two", "three"],
            "ranges_by_metric_id": {},
        },
        {
            "pinned_metric_ids": ["same", "same"],
            "ranges_by_metric_id": {},
        },
        {
            "pinned_metric_ids": ["one"],
            "ranges_by_metric_id": {"one": "latest"},
        },
        {
            "pinned_metric_ids": ["one"],
            "ranges_by_metric_id": {
                f"synthetic-metric-{index}": "auto" for index in range(51)
            },
        },
    )
    for payload in invalid_payloads:
        response = client.put(endpoint, headers=viewer_headers, json=payload)
        assert response.status_code == 422, response.text

    outsider_endpoint = (
        f"/api/v1/archive-access/subjects/{outsider_patient.id}"
        "/dashboard-preferences"
    )
    assert client.get(outsider_endpoint, headers=viewer_headers).status_code == 404
    denied_update = client.put(
        outsider_endpoint,
        headers=viewer_headers,
        json={
            "pinned_metric_ids": ["vital:blood_pressure"],
            "ranges_by_metric_id": {"vital:blood_pressure": "1y"},
        },
    )
    assert denied_update.status_code == 404

    service.set_membership_status(
        actor=test_admin_user,
        circle_id=circle.id,
        patient_id=target_patient.id,
        status="paused",
    )
    assert client.get(endpoint, headers=viewer_headers).status_code == 404
    assert (
        client.put(
            endpoint,
            headers=viewer_headers,
            json={
                "pinned_metric_ids": ["vital:blood_pressure"],
                "ranges_by_metric_id": {"vital:blood_pressure": "1y"},
            },
        ).status_code
        == 404
    )
