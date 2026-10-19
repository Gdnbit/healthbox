import hashlib
import io
import json
import zipfile
from datetime import date
from pathlib import Path

from fastapi.testclient import TestClient
from sqlalchemy.orm import Session

from app.core.config import settings
from app.models.activity_log import ActivityLog
from app.models.base import get_utc_now
from app.models.files import EntityFile
from app.models.health_archive_export import HealthArchiveExport
from app.models.health_imports import (
    HealthFormalMetricRevision,
    HealthImportBatch,
    HealthSourceDocument,
    HealthSourceSimilarityRelation,
)
from app.models.labs import LabResult, LabTestComponent
from app.models.patient import Patient
from app.models.user import User
from app.services.health_archive_export_service import (
    health_archive_export_service,
)
from app.services.health_archive_export_worker import (
    health_archive_export_worker,
)

SYNTHETIC_REPORT = b"%PDF-1.4\n% synthetic complete archive report\n%%EOF\n"


def _create_source(
    db: Session,
    *,
    patient: Patient,
    actor: User,
    source_path: Path,
    expected_sha256: str | None = None,
    status: str = "uploaded",
) -> HealthSourceDocument:
    source_path.parent.mkdir(parents=True, exist_ok=True)
    source_path.write_bytes(SYNTHETIC_REPORT)
    actual_sha256 = hashlib.sha256(SYNTHETIC_REPORT).hexdigest()
    source = HealthSourceDocument(
        patient_id=patient.id,
        created_by_user_id=actor.id,
        display_name="虚构年度体检报告",
        original_filename="synthetic-checkup.pdf",
        document_type="checkup",
        report_date=date(2026, 6, 18),
        facility="虚构体检中心",
        mime_type="application/pdf",
        size_bytes=len(SYNTHETIC_REPORT),
        sha256=expected_sha256 or actual_sha256,
        storage_backend="local",
        status=status,
    )
    db.add(source)
    db.flush()
    entity_file = EntityFile(
        entity_type="source-document",
        entity_id=source.id,
        file_name=source.original_filename,
        file_path=str(source_path),
        file_type=source.mime_type,
        file_size=source.size_bytes,
        uploaded_at=get_utc_now(),
        storage_backend="local",
    )
    db.add(entity_file)
    db.flush()
    source.primary_file_id = entity_file.id
    db.commit()
    db.refresh(source)
    return source


def _create_archive(
    client: TestClient,
    *,
    patient_id: int,
    key: str = "synthetic-complete-archive-0001",
):
    return client.post(
        "/api/v1/export/archives",
        json={"patient_id": patient_id, "idempotency_key": key},
    )


