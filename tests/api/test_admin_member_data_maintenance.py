"""Explicit sole-administrator cross-subject revision and withdrawal contract."""

from datetime import date

from app.crud.user import user as user_crud
from app.models.activity_log import ActivityLog
from app.models.health_imports import HealthSourceDocument
from app.schemas.user import UserCreate

REVISE_PARAMS = {
    "admin_action": "owner_record_revise",
    "admin_action_reason": "根据成员确认修订资料",
}
VOID_PARAMS = {
    "admin_action": "owner_record_void",
    "admin_action_reason": "根据成员确认作废错误资料",
}
WITHDRAW_PARAMS = {
    "admin_action": "owner_source_withdraw",
    "admin_action_reason": "根据成员确认撤回错误原件",
}
RESTORE_PARAMS = {
    "admin_action": "owner_source_restore",
    "admin_action_reason": "复核后恢复误撤回原件",
}


def _background_payload(**overrides) -> dict:
    payload = {
        "category": "lifestyle",
        "title": "Synthetic member background",
        "narrative": "Synthetic narrative that must not enter administrator audit metadata.",
        "effective_date": "2026-07-01",
        "verification_status": "confirmed",
    }
    payload.update(overrides)
    return payload


def _coverage_payload(**overrides) -> dict:
    payload = {
        "exam_date": "2026-07-01",
        "metric_key": "synthetic-screening",
        "metric_name": "Synthetic screening",
        "absence_reason": "unknown",
        "verification_status": "confirmed",
        "note": "Synthetic note that must not enter administrator audit metadata.",
    }
    payload.update(overrides)
    return payload


def _maintenance_audits(db_session, patient_id: int) -> list[ActivityLog]:
    return [
        row
        for row in (
            db_session.query(ActivityLog)
            .filter(ActivityLog.patient_id == patient_id)
            .order_by(ActivityLog.id)
            .all()
        )
        if (row.event_metadata or {}).get("access_basis")
        == "owner_cross_subject_action"
    ]


def test_admin_cross_subject_revision_and_void_are_explicit_versioned_and_audited(
    client,
    db_session,
    test_admin_user,
    test_patient,
    user_token_headers,
    admin_token_headers,
):
    background = client.post(
        f"/api/v1/health-background/patients/{test_patient.id}",
        json=_background_payload(),
        headers=user_token_headers,
    ).json()
    coverage = client.post(
        f"/api/v1/health-coverage/patients/{test_patient.id}",
        json=_coverage_payload(),
        headers=user_token_headers,
    ).json()

    denied = client.post(
        f"/api/v1/health-background/entries/{background['id']}/revise",
        json=_background_payload(
            expected_version=1,
            change_note="Synthetic denied administrator revision",
        ),
        headers=admin_token_headers,
    )
    assert denied.status_code in {403, 404}

    read_only_spoof = client.post(
        f"/api/v1/health-background/entries/{background['id']}/revise",
        params={
            "admin_action": "global_read",
            "admin_action_reason": "试图使用只读能力写入",
        },
        json=_background_payload(
            expected_version=1,
            change_note="Synthetic rejected read-only capability",
        ),
        headers=admin_token_headers,
    )
    assert read_only_spoof.status_code == 403
    assert (
        read_only_spoof.headers["X-Error-Code"]
        == "explicit_owner_record_revise_required"
    )

    revised_response = client.post(
        f"/api/v1/health-background/entries/{background['id']}/revise",
        params=REVISE_PARAMS,
        json=_background_payload(
            narrative="Revised synthetic narrative kept only in the health revision.",
            expected_version=1,
            change_note="成员确认原记录描述有误",
        ),
        headers=admin_token_headers,
    )
    assert revised_response.status_code == 200, revised_response.text
    revised = revised_response.json()
    assert revised["version_number"] == 2
    assert revised["supersedes_entry_id"] == background["id"]
    assert revised["created_by_user_id"] == test_admin_user.id

    voided_response = client.post(
        f"/api/v1/health-coverage/statements/{coverage['id']}/void",
        params=VOID_PARAMS,
        json={
            "expected_version": 1,
            "reason": "成员确认该声明录入错误",
        },
        headers=admin_token_headers,
    )
    assert voided_response.status_code == 200, voided_response.text
    voided = voided_response.json()
    assert voided["status"] == "voided"
    assert voided["version_number"] == 2
    assert voided["supersedes_statement_id"] == coverage["id"]
    assert voided["created_by_user_id"] == test_admin_user.id

    audits = _maintenance_audits(db_session, test_patient.id)
    completed = [
        row for row in audits if (row.event_metadata or {}).get("result") == "completed"
    ]
    assert {row.event_metadata["capability"] for row in completed} >= {
        "owner_record_revise",
        "owner_record_void",
    }
    for row in completed:
        metadata = row.event_metadata or {}
        assert metadata["actor_user_id"] == test_admin_user.id
        assert metadata["target_patient_id"] == test_patient.id
        assert metadata["previous_version_number"] == 1
        assert metadata["resulting_version_number"] == 2
        assert metadata["previous_record_id"] in {background["id"], coverage["id"]}
        assert metadata["resulting_record_id"] in {revised["id"], voided["id"]}
        audit_text = str(metadata).lower()
        for forbidden in (
            "synthetic narrative",
            "synthetic note",
            "health_values",
            "category",
            "absence_reason",
            "verification_status",
            "password",
            "token",
            "secret",
        ):
            assert forbidden not in audit_text


