"""Synthetic API contract for the default-off administrator upload capability."""

import os

from app.crud.user import user as user_crud
from app.models.activity_log import ActivityLog
from app.models.files import EntityFile
from app.models.health_imports import HealthSourceDocument, HealthSourceUploadBatch
from app.schemas.user import UserCreate
from tests.utils.user import create_user_token_headers

SYNTHETIC_PDF = b"%PDF-1.4\n% synthetic delegated upload fixture\n%%EOF\n"
CAPABILITY_PARAMS = {
    "delegated_upload": "delegated_upload",
    "delegated_upload_reason": "协助成员保存体检报告",
}


def _manifest_payload(key: str = "delegated-upload-synthetic-0001") -> dict:
    return {
        "idempotency_key": key,
        "document_type": "checkup",
        "report_date": "2026-07-27",
        "facility": "虚构体检机构",
        "documents": [
            {
                "client_item_id": "synthetic-file-1",
                "sequence": 1,
                "original_filename": "synthetic-report.pdf",
                "mime_type": "application/pdf",
                "size_bytes": len(SYNTHETIC_PDF),
            }
        ],
    }


def _set_capability(client, headers, enabled: bool):
    return client.put(
        "/api/v1/admin/delegated-upload/settings",
        json={
            "enabled": enabled,
            "reason": "特殊情况下协助成员留存原件",
        },
        headers=headers,
    )


def test_delegated_upload_is_default_off_and_ordinary_members_cannot_enable_or_spoof(
    client,
    test_patient,
    user_token_headers,
    admin_token_headers,
):
    settings_response = client.get(
        "/api/v1/admin/delegated-upload/settings",
        headers=admin_token_headers,
    )
    assert settings_response.status_code == 200
    assert settings_response.json() == {
        "enabled": False,
        "capability": "delegated_upload",
        "disclosure": "管理员代上传默认关闭；启用和每次使用都会记录",
    }

    ordinary_toggle = _set_capability(client, user_token_headers, True)
    assert ordinary_toggle.status_code == 403

    disabled_attempt = client.post(
        f"/api/v1/health-imports/patients/{test_patient.id}/source-upload-batches",
        params=CAPABILITY_PARAMS,
        json=_manifest_payload(),
        headers=admin_token_headers,
    )
    assert disabled_attempt.status_code == 403
    assert disabled_attempt.headers["X-Error-Code"] == "delegated_upload_disabled"

    ordinary_spoof = client.post(
        f"/api/v1/health-imports/patients/{test_patient.id}/source-upload-batches",
        params=CAPABILITY_PARAMS,
        json=_manifest_payload("delegated-upload-synthetic-0002"),
        headers=user_token_headers,
    )
    assert ordinary_spoof.status_code == 403

    reason_only_spoof = client.post(
        f"/api/v1/health-imports/patients/{test_patient.id}/source-upload-batches",
        params={"delegated_upload_reason": "试图只提交原因绕过能力检查"},
        json=_manifest_payload("delegated-upload-synthetic-0003"),
        headers=user_token_headers,
    )
    assert reason_only_spoof.status_code == 403
    assert (
        reason_only_spoof.headers["X-Error-Code"]
        == "explicit_delegated_upload_required"
    )