def test_complete_archive_contains_structured_data_originals_manifest_and_audit(
    authenticated_client: TestClient,
    db_session: Session,
    test_user: User,
    test_patient: Patient,
    tmp_path: Path,
    monkeypatch,
):
    monkeypatch.setattr(settings, "BACKUP_DIR", tmp_path / "backups")
    monkeypatch.setattr(settings, "UPLOAD_DIR", tmp_path / "uploads")
    source = _create_source(
        db_session,
        patient=test_patient,
        actor=test_user,
        source_path=(
            settings.UPLOAD_DIR / "files" / "source-documents" / "synthetic-checkup.pdf"
        ),
        status="archived",
    )
    related_source = _create_source(
        db_session,
        patient=test_patient,
        actor=test_user,
        source_path=(
            settings.UPLOAD_DIR
            / "files"
            / "source-documents"
            / "synthetic-checkup-related.pdf"
        ),
    )
    relation = HealthSourceSimilarityRelation(
        patient_id=test_patient.id,
        source_document_id=min(source.id, related_source.id),
        related_source_document_id=max(source.id, related_source.id),
        relation_type="partial_overlap",
        confidence=0.88,
        algorithm_version="source-image-similarity@1.0.0",
        evidence={
            "matched_region_ratio": 0.61,
            "source_unique_ratio": 0.39,
            "related_unique_ratio": 0.39,
            "orientation": "vertical",
            "explanation_code": "shared_vertical_bands",
        },
        review_status="confirmed",
        reviewed_by_user_id=test_user.id,
        reviewed_at=get_utc_now(),
    )
    db_session.add(relation)
    confirmed_at = get_utc_now()
    import_batch = HealthImportBatch(
        patient_id=test_patient.id,
        source_document_id=source.id,
        created_by_user_id=test_user.id,
        idempotency_key="synthetic-subject-mismatch-archive",
        parser_name="local_core_labs",
        parser_version="1.0.0",
        status="committed",
        summary={"accepted": 0, "rejected": 0},
        subject_identity_status="suspected_mismatch",
        subject_identity_observed_name="Different Person",
        subject_identity_confidence=0.93,
        subject_identity_assessment_version="subject-identity-assessment@1.0.0",
        subject_identity_evidence={
            "assessment_version": "subject-identity-assessment@1.0.0",
            "label_code": "patient_name",
            "candidate_count": 1,
        },
        subject_mismatch_confirmed_by_user_id=test_user.id,
        subject_mismatch_confirmed_at=confirmed_at,
        reviewed_at=confirmed_at,
        committed_at=confirmed_at,
    )
    db_session.add(import_batch)
    db_session.flush()
    lab_result = LabResult(
        patient_id=test_patient.id,
        test_name="虚构年度体检报告",
        status="completed",
        completed_date=date(2026, 6, 18),
        is_panel=True,
        created_at=confirmed_at,
        updated_at=confirmed_at,
    )
    db_session.add(lab_result)
    db_session.flush()
    component = LabTestComponent(
        lab_result_id=lab_result.id,
        test_name="虚构指标甲",
        canonical_test_name="Synthetic Metric A",
        result_type="quantitative",
        value=13.2,
        unit="unit/L",
        ref_range_min=10.0,
        ref_range_max=15.0,
        status="normal",
        source_document_id=source.id,
        source_page=2,
        source_locator="table-1-row-2",
        import_batch_id=import_batch.id,
        created_at=confirmed_at,
        updated_at=confirmed_at,
    )
    db_session.add(component)
    db_session.flush()
    initial_revision = HealthFormalMetricRevision(
        component_id=component.id,
        patient_id=test_patient.id,
        version=1,
        action="created",
        idempotency_key=f"initial:{import_batch.id}:{component.id}",
        request_hash="0" * 64,
        result_type="quantitative",
        numeric_value=12.5,
        unit="unit/L",
        ref_range_min=10.0,
        ref_range_max=15.0,
        result_status="normal",
        created_by_user_id=test_user.id,
        created_at=confirmed_at,
    )
    db_session.add(initial_revision)
    db_session.flush()
    revised_at = get_utc_now()
    revised_revision = HealthFormalMetricRevision(
        component_id=component.id,
        patient_id=test_patient.id,
        version=2,
        action="revised",
        supersedes_revision_id=initial_revision.id,
        reason="修正自动识别时的小数点错误",
        idempotency_key="synthetic-archive-revision-0001",
        request_hash="1" * 64,
        result_type="quantitative",
        numeric_value=13.2,
        unit="unit/L",
        ref_range_min=10.0,
        ref_range_max=15.0,
        result_status="normal",
        created_by_user_id=test_user.id,
        created_at=revised_at,
    )
    db_session.add(revised_revision)
    db_session.commit()

    created = _create_archive(authenticated_client, patient_id=test_patient.id)
    assert created.status_code == 202, created.text
    export_id = created.json()["id"]

    repeated = _create_archive(authenticated_client, patient_id=test_patient.id)
    assert repeated.status_code == 202, repeated.text
    assert repeated.json()["id"] == export_id

    status_response = authenticated_client.get(f"/api/v1/export/archives/{export_id}")
    assert status_response.status_code == 200, status_response.text
    export_status = status_response.json()
    assert export_status["status"] == "ready"
    assert export_status["can_download"] is True
    assert export_status["original_count"] == 2
    assert export_status["archive_sha256"]
    assert export_status["archive_size_bytes"] > len(SYNTHETIC_REPORT)
    assert "archive_path" not in export_status

    download = authenticated_client.get(f"/api/v1/export/archives/{export_id}/download")
    assert download.status_code == 200, download.text
    assert download.headers["cache-control"] == "no-store"
    assert download.headers["x-content-type-options"] == "nosniff"
    assert "Test" not in download.headers["content-disposition"]

    archive_bytes = download.content
    assert hashlib.sha256(archive_bytes).hexdigest() == export_status["archive_sha256"]
    with zipfile.ZipFile(io.BytesIO(archive_bytes)) as archive:
        assert archive.testzip() is None
        names = set(archive.namelist())
        assert {
            "README-zh-CN.txt",
            "manifest.json",
            "data/health-records.json",
            f"originals/{source.id}/synthetic-checkup.pdf",
            f"originals/{related_source.id}/synthetic-checkup.pdf",
        }.issubset(names)
        manifest = json.loads(archive.read("manifest.json"))
        records = json.loads(archive.read("data/health-records.json"))

    assert manifest["schema_version"] == "household-health-archive/1.0"
    assert manifest["subject"]["patient_id"] == test_patient.id
    assert manifest["integrity"]["zip_crc_verified"] is True
    assert len(manifest["source_originals"]) == 2
    assert {entry["source_document_id"] for entry in manifest["source_originals"]} == {
        source.id,
        related_source.id,
    }
    assert all(
        entry["sha256"] == hashlib.sha256(SYNTHETIC_REPORT).hexdigest()
        for entry in manifest["source_originals"]
    )
    assert {entry["lifecycle_status"] for entry in manifest["source_originals"]} == {
        "archived",
        "uploaded",
    }
    assert {record["status"] for record in records["source_documents"]} == {
        "archived",
        "uploaded",
    }
    assert records["source_similarity_relations"] == [
        {
            "id": relation.id,
            "source_document_id": min(source.id, related_source.id),
            "related_source_document_id": max(source.id, related_source.id),
            "relation_type": "partial_overlap",
            "confidence": 0.88,
            "algorithm_version": "source-image-similarity@1.0.0",
            "evidence": relation.evidence,
            "review_status": "confirmed",
            "reviewed_by_user_id": test_user.id,
            "reviewed_at": relation.reviewed_at.isoformat(),
            "created_at": relation.created_at.isoformat(),
            "updated_at": relation.updated_at.isoformat(),
        }
    ]
    assert len(records["health_import_batches"]) == 1
    exported_batch = records["health_import_batches"][0]
    assert exported_batch["id"] == import_batch.id
    assert exported_batch["source_document_id"] == source.id
    assert exported_batch["status"] == "committed"
    assert exported_batch["subject_identity_status"] == "suspected_mismatch"
    assert exported_batch["subject_identity_observed_name"] == "Different Person"
    assert exported_batch["subject_identity_confidence"] == 0.93
    assert (
        exported_batch["subject_identity_assessment_version"]
        == "subject-identity-assessment@1.0.0"
    )
    assert (
        exported_batch["subject_identity_evidence"]
        == import_batch.subject_identity_evidence
    )
    assert exported_batch["subject_mismatch_confirmed_by_user_id"] == test_user.id
    assert (
        exported_batch["subject_mismatch_confirmed_at"]
        == confirmed_at.replace(tzinfo=None).isoformat()
    )
    assert exported_batch["items"] == []
    assert records["health_formal_metric_revisions"] == [
        {
            "id": initial_revision.id,
            "component_id": component.id,
            "patient_id": test_patient.id,
            "version": 1,
            "action": "created",
            "supersedes_revision_id": None,
            "reason": None,
            "idempotency_key": initial_revision.idempotency_key,
            "result_type": "quantitative",
            "numeric_value": 12.5,
            "qualitative_value": None,
            "textual_value": None,
            "unit": "unit/L",
            "ref_range_min": 10.0,
            "ref_range_max": 15.0,
            "ref_range_text": None,
            "result_status": "normal",
            "created_by_user_id": test_user.id,
            "created_at": confirmed_at.replace(tzinfo=None).isoformat(),
            "is_current": False,
        },
        {
            "id": revised_revision.id,
            "component_id": component.id,
            "patient_id": test_patient.id,
            "version": 2,
            "action": "revised",
            "supersedes_revision_id": initial_revision.id,
            "reason": revised_revision.reason,
            "idempotency_key": revised_revision.idempotency_key,
            "result_type": "quantitative",
            "numeric_value": 13.2,
            "qualitative_value": None,
            "textual_value": None,
            "unit": "unit/L",
            "ref_range_min": 10.0,
            "ref_range_max": 15.0,
            "ref_range_text": None,
            "result_status": "normal",
            "created_by_user_id": test_user.id,
            "created_at": revised_at.replace(tzinfo=None).isoformat(),
            "is_current": True,
        },
    ]
    rendered_manifest = json.dumps(manifest, ensure_ascii=False)
    rendered_records = json.dumps(records, ensure_ascii=False)
    assert str(tmp_path) not in rendered_manifest
    assert str(tmp_path) not in rendered_records
    for forbidden in (
        "password_hash",
        "access_token",
        "mfa_secret",
        "recovery_code",
        "activity_logs",
        "database_backup",
    ):
        assert forbidden not in rendered_manifest
        assert forbidden not in rendered_records

    audits = (
        db_session.query(ActivityLog)
        .filter(
            ActivityLog.entity_type == "health_archive_export",
            ActivityLog.entity_id == export_id,
        )
        .order_by(ActivityLog.id)
        .all()
    )
    assert [audit.action for audit in audits] == [
        "created",
        "exported",
        "downloaded",
    ]
    assert all(audit.patient_id == test_patient.id for audit in audits)
    assert str(tmp_path) not in json.dumps(
        [audit.event_metadata for audit in audits], ensure_ascii=False
    )


