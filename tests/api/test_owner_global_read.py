"""Explicit, audited sole-administrator global-read contract tests."""

from datetime import date

from app.crud.user import user as user_crud
from app.models.activity_log import ActivityLog
from app.models.base import get_utc_now
from app.models.files import EntityFile
from app.models.health_imports import HealthSourceDocument
from app.schemas.user import UserCreate


def _audit_rows(db_session, patient_id: int) -> list[ActivityLog]:
    return (
        db_session.query(ActivityLog)
        .filter(
            ActivityLog.patient_id == patient_id,
            ActivityLog.action == "viewed",
        )
        .order_by(ActivityLog.id)
        .all()
    )


def test_owner_subject_directory_is_explicit_and_minimal(
    client,
    admin_token_headers,
    test_admin_user,
    test_user,
    test_patient,
):
    response = client.get(
        "/api/v1/admin/owner-access/subjects",
        headers=admin_token_headers,
    )

    assert response.status_code == 200
    payload = response.json()
    target = next(item for item in payload["subjects"] if item["id"] == test_patient.id)
    assert target == {
        "id": test_patient.id,
        "first_name": test_patient.first_name,
        "last_name": test_patient.last_name,
        "owner_user_id": test_user.id,
        "access_basis": "owner_global_read",
        "permission_level": "owner_global_read",
    }
    assert payload["disclosure"] == "管理员查看会被记录"
    assert "address" not in target
    assert "birth_date" not in target


def test_ordinary_member_cannot_list_owner_subjects(
    client,
    user_token_headers,
):
    response = client.get(
        "/api/v1/admin/owner-access/subjects",
        headers=user_token_headers,
    )
    assert response.status_code in (401, 403)


def test_cross_subject_vitals_require_explicit_capability_and_create_safe_audit(
    client,
    db_session,
    admin_token_headers,
    test_admin_user,
    test_user,
    test_patient,
):
    denied = client.get(
        "/api/v1/vitals/",
        params={"patient_id": test_patient.id, "limit": 5},
        headers=admin_token_headers,
    )
    assert denied.status_code in (403, 404)
    assert _audit_rows(db_session, test_patient.id) == []

    allowed = client.get(
        "/api/v1/vitals/",
        params={
            "patient_id": test_patient.id,
            "limit": 5,
            "owner_access": "global_read",
            "owner_access_reason": "查看家庭健康趋势",
        },
        headers=admin_token_headers,
    )
    assert allowed.status_code == 200

    audits = _audit_rows(db_session, test_patient.id)
    assert len(audits) == 1
    audit = audits[0]
    assert audit.user_id == test_admin_user.id
    assert audit.entity_id == test_patient.id
    assert audit.event_metadata == {
        "actor_user_id": test_admin_user.id,
        "target_patient_id": test_patient.id,
        "access_basis": "owner_global_read",
        "resource": "vitals",
        "purpose": "查看家庭健康趋势",
        "request_method": "GET",
        "request_path": "/api/v1/vitals/",
        "result": "allowed",
    }
    audit_text = str(audit.event_metadata).lower()
    for forbidden in (
        "health_values",
        "password",
        "token",
        "secret",
        "report_text",
    ):
        assert forbidden not in audit_text


def test_owner_global_read_supports_dashboard_lab_and_source_metadata_only(
    client,
    db_session,
    admin_token_headers,
    test_admin_user,
    test_user,
    test_patient,
):
    source = HealthSourceDocument(
        patient_id=test_patient.id,
        created_by_user_id=test_user.id,
        display_name="虚构报告",
        original_filename="synthetic.pdf",
        document_type="checkup",
        report_date=date(2026, 1, 1),
        facility="虚构机构",
        mime_type="application/pdf",
        size_bytes=123,
        sha256="a" * 64,
        storage_backend="local",
        status="uploaded",
    )
    db_session.add(source)
    db_session.commit()

    common = {
        "owner_access": "global_read",
        "owner_access_reason": "核对家庭档案",
    }
    catalog = client.get(
        f"/api/v1/lab-test-components/patient/{test_patient.id}/component-catalog",
        params=common,
        headers=admin_token_headers,
    )
    documents = client.get(
        f"/api/v1/health-imports/patients/{test_patient.id}/source-documents",
        params=common,
        headers=admin_token_headers,
    )

    assert catalog.status_code == 200
    assert documents.status_code == 200
    assert documents.json()[0]["id"] == source.id
    resources = [
        row.event_metadata["resource"]
        for row in _audit_rows(db_session, test_patient.id)
    ]
    assert resources == ["lab_component_catalog", "source_document_metadata"]


