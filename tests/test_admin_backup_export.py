# Modified for the HealthBox distribution; differs from MediKeep v0.68.0. See NOTICE and MODIFICATIONS.md.
"""
Tests for Admin Backup History Export endpoint.

Tests cover:
- GET /api/v1/admin/backups/export (CSV export)
- CSV has correct column headers
- Empty backup list returns header-only CSV
- Non-admin returns 403
"""

import csv
import io
from unittest.mock import AsyncMock, patch

import pytest


@pytest.fixture
def mock_backups():
    """Sample backup data matching BackupService.list_backups() format."""
    return [
        {
            "id": 1,
            "backup_type": "database",
            "status": "created",
            "filename": "backup_20260226_120000.zip",
            "size_bytes": 1024000,
            "created_at": "2026-02-26T12:00:00",
            "description": "Daily database backup",
            "file_exists": True,
            "integrity_status": "verified",
            "integrity_verified_at": "2026-02-26T12:01:00",
            "restore_test_status": "passed",
            "restore_tested_at": "2026-02-26T12:05:00",
            "replica_status": "copied",
            "replicated_at": "2026-02-26T12:02:00",
            "replica_target_label": "synthetic-target",
            "replica_error_code": None,
        },
        {
            "id": 2,
            "backup_type": "full",
            "status": "created",
            "filename": "backup_20260225_080000.zip",
            "size_bytes": 5120000,
            "created_at": "2026-02-25T08:00:00",
            "description": None,
            "file_exists": False,
        },
    ]


@pytest.fixture
def _patch_backup_service(mock_backups):
    """Patch BackupService.list_backups to return mock_backups for all tests that need it."""
    with patch("app.api.v1.admin.backup.BackupService") as MockService:
        instance = MockService.return_value
        instance.list_backups = AsyncMock(return_value=mock_backups)
        yield instance


def _parse_csv(response_text):
    """Parse CSV response text into a (headers, data_rows) tuple."""
    reader = csv.reader(io.StringIO(response_text))
    headers = next(reader)
    rows = list(reader)
    return headers, rows


class TestBackupExport:
    """Tests for GET /api/v1/admin/backups/export"""

    BASE_URL = "/api/v1/admin/backups/export"

    @pytest.mark.usefixtures("_patch_backup_service")
    def test_returns_csv(self, admin_client):
        response = admin_client.get(self.BASE_URL)
        assert response.status_code == 200
        assert "text/csv" in response.headers["content-type"]
        assert "attachment" in response.headers.get("content-disposition", "")
        assert "backup_history_export.csv" in response.headers["content-disposition"]

    @pytest.mark.usefixtures("_patch_backup_service")
    def test_csv_has_correct_headers(self, admin_client):
        response = admin_client.get(self.BASE_URL)
        headers, _ = _parse_csv(response.text)
        assert headers == [
            "ID",
            "Backup Type",
            "Status",
            "Filename",
            "Size (bytes)",
            "Created At",
            "Description",
            "File Exists",
            "Integrity Status",
            "Integrity Verified At",
            "Restore Drill Status",
            "Restore Drill At",
            "Replica Status",
            "Replicated At",
            "Replica Target Label",
            "Replica Error Code",
        ]

    @pytest.mark.usefixtures("_patch_backup_service")
    def test_csv_exports_copy_state_without_filesystem_paths(self, admin_client):
        response = admin_client.get(self.BASE_URL)
        headers, rows = _parse_csv(response.text)
        label_index = headers.index("Replica Target Label")
        assert rows[0][label_index] == "synthetic-target"
        assert all("Path" not in header for header in headers)

    @pytest.mark.usefixtures("_patch_backup_service")
    def test_csv_has_data_rows(self, admin_client):
        response = admin_client.get(self.BASE_URL)
        _, rows = _parse_csv(response.text)
        assert len(rows) == 2

    @pytest.mark.usefixtures("_patch_backup_service")
    def test_file_exists_formatting(self, admin_client):
        response = admin_client.get(self.BASE_URL)
        _, rows = _parse_csv(response.text)
        # First backup: file_exists=True -> "Yes"
        assert rows[0][7] == "Yes"
        # Second backup: file_exists=False -> "No"
        assert rows[1][7] == "No"

    @pytest.mark.usefixtures("_patch_backup_service")
    def test_none_description_is_empty_string(self, admin_client):
        response = admin_client.get(self.BASE_URL)
        _, rows = _parse_csv(response.text)
        # Second backup has description=None -> ""
        assert rows[1][6] == ""

    def test_empty_backup_list_returns_header_only(self, admin_client):
        with patch("app.api.v1.admin.backup.BackupService") as MockService:
            instance = MockService.return_value
            instance.list_backups = AsyncMock(return_value=[])

            response = admin_client.get(self.BASE_URL)
            assert response.status_code == 200
            headers, rows = _parse_csv(response.text)
            assert len(headers) > 0
            assert len(rows) == 0

    def test_non_admin_returns_403(self, authenticated_client):
        response = authenticated_client.get(self.BASE_URL)
        assert response.status_code == 403

    def test_unauthenticated_returns_401(self, client):
        response = client.get(self.BASE_URL)
        assert response.status_code == 401