def test_complete_archive_fails_closed_when_a_retained_original_hash_changed(
    authenticated_client: TestClient,
    db_session: Session,
    test_user: User,
    test_patient: Patient,
    tmp_path: Path,
    monkeypatch,
):
    monkeypatch.setattr(settings, "BACKUP_DIR", tmp_path / "backups")
    monkeypatch.setattr(settings, "UPLOAD_DIR", tmp_path / "uploads")
    _create_source(
        db_session,
        patient=test_patient,
        actor=test_user,
        source_path=(
            settings.UPLOAD_DIR / "files" / "source-documents" / "tampered.pdf"
        ),
        expected_sha256="0" * 64,
    )

    created = _create_archive(
        authenticated_client,
        patient_id=test_patient.id,
        key="synthetic-complete-archive-tampered",
    )
    assert created.status_code == 202, created.text
    export_id = created.json()["id"]

    status_response = authenticated_client.get(f"/api/v1/export/archives/{export_id}")
    assert status_response.status_code == 200, status_response.text
    assert status_response.json()["status"] == "failed"
    assert status_response.json()["error_code"] == "source_sha256_mismatch"
    assert status_response.json()["can_download"] is False

    download = authenticated_client.get(f"/api/v1/export/archives/{export_id}/download")
    assert download.status_code == 409
    archive_dir = settings.BACKUP_DIR / "health-archive-exports"
    assert not list(archive_dir.glob("*.zip")) if archive_dir.exists() else True