def test_owner_global_read_fails_closed_with_two_active_administrators(
    client,
    db_session,
    admin_token_headers,
    test_admin_user,
    test_user,
    test_patient,
):
    user_crud.create(
        db_session,
        obj_in=UserCreate(
            username="secondadmin",
            email="secondadmin@example.com",
            password="SecondAdminPassword123",
            full_name="Second Admin",
            role="admin",
        ),
    )

    response = client.get(
        "/api/v1/vitals/",
        params={
            "patient_id": test_patient.id,
            "owner_access": "global_read",
            "owner_access_reason": "查看家庭健康趋势",
        },
        headers=admin_token_headers,
    )

    assert response.status_code == 409
    assert _audit_rows(db_session, test_patient.id) == []


def test_owner_global_read_service_refuses_write_methods(
    db_session,
    test_admin_user,
    test_patient,
):
    from app.services.owner_access_service import OwnerAccessError
    from app.services.owner_access_service import authorize_owner_global_read

    try:
        authorize_owner_global_read(
            db_session,
            actor=test_admin_user,
            patient=test_patient,
            requested_capability="global_read",
            purpose="尝试写入",
            resource="vitals",
            request_method="POST",
            request_path=f"/api/v1/vitals/patient/{test_patient.id}/vitals/",
        )
    except OwnerAccessError as error:
        assert error.code == "owner_global_read_is_read_only"
    else:
        raise AssertionError("Global read unexpectedly authorized a write method")


def test_owner_source_download_is_explicit_audited_and_content_safe(
    client,
    db_session,
    admin_token_headers,
    user_token_headers,
    test_admin_user,
    test_user,
    test_patient,
    tmp_path,
):
    content = b"%PDF-1.4\nsynthetic owner download\n%%EOF\n"
    stored_file = tmp_path / "stored-source.pdf"
    stored_file.write_bytes(content)
    source = HealthSourceDocument(
        patient_id=test_patient.id,
        created_by_user_id=test_user.id,
        display_name="虚构原件",
        original_filename="synthetic-report.pdf",
        document_type="checkup",
        report_date=date(2026, 1, 1),
        facility="虚构机构",
        mime_type="application/pdf",
        size_bytes=len(content),
        sha256="b" * 64,
        storage_backend="local",
        status="uploaded",
    )
    db_session.add(source)
    db_session.flush()
    entity_file = EntityFile(
        entity_type="source-document",
        entity_id=source.id,
        file_name=source.original_filename,
        file_path=str(stored_file),
        file_type=source.mime_type,
        file_size=len(content),
        uploaded_at=get_utc_now(),
        storage_backend="local",
        sync_status="synced",
    )
    db_session.add(entity_file)
    db_session.flush()
    source.primary_file_id = entity_file.id
    db_session.commit()

    path = f"/api/v1/health-imports/source-documents/{source.id}/download"
    owner_download = client.get(path, headers=user_token_headers)
    denied_implicit = client.get(path, headers=admin_token_headers)
    allowed = client.get(
        path,
        params={
            "owner_access": "global_read",
            "owner_access_reason": "下载家庭报告原件",
        },
        headers=admin_token_headers,
    )

    assert owner_download.status_code == 200
    assert owner_download.content == content
    assert denied_implicit.status_code in (403, 404)
    assert allowed.status_code == 200
    assert allowed.content == content
    assert allowed.headers["cache-control"] == "no-store"
    assert "synthetic-report.pdf" in allowed.headers["content-disposition"]

    audit = (
        db_session.query(ActivityLog)
        .filter(
            ActivityLog.patient_id == test_patient.id,
            ActivityLog.action == "downloaded",
        )
        .one()
    )
    assert audit.user_id == test_admin_user.id
    assert audit.entity_type == "health_source_document"
    assert audit.entity_id == source.id
    assert audit.event_metadata == {
        "actor_user_id": test_admin_user.id,
        "target_patient_id": test_patient.id,
        "access_basis": "owner_global_read",
        "resource": "source_document_download",
        "purpose": "下载家庭报告原件",
        "request_method": "GET",
        "request_path": path,
        "result": "allowed",
        "source_document_id": source.id,
    }
    assert str(content) not in str(audit.event_metadata)