def test_enabled_delegated_upload_preserves_target_actor_scope_and_audit(
    client,
    db_session,
    test_admin_user,
    test_patient,
    admin_token_headers,
):
    enabled = _set_capability(client, admin_token_headers, True)
    assert enabled.status_code == 200, enabled.text
    assert enabled.json()["enabled"] is True

    batch_response = client.post(
        f"/api/v1/health-imports/patients/{test_patient.id}/source-upload-batches",
        params=CAPABILITY_PARAMS,
        json=_manifest_payload(),
        headers=admin_token_headers,
    )
    assert batch_response.status_code == 201, batch_response.text
    batch_payload = batch_response.json()
    assert batch_payload["patient_id"] == test_patient.id
    assert batch_payload["created_by_user_id"] == test_admin_user.id

    item_id = batch_payload["items"][0]["id"]
    upload_response = client.post(
        "/api/v1/health-imports/source-documents",
        data={
            "patient_id": str(test_patient.id),
            "display_name": "虚构代上传体检报告",
            "document_type": "checkup",
            "report_date": "2026-07-27",
            "facility": "虚构体检机构",
            "source_upload_batch_id": str(batch_payload["id"]),
            "source_upload_item_id": str(item_id),
            **CAPABILITY_PARAMS,
        },
        files={
            "file": (
                "synthetic-report.pdf",
                SYNTHETIC_PDF,
                "application/pdf",
            )
        },
        headers=admin_token_headers,
    )
    assert upload_response.status_code == 201, upload_response.text
    source_payload = upload_response.json()

    source = (
        db_session.query(HealthSourceDocument)
        .filter(HealthSourceDocument.id == source_payload["id"])
        .one()
    )
    assert source.patient_id == test_patient.id
    assert source.created_by_user_id == test_admin_user.id

    completed = client.post(
        f"/api/v1/health-imports/source-upload-batches/{batch_payload['id']}/complete",
        params=CAPABILITY_PARAMS,
        headers=admin_token_headers,
    )
    assert completed.status_code == 200, completed.text
    assert completed.json()["status"] == "completed"

    delegated_audits = (
        db_session.query(ActivityLog)
        .filter(
            ActivityLog.user_id == test_admin_user.id,
            ActivityLog.patient_id == test_patient.id,
        )
        .all()
    )
    completed_actions = [
        log
        for log in delegated_audits
        if (log.event_metadata or {}).get("capability") == "delegated_upload"
        and (log.event_metadata or {}).get("result") == "completed"
    ]
    assert completed_actions
    for log in completed_actions:
        metadata = log.event_metadata or {}
        assert metadata["actor_user_id"] == test_admin_user.id
        assert metadata["target_patient_id"] == test_patient.id
        assert metadata["reason"] == CAPABILITY_PARAMS["delegated_upload_reason"]
        assert "file_content" not in metadata
        assert "file_path" not in metadata

    dependencies = client.get(
        f"/api/v1/health-imports/source-documents/{source.id}/dependencies",
        params=CAPABILITY_PARAMS,
        headers=admin_token_headers,
    )
    assert dependencies.status_code == 200

    withdrawn = client.post(
        f"/api/v1/health-imports/source-documents/{source.id}/withdraw",
        params=CAPABILITY_PARAMS,
        json={"reason": "成员确认报告上传错误"},
        headers=admin_token_headers,
    )
    assert withdrawn.status_code == 200, withdrawn.text
    assert withdrawn.json()["document"]["status"] == "archived"
    assert withdrawn.json()["document"]["withdrawn_by_user_id"] == test_admin_user.id

    disabled = _set_capability(client, admin_token_headers, False)
    assert disabled.status_code == 200
    assert disabled.json()["enabled"] is False

    blocked_restore = client.post(
        f"/api/v1/health-imports/source-documents/{source.id}/restore",
        params=CAPABILITY_PARAMS,
        headers=admin_token_headers,
    )
    assert blocked_restore.status_code == 403
    assert blocked_restore.headers["X-Error-Code"] == "delegated_upload_disabled"

    retained_source = (
        db_session.query(HealthSourceDocument)
        .filter(HealthSourceDocument.id == source.id)
        .one()
    )
    assert retained_source.status == "archived"

    entity_file = (
        db_session.query(EntityFile)
        .filter(EntityFile.id == source.primary_file_id)
        .first()
    )
    if entity_file and entity_file.file_path and os.path.exists(entity_file.file_path):
        os.remove(entity_file.file_path)


def test_delegated_upload_cannot_operate_another_actors_batch_or_source(
    client,
    db_session,
    test_admin_user,
    test_user,
    test_patient,
    admin_token_headers,
):
    assert _set_capability(client, admin_token_headers, True).status_code == 200

    owner_batch = HealthSourceUploadBatch(
        patient_id=test_patient.id,
        created_by_user_id=test_user.id,
        idempotency_key="owner-created-batch",
        manifest_sha256="a" * 64,
        document_type="checkup",
        status="open",
        expected_file_count=1,
        expected_total_bytes=100,
    )
    owner_source = HealthSourceDocument(
        patient_id=test_patient.id,
        created_by_user_id=test_user.id,
        display_name="成员自己的虚构报告",
        original_filename="member.pdf",
        document_type="checkup",
        mime_type="application/pdf",
        size_bytes=100,
        sha256="b" * 64,
        storage_backend="local",
        status="uploaded",
    )
    db_session.add_all([owner_batch, owner_source])
    db_session.commit()

    batch_probe = client.get(
        f"/api/v1/health-imports/source-upload-batches/{owner_batch.id}",
        params=CAPABILITY_PARAMS,
        headers=admin_token_headers,
    )
    assert batch_probe.status_code == 404

    source_probe = client.get(
        f"/api/v1/health-imports/source-documents/{owner_source.id}/dependencies",
        params=CAPABILITY_PARAMS,
        headers=admin_token_headers,
    )
    assert source_probe.status_code == 404


def test_capability_fails_closed_when_sole_administrator_invariant_breaks(
    client,
    db_session,
    admin_token_headers,
):
    second_admin = user_crud.create(
        db_session,
        obj_in=UserCreate(
            username="seconddelegatedadmin",
            email="second-delegated-admin@synthetic.healthbox.example",
            password="SyntheticPassword123",
            full_name="Second Synthetic Admin",
            role="admin",
        ),
    )
    assert second_admin.is_active

    response = _set_capability(client, admin_token_headers, True)
    assert response.status_code == 409
    assert response.headers["X-Error-Code"] == "sole_active_administrator_required"

    second_headers = create_user_token_headers(second_admin.username)
    second_response = _set_capability(client, second_headers, True)
    assert second_response.status_code in {401, 403, 409}