def test_complete_archive_rejects_a_source_path_outside_private_storage(
    authenticated_client: TestClient,
    db_session: Session,
    test_user: User,
    test_patient: Patient,
    tmp_path: Path,
    monkeypatch,
):
    monkeypatch.setattr(settings, "BACKUP_DIR", tmp_path / "backups")
    monkeypatch.setattr(settings, "UPLOAD_DIR", tmp_path / "uploads")
    _create_source(
        db_session,
        patient=test_patient,
        actor=test_user,
        source_path=tmp_path / "outside-private-storage" / "synthetic.pdf",
    )

    created = _create_archive(
        authenticated_client,
        patient_id=test_patient.id,
        key="synthetic-complete-archive-path-escape",
    )
    assert created.status_code == 202, created.text
    export_id = created.json()["id"]

    status_response = authenticated_client.get(f"/api/v1/export/archives/{export_id}")
    assert status_response.status_code == 200, status_response.text
    assert status_response.json()["status"] == "failed"
    assert status_response.json()["error_code"] == "source_file_path_invalid"
    archive_dir = settings.BACKUP_DIR / "health-archive-exports"
    assert not list(archive_dir.glob("*.zip")) if archive_dir.exists() else True


def test_complete_archive_rejects_cross_subject_and_administrator_role_bypass(
    authenticated_client: TestClient,
    admin_client: TestClient,
    test_patient: Patient,
):
    member_attempt = _create_archive(
        authenticated_client,
        patient_id=test_patient.id + 9999,
        key="synthetic-complete-archive-foreign",
    )
    assert member_attempt.status_code == 404

    admin_attempt = _create_archive(
        admin_client,
        patient_id=test_patient.id,
        key="synthetic-complete-archive-admin-bypass",
    )
    assert admin_attempt.status_code == 404