def test_owner_source_download_fails_before_audit_when_file_binding_is_invalid(
    client,
    db_session,
    admin_token_headers,
    test_user,
    test_patient,
):
    source = HealthSourceDocument(
        patient_id=test_patient.id,
        created_by_user_id=test_user.id,
        display_name="缺失原件",
        original_filename="missing.pdf",
        document_type="checkup",
        mime_type="application/pdf",
        size_bytes=10,
        sha256="c" * 64,
        storage_backend="local",
        status="uploaded",
    )
    db_session.add(source)
    db_session.commit()

    response = client.get(
        f"/api/v1/health-imports/source-documents/{source.id}/download",
        params={
            "owner_access": "global_read",
            "owner_access_reason": "下载家庭报告原件",
        },
        headers=admin_token_headers,
    )

    assert response.status_code == 404
    assert (
        db_session.query(ActivityLog)
        .filter(
            ActivityLog.patient_id == test_patient.id,
            ActivityLog.action == "downloaded",
        )
        .count()
        == 0
    )


def test_owner_source_preview_is_inline_explicit_and_safely_audited(
    client,
    db_session,
    admin_token_headers,
    user_token_headers,
    test_admin_user,
    test_user,
    test_patient,
    tmp_path,
):
    content = b"%PDF-1.4\nsynthetic owner preview\n%%EOF\n"
    stored_file = tmp_path / "preview-source.pdf"
    stored_file.write_bytes(content)
    source = HealthSourceDocument(
        patient_id=test_patient.id,
        created_by_user_id=test_user.id,
        display_name="虚构预览原件",
        original_filename="synthetic-preview.pdf",
        document_type="checkup",
        report_date=date(2026, 1, 1),
        facility="虚构机构",
        mime_type="application/pdf",
        size_bytes=len(content),
        sha256="d" * 64,
        storage_backend="local",
        status="uploaded",
    )
    db_session.add(source)
    db_session.flush()
    entity_file = EntityFile(
        entity_type="source-document",
        entity_id=source.id,
        file_name=source.original_filename,
        file_path=str(stored_file),
        file_type=source.mime_type,
        file_size=len(content),
        uploaded_at=get_utc_now(),
        storage_backend="local",
        sync_status="synced",
    )
    db_session.add(entity_file)
    db_session.flush()
    source.primary_file_id = entity_file.id
    db_session.commit()

    path = f"/api/v1/health-imports/source-documents/{source.id}/preview"
    owner_preview = client.get(path, headers=user_token_headers)
    denied_implicit = client.get(path, headers=admin_token_headers)
    allowed = client.get(
        path,
        params={
            "owner_access": "global_read",
            "owner_access_reason": "预览家庭报告原件",
        },
        headers=admin_token_headers,
    )

    assert owner_preview.status_code == 200
    assert owner_preview.content == content
    assert owner_preview.headers["content-disposition"].startswith("inline")
    assert denied_implicit.status_code in (403, 404)
    assert allowed.status_code == 200
    assert allowed.content == content
    assert allowed.headers["cache-control"] == "no-store"
    assert allowed.headers["x-content-type-options"] == "nosniff"
    assert "sandbox" in allowed.headers["content-security-policy"]
    assert allowed.headers["content-disposition"].startswith("inline")

    audit = (
        db_session.query(ActivityLog)
        .filter(
            ActivityLog.patient_id == test_patient.id,
            ActivityLog.action == "viewed",
            ActivityLog.entity_type == "health_source_document",
            ActivityLog.entity_id == source.id,
        )
        .one()
    )
    assert audit.user_id == test_admin_user.id
    assert audit.event_metadata == {
        "actor_user_id": test_admin_user.id,
        "target_patient_id": test_patient.id,
        "access_basis": "owner_global_read",
        "resource": "source_document_preview",
        "purpose": "预览家庭报告原件",
        "request_method": "GET",
        "request_path": path,
        "result": "allowed",
        "source_document_id": source.id,
    }
    assert str(content) not in str(audit.event_metadata)


