import json
import zipfile

import pytest

from app.models.files import BackupRecord
from app.services.backup_service import BackupService


@pytest.mark.asyncio
async def test_full_backup_verification_records_archive_integrity(db_session, tmp_path):
    backup_path = tmp_path / "full_backup_synthetic.zip"
    with zipfile.ZipFile(backup_path, "w", zipfile.ZIP_DEFLATED) as archive:
        archive.writestr("database.sql", "-- synthetic database backup\n")
        archive.writestr(
            "backup_records_schema.sql", "-- synthetic backup history schema\n"
        )
        archive.writestr(
            "backup_manifest.json",
            json.dumps({"backup_type": "full", "version": "1.0"}),
        )

    service = BackupService(db_session)
    record = BackupRecord(
        backup_type="full",
        status="created",
        file_path=str(backup_path),
        size_bytes=backup_path.stat().st_size,
        compression_used=True,
        checksum=service._calculate_file_checksum(backup_path),
    )
    db_session.add(record)
    db_session.commit()
    db_session.refresh(record)

    result = await service.verify_backup(record.id)

    db_session.refresh(record)
    assert result["verified"] is True
    assert result["archive_valid"] is True
    assert record.status == "verified"
    assert record.integrity_status == "verified"
    assert record.integrity_verified_at is not None


def test_restore_drill_record_keeps_only_operational_metadata(db_session, tmp_path):
    backup_path = tmp_path / "full_backup_restore_fixture.zip"
    backup_path.write_bytes(b"synthetic")
    record = BackupRecord(
        backup_type="full",
        status="verified",
        file_path=str(backup_path),
        size_bytes=backup_path.stat().st_size,
        compression_used=True,
        checksum="a" * 64,
    )
    db_session.add(record)
    db_session.commit()

    updated = BackupService(db_session).record_restore_drill(
        filename=backup_path.name,
        status="passed",
        summary={
            "archive_sha256": "b" * 64,
            "schema_version": "synthetic_revision",
            "table_count": 42,
            "upload_file_count": 0,
            "checks_run": ["isolated_sql_restore"],
            "isolation_method": "ephemeral_docker_no_network",
            "postgres_image": "postgres:15.18-alpine",
            "untrusted_private_value": "must not be stored",
        },
    )

    summary = json.loads(updated.restore_test_summary)
    assert updated.restore_test_status == "passed"
    assert updated.restore_tested_at is not None
    assert summary["schema_version"] == "synthetic_revision"
    assert "untrusted_private_value" not in summary


def test_verified_backup_can_be_copied_without_exposing_target_path(
    db_session, tmp_path, monkeypatch
):
    source_dir = tmp_path / "primary"
    replica_dir = tmp_path / "replica"
    source_dir.mkdir()
    backup_path = source_dir / "full_backup_synthetic.zip"
    backup_path.write_bytes(b"synthetic verified backup")
    service = BackupService(db_session)
    checksum = service._calculate_file_checksum(backup_path)
    record = BackupRecord(
        backup_type="full",
        status="verified",
        file_path=str(backup_path),
        size_bytes=backup_path.stat().st_size,
        checksum=checksum,
        integrity_status="verified",
    )
    db_session.add(record)
    db_session.commit()
    db_session.refresh(record)

    monkeypatch.setattr("app.core.config.settings.BACKUP_REPLICA_ENABLED", True)
    monkeypatch.setattr("app.core.config.settings.BACKUP_REPLICA_DIR", replica_dir)
    monkeypatch.setattr(
        "app.core.config.settings.BACKUP_REPLICA_LABEL", "synthetic-second-target"
    )

    result = service.replicate_backup(record.id)

    db_session.refresh(record)
    assert result["status"] == "copied"
    assert result["checksum_matches"] is True
    assert "path" not in result
    assert (replica_dir / backup_path.name).read_bytes() == backup_path.read_bytes()
    assert record.replica_status == "copied"
    assert record.replica_target_label == "synthetic-second-target"
    assert record.replica_checksum == checksum


def test_replica_target_cannot_equal_primary_path(db_session, tmp_path, monkeypatch):
    backup_path = tmp_path / "full_backup_synthetic.zip"
    backup_path.write_bytes(b"synthetic verified backup")
    service = BackupService(db_session)
    record = BackupRecord(
        backup_type="full",
        status="verified",
        file_path=str(backup_path),
        size_bytes=backup_path.stat().st_size,
        checksum=service._calculate_file_checksum(backup_path),
        integrity_status="verified",
    )
    db_session.add(record)
    db_session.commit()

    monkeypatch.setattr("app.core.config.settings.BACKUP_REPLICA_ENABLED", True)
    monkeypatch.setattr("app.core.config.settings.BACKUP_REPLICA_DIR", tmp_path)
    monkeypatch.setattr("app.core.config.settings.BACKUP_REPLICA_LABEL", "same-dir")

    result = service.replicate_backup(record.id)

    db_session.refresh(record)
    assert result["status"] == "failed"
    assert result["error_code"] == "target_matches_source"
    assert record.replica_status == "failed"


def test_disabled_replica_is_recorded_explicitly(db_session, tmp_path, monkeypatch):
    backup_path = tmp_path / "full_backup_synthetic.zip"
    backup_path.write_bytes(b"synthetic verified backup")
    service = BackupService(db_session)
    record = BackupRecord(
        backup_type="full",
        status="verified",
        file_path=str(backup_path),
        size_bytes=backup_path.stat().st_size,
        checksum=service._calculate_file_checksum(backup_path),
        integrity_status="verified",
    )
    db_session.add(record)
    db_session.commit()

    monkeypatch.setattr("app.core.config.settings.BACKUP_REPLICA_ENABLED", False)
    result = service.replicate_backup(record.id)

    db_session.refresh(record)
    assert result == {
        "backup_id": record.id,
        "status": "not_configured",
        "target_label": None,
    }
    assert record.replica_status == "not_configured"


@pytest.mark.asyncio
async def test_deleting_backup_removes_only_matching_configured_replica(
    db_session, tmp_path, monkeypatch
):
    primary_dir = tmp_path / "primary"
    replica_dir = tmp_path / "replica"
    primary_dir.mkdir()
    replica_dir.mkdir()
    backup_path = primary_dir / "full_backup_synthetic.zip"
    replica_path = replica_dir / backup_path.name
    backup_path.write_bytes(b"synthetic verified backup")
    replica_path.write_bytes(backup_path.read_bytes())
    record = BackupRecord(
        backup_type="full",
        status="verified",
        file_path=str(backup_path),
        size_bytes=backup_path.stat().st_size,
        checksum="a" * 64,
        integrity_status="verified",
        replica_status="copied",
        replica_target_label="synthetic-second-target",
    )
    db_session.add(record)
    db_session.commit()
    backup_id = record.id

    monkeypatch.setattr("app.core.config.settings.BACKUP_REPLICA_ENABLED", True)
    monkeypatch.setattr("app.core.config.settings.BACKUP_REPLICA_DIR", replica_dir)
    monkeypatch.setattr(
        "app.core.config.settings.BACKUP_REPLICA_LABEL", "synthetic-second-target"
    )

    result = await BackupService(db_session).delete_backup(backup_id)

    assert result["file_deleted"] is True
    assert result["replica_deleted"] is True
    assert not backup_path.exists()
    assert not replica_path.exists()