def test_queued_archive_can_be_cancelled_without_creating_an_artifact(
    authenticated_client: TestClient,
    db_session: Session,
    test_patient: Patient,
    tmp_path: Path,
    monkeypatch,
):
    monkeypatch.setattr(settings, "BACKUP_DIR", tmp_path / "backups")
    monkeypatch.setattr(health_archive_export_worker, "notify", lambda: True)

    created = _create_archive(
        authenticated_client,
        patient_id=test_patient.id,
        key="synthetic-complete-archive-cancel",
    )
    assert created.status_code == 202, created.text
    assert created.json()["status"] == "queued"

    cancelled = authenticated_client.post(
        f"/api/v1/export/archives/{created.json()['id']}/cancel"
    )
    assert cancelled.status_code == 200, cancelled.text
    assert cancelled.json()["status"] == "cancelled"
    assert cancelled.json()["can_download"] is False
    assert not (settings.BACKUP_DIR / "health-archive-exports").exists()


def test_interrupted_and_expired_archive_tasks_recover_without_touching_health_data(
    db_session: Session,
    test_user: User,
    test_patient: Patient,
    tmp_path: Path,
    monkeypatch,
):
    from datetime import timedelta

    from app.models.base import get_utc_now

    monkeypatch.setattr(settings, "BACKUP_DIR", tmp_path / "backups")
    task = health_archive_export_service.create_task(
        db_session,
        actor=test_user,
        patient_id=test_patient.id,
        idempotency_key="synthetic-complete-archive-recover",
    )
    task.status = "running"
    task.started_at = get_utc_now()
    db_session.commit()
    part_path = (
        settings.BACKUP_DIR / "health-archive-exports" / f"{task.archive_filename}.part"
    )
    part_path.parent.mkdir(parents=True, exist_ok=True)
    part_path.write_bytes(b"partial")

    recovered = health_archive_export_service.recover_interrupted_tasks(db_session)
    db_session.refresh(task)
    assert recovered == 1
    assert task.status == "queued"
    assert not part_path.exists()

    archive_path = part_path.with_name(task.archive_filename)
    archive_path.write_bytes(b"synthetic ready archive")
    task.status = "ready"
    task.archive_path = str(archive_path)
    task.archive_size_bytes = archive_path.stat().st_size
    task.archive_sha256 = hashlib.sha256(archive_path.read_bytes()).hexdigest()
    task.expires_at = get_utc_now() - timedelta(seconds=1)
    db_session.commit()

    expired = health_archive_export_service.expire_ready_exports(db_session)
    db_session.refresh(task)
    assert expired == 1
    assert task.status == "expired"
    assert task.archive_path is None
    assert not archive_path.exists()
    assert (
        db_session.query(HealthSourceDocument)
        .filter(HealthSourceDocument.patient_id == test_patient.id)
        .count()
        == 0
    )


def test_download_rechecks_final_archive_integrity(
    authenticated_client: TestClient,
    db_session: Session,
    test_patient: Patient,
    tmp_path: Path,
    monkeypatch,
):
    monkeypatch.setattr(settings, "BACKUP_DIR", tmp_path / "backups")
    created = _create_archive(
        authenticated_client,
        patient_id=test_patient.id,
        key="synthetic-complete-archive-final-integrity",
    )
    assert created.status_code == 202, created.text
    export_id = created.json()["id"]
    task = (
        db_session.query(HealthArchiveExport)
        .filter(HealthArchiveExport.id == export_id)
        .one()
    )
    assert task.status == "ready"
    Path(task.archive_path).write_bytes(b"tampered after generation")

    download = authenticated_client.get(f"/api/v1/export/archives/{export_id}/download")
    assert download.status_code == 410, download.text
    db_session.refresh(task)
    assert task.status == "failed"
    assert task.error_code == "archive_integrity_mismatch"
    assert task.archive_path is None