def test_ordinary_member_cannot_spoof_admin_action_and_admin_read_stays_separate(
    client,
    test_patient,
    user_token_headers,
    admin_token_headers,
):
    created = client.post(
        f"/api/v1/health-background/patients/{test_patient.id}",
        json=_background_payload(),
        headers=user_token_headers,
    ).json()

    ordinary_spoof = client.post(
        f"/api/v1/health-background/entries/{created['id']}/void",
        params=VOID_PARAMS,
        json={"expected_version": 1, "reason": "试图伪造管理员操作"},
        headers=user_token_headers,
    )
    assert ordinary_spoof.status_code == 403
    assert ordinary_spoof.headers["X-Error-Code"] == "administrator_required"

    denied_read = client.get(
        f"/api/v1/health-background/patients/{test_patient.id}",
        headers=admin_token_headers,
    )
    assert denied_read.status_code in {403, 404}

    allowed_read = client.get(
        f"/api/v1/health-background/patients/{test_patient.id}",
        params={
            "owner_access": "global_read",
            "owner_access_reason": "维护前查看成员健康背景",
        },
        headers=admin_token_headers,
    )
    assert allowed_read.status_code == 200
    assert allowed_read.json()[0]["id"] == created["id"]


def test_admin_can_withdraw_and_restore_member_source_with_explicit_capabilities(
    client,
    db_session,
    test_admin_user,
    test_user,
    test_patient,
    admin_token_headers,
):
    source = HealthSourceDocument(
        patient_id=test_patient.id,
        created_by_user_id=test_user.id,
        display_name="Synthetic member source",
        original_filename="synthetic-member-source.pdf",
        document_type="checkup",
        report_date=date(2026, 7, 1),
        mime_type="application/pdf",
        size_bytes=100,
        sha256="d" * 64,
        storage_backend="local",
        status="uploaded",
    )
    db_session.add(source)
    db_session.commit()
    db_session.refresh(source)

    dependencies = client.get(
        f"/api/v1/health-imports/source-documents/{source.id}/dependencies",
        params=WITHDRAW_PARAMS,
        headers=admin_token_headers,
    )
    assert dependencies.status_code == 200, dependencies.text

    withdrawn = client.post(
        f"/api/v1/health-imports/source-documents/{source.id}/withdraw",
        params=WITHDRAW_PARAMS,
        json={"reason": "成员确认该原件上传错误"},
        headers=admin_token_headers,
    )
    assert withdrawn.status_code == 200, withdrawn.text
    assert withdrawn.json()["document"]["status"] == "archived"
    assert withdrawn.json()["document"]["withdrawn_by_user_id"] == test_admin_user.id

    wrong_restore_capability = client.post(
        f"/api/v1/health-imports/source-documents/{source.id}/restore",
        params=WITHDRAW_PARAMS,
        headers=admin_token_headers,
    )
    assert wrong_restore_capability.status_code == 403
    assert (
        wrong_restore_capability.headers["X-Error-Code"]
        == "explicit_owner_source_restore_required"
    )

    restored = client.post(
        f"/api/v1/health-imports/source-documents/{source.id}/restore",
        params=RESTORE_PARAMS,
        headers=admin_token_headers,
    )
    assert restored.status_code == 200, restored.text
    assert restored.json()["document"]["status"] == "uploaded"

    completed = [
        row.event_metadata or {}
        for row in _maintenance_audits(db_session, test_patient.id)
        if (row.event_metadata or {}).get("result") == "completed"
    ]
    assert {metadata["capability"] for metadata in completed} >= {
        "owner_source_withdraw",
        "owner_source_restore",
    }
    for metadata in completed:
        if metadata["capability"].startswith("owner_source_"):
            assert metadata["object_type"] == "health_source_document"
            assert metadata["object_id"] == source.id
            assert metadata["actor_user_id"] == test_admin_user.id
            assert metadata["target_patient_id"] == test_patient.id
            assert "original_filename" not in metadata


def test_cross_subject_action_fails_closed_when_second_admin_is_active(
    client,
    db_session,
    test_patient,
    user_token_headers,
    admin_token_headers,
):
    background = client.post(
        f"/api/v1/health-background/patients/{test_patient.id}",
        json=_background_payload(),
        headers=user_token_headers,
    ).json()
    second_admin = user_crud.create(
        db_session,
        obj_in=UserCreate(
            username="secondmaintenanceadmin",
            email="second-maintenance-admin@synthetic.healthbox.example",
            password="SyntheticPassword123",
            full_name="Second Synthetic Maintenance Admin",
            role="admin",
        ),
    )
    assert second_admin.is_active

    response = client.post(
        f"/api/v1/health-background/entries/{background['id']}/void",
        params=VOID_PARAMS,
        json={"expected_version": 1, "reason": "多管理员状态下应拒绝"},
        headers=admin_token_headers,
    )
    assert response.status_code == 409
    assert response.headers["X-Error-Code"] == "sole_active_administrator_required"