def test_owner_source_preview_rejects_unsupported_format_before_audit(
    client,
    db_session,
    admin_token_headers,
    test_user,
    test_patient,
    tmp_path,
):
    content = b"\x00\x00\x00\x18ftypheic" + b"\x00" * 16
    stored_file = tmp_path / "preview-source.heic"
    stored_file.write_bytes(content)
    source = HealthSourceDocument(
        patient_id=test_patient.id,
        created_by_user_id=test_user.id,
        display_name="虚构 HEIC 原件",
        original_filename="synthetic-preview.heic",
        document_type="checkup",
        report_date=date(2026, 1, 1),
        facility="虚构机构",
        mime_type="image/heic",
        size_bytes=len(content),
        sha256="e" * 64,
        storage_backend="local",
        status="uploaded",
    )
    db_session.add(source)
    db_session.flush()
    entity_file = EntityFile(
        entity_type="source-document",
        entity_id=source.id,
        file_name=source.original_filename,
        file_path=str(stored_file),
        file_type=source.mime_type,
        file_size=len(content),
        uploaded_at=get_utc_now(),
        storage_backend="local",
        sync_status="synced",
    )
    db_session.add(entity_file)
    db_session.flush()
    source.primary_file_id = entity_file.id
    db_session.commit()

    response = client.get(
        f"/api/v1/health-imports/source-documents/{source.id}/preview",
        params={
            "owner_access": "global_read",
            "owner_access_reason": "预览家庭报告原件",
        },
        headers=admin_token_headers,
    )

    assert response.status_code == 415
    assert (
        db_session.query(ActivityLog)
        .filter(
            ActivityLog.patient_id == test_patient.id,
            ActivityLog.entity_type == "health_source_document",
            ActivityLog.entity_id == source.id,
        )
        .count()
        == 0
    )


def test_owner_dashboard_handoff_is_explicit_audited_and_value_safe(
    client,
    db_session,
    admin_token_headers,
    test_admin_user,
    test_patient,
):
    path = f"/api/v1/admin/owner-access/patients/{test_patient.id}/dashboard-handoff"
    denied_implicit = client.get(
        path,
        params={
            "handoff_kind": "csv",
            "scope": "recent-five-years",
            "include_reports": True,
            "metric_count": 2,
            "report_count": 1,
        },
        headers=admin_token_headers,
    )
    allowed = client.get(
        path,
        params={
            "owner_access": "global_read",
            "owner_access_reason": "导出家庭健康面板摘要",
            "handoff_kind": "csv",
            "scope": "recent-five-years",
            "include_reports": True,
            "metric_count": 2,
            "report_count": 1,
        },
        headers=admin_token_headers,
    )

    assert denied_implicit.status_code == 403
    assert allowed.status_code == 200
    assert allowed.headers["cache-control"] == "no-store"
    assert allowed.json() == {
        "status": "authorized",
        "patient_id": test_patient.id,
        "access_basis": "owner_global_read",
        "handoff_kind": "csv",
        "scope": "recent-five-years",
        "include_reports": True,
        "metric_count": 2,
        "report_count": 1,
        "audit_recorded": True,
    }

    audit = (
        db_session.query(ActivityLog)
        .filter(
            ActivityLog.patient_id == test_patient.id,
            ActivityLog.action == "exported",
        )
        .one()
    )
    assert audit.user_id == test_admin_user.id
    assert audit.entity_type == "patient"
    assert audit.entity_id == test_patient.id
    assert audit.event_metadata == {
        "actor_user_id": test_admin_user.id,
        "target_patient_id": test_patient.id,
        "access_basis": "owner_global_read",
        "resource": "dashboard_export",
        "purpose": "导出家庭健康面板摘要",
        "request_method": "GET",
        "request_path": path,
        "result": "allowed",
        "handoff_kind": "csv",
        "handoff_scope": "recent-five-years",
        "include_reports": True,
        "metric_count": 2,
        "report_count": 1,
    }
    assert "health_values" not in audit.event_metadata
    assert "metric_ids" not in audit.event_metadata


def test_owner_dashboard_handoff_rejects_invalid_or_ai_transfer_without_audit(
    client,
    db_session,
    admin_token_headers,
    test_patient,
):
    path = f"/api/v1/admin/owner-access/patients/{test_patient.id}/dashboard-handoff"
    invalid_kind = client.get(
        path,
        params={
            "owner_access": "global_read",
            "owner_access_reason": "复制家庭健康面板摘要",
            "handoff_kind": "clipboard_ai",
            "scope": "all-loaded",
            "include_reports": False,
            "metric_count": 1,
            "report_count": 0,
        },
        headers=admin_token_headers,
    )
    invalid_count = client.get(
        path,
        params={
            "owner_access": "global_read",
            "owner_access_reason": "导出家庭健康面板摘要",
            "handoff_kind": "csv",
            "scope": "all-loaded",
            "include_reports": False,
            "metric_count": 201,
            "report_count": 0,
        },
        headers=admin_token_headers,
    )

    assert invalid_kind.status_code == 422
    assert invalid_count.status_code == 422
    assert (
        db_session.query(ActivityLog)
        .filter(
            ActivityLog.patient_id == test_patient.id,
            ActivityLog.action == "exported",
        )
        .count()
        == 0
    )
