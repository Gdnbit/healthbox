import hashlib
import io
import json
import os
from datetime import date, timedelta
from pathlib import Path

import pytest
from fastapi.testclient import TestClient
from reportlab.pdfgen import canvas
from sqlalchemy.orm import Session

from app.crud.patient import patient as patient_crud
from app.models.activity_log import ActivityLog
from app.models.base import get_utc_now
from app.models.files import EntityFile
from app.models.health_imports import (
    HealthImportBatch,
    HealthImportItem,
    HealthSourceDocument,
    HealthSourceParseTask,
)
from app.models.labs import LabResult, LabTestComponent
from app.models.sharing import PatientShare
from app.schemas.patient import PatientCreate
from app.services.health_csv_parser import parse_health_csv
from app.services.health_source_parse_service import (
    TextExtraction,
    parse_core_lab_candidates,
)
from tests.utils.user import create_random_user, create_user_token_headers

SYNTHETIC_PDF = b"%PDF-1.4\n% synthetic household health fixture\n%%EOF\n"
SECOND_SYNTHETIC_PDF = b"%PDF-1.4\n% second synthetic household health fixture\n%%EOF\n"
ENTRY_EVAL_ROOT = Path(__file__).resolve().parents[2] / "evals" / "entry-workspace"


def _load_entry_eval(relative_path: str) -> bytes:
    return (ENTRY_EVAL_ROOT / relative_path).read_bytes()


def _load_entry_golden(relative_path: str) -> dict:
    return json.loads((ENTRY_EVAL_ROOT / relative_path).read_text(encoding="utf-8"))


def _synthetic_core_lab_pdf(subject_name: str | None = None) -> bytes:
    output = io.BytesIO()
    document = canvas.Canvas(output)
    document.drawString(72, 780, "Synthetic local laboratory report")
    offset = 0
    if subject_name:
        document.drawString(72, 755, f"Patient Name: {subject_name}")
        offset = 25
    document.drawString(72, 755 - offset, "Report date 2026-01-15")
    document.drawString(72, 720 - offset, "Glucose 5.2 mmol/L 3.9-6.1 Normal")
    document.drawString(72, 695 - offset, "LDL cholesterol 3.8 mmol/L 0.0-3.4 High")
    document.save()
    return output.getvalue()


def test_local_core_parser_recognizes_synthetic_chinese_rows_without_formal_writes():
    result = parse_core_lab_candidates(
        TextExtraction(
            text=(
                "体检日期 2026-01-15\n"
                "空腹血糖 5.2 mmol/L 3.9-6.1 正常\n"
                "低密度脂蛋白 3.8 mmol/L 0-3.4 偏高\n"
            ),
            method="native",
            confidence=0.95,
            page_count=1,
        ),
        report_date=None,
    )

    assert [candidate.test_code for candidate in result.candidates] == [
        "GLU",
        "LDL-C",
    ]
    assert result.candidates[0].observed_date == date(2026, 1, 15)
    assert result.candidates[0].raw_text == "空腹血糖 5.2 mmol/L 3.9-6.1 正常"
    assert result.candidates[1].result_status == "high"
    assert result.unparsed_count == 0


def test_generic_health_csv_matches_golden_preview():
    preview = parse_health_csv(
        _load_entry_eval("cases/generic-lab-csv.csv")
    ).model_dump(mode="json")

    assert preview == _load_entry_golden("golden/generic-lab-csv-preview.json")


def test_generic_health_csv_matches_invalid_golden_without_echoing_values():
    preview = parse_health_csv(
        _load_entry_eval("cases/generic-lab-csv-invalid.csv")
    ).model_dump(mode="json")

    assert preview == _load_entry_golden("golden/generic-lab-csv-invalid-preview.json")
    rendered_errors = json.dumps(preview["errors"])
    assert "HYPERLINK" not in rendered_errors
    assert "example.invalid" not in rendered_errors


def test_generic_health_csv_supports_declared_chinese_aliases_and_date_formats():
    content = (
        "日期,检验项目,标准名称,项目代码,结果类型,结果,单位,参考下限,参考上限,结果状态,分类,来源页码,来源位置\n"
        "2026/01/15,虚构指标甲,虚构指标甲,SYN-ZH,定量,-1.5,单位每升,-2,2,正常,生化,1,表一第一行\n"
        "2026.01.16,虚构指标乙,虚构指标乙,SYN-ZH-2,定性,未检出,,,,正常,免疫,2,表一第二行\n"
    ).encode("gb18030")

    preview = parse_health_csv(content)

    assert preview.encoding == "gb18030"
    assert preview.valid_rows == 2
    assert preview.invalid_rows == 0
    assert preview.rows[0].candidate.observed_date.isoformat() == "2026-01-15"
    assert preview.rows[0].candidate.numeric_value == -1.5
    assert preview.rows[0].candidate.category == "chemistry"
    assert preview.rows[1].candidate.qualitative_value == "undetected"
    assert preview.rows[1].candidate.category == "immunology"


def _entry_table_counts(db_session: Session) -> tuple[int, int, int, int, int]:
    return (
        db_session.query(HealthSourceDocument).count(),
        db_session.query(HealthImportBatch).count(),
        db_session.query(HealthImportItem).count(),
        db_session.query(LabResult).count(),
        db_session.query(LabTestComponent).count(),
    )


def test_csv_preview_api_is_member_scoped_and_has_no_database_writes(
    client: TestClient,
    db_session: Session,
    user_with_patient,
    authenticated_headers,
):
    before = _entry_table_counts(db_session)

    response = client.post(
        f"/api/v1/health-imports/patients/{user_with_patient['patient'].id}/csv-preview",
        files={
            "file": (
                "synthetic-lab.csv",
                _load_entry_eval("cases/generic-lab-csv.csv"),
                "text/csv",
            )
        },
        headers=authenticated_headers,
    )

    assert response.status_code == 200, response.text
    assert response.json() == _load_entry_golden("golden/generic-lab-csv-preview.json")
    db_session.expire_all()
    assert _entry_table_counts(db_session) == before


def test_csv_preview_api_rejects_cross_member_access(
    client: TestClient,
    db_session: Session,
    user_with_patient,
):
    other_user = create_random_user(db_session)
    other_patient = patient_crud.create_for_user(
        db_session,
        user_id=other_user["user"].id,
        patient_data=PatientCreate(
            first_name="CSV",
            last_name="Other",
            birth_date=date(1994, 1, 1),
            gender="F",
            address="Example address",
        ),
    )
    other_user["user"].active_patient_id = other_patient.id
    db_session.commit()
    other_headers = create_user_token_headers(other_user["user"].username)

    response = client.post(
        f"/api/v1/health-imports/patients/{user_with_patient['patient'].id}/csv-preview",
        files={
            "file": (
                "synthetic.csv",
                b"test_name,result_type,value\nX,textual,Y\n",
                "text/csv",
            )
        },
        headers=other_headers,
    )

    assert response.status_code == 403


@pytest.mark.parametrize(
    ("filename", "content", "expected_status"),
    [
        pytest.param(
            "synthetic.txt",
            b"test_name,result_type,value\nX,textual,Y\n",
            415,
            id="extension",
        ),
        pytest.param("synthetic.csv", b"", 422, id="empty"),
        pytest.param(
            "synthetic.csv",
            b"x" * (2 * 1024 * 1024 + 1),
            413,
            id="oversize",
        ),
        pytest.param(
            "synthetic.csv",
            (
                "test_name,result_type,value\n"
                + "\n".join(
                    f"Synthetic {index},textual,Example" for index in range(501)
                )
            ).encode(),
            422,
            id="row-limit",
        ),
    ],
)
def test_csv_preview_api_enforces_file_and_row_limits(
    client: TestClient,
    user_with_patient,
    authenticated_headers,
    filename: str,
    content: bytes,
    expected_status: int,
):
    response = client.post(
        f"/api/v1/health-imports/patients/{user_with_patient['patient'].id}/csv-preview",
        files={"file": (filename, content, "text/csv")},
        headers=authenticated_headers,
    )

    assert response.status_code == expected_status


@pytest.fixture
def uploaded_source_document(
    client: TestClient,
    db_session: Session,
    user_with_patient,
    authenticated_headers,
):
    response = client.post(
        "/api/v1/health-imports/source-documents",
        data={
            "patient_id": str(user_with_patient["patient"].id),
            "display_name": "Synthetic annual report",
            "document_type": "checkup",
            "report_date": "2026-01-15",
            "facility": "Example clinic",
        },
        files={"file": ("synthetic-report.pdf", SYNTHETIC_PDF, "application/pdf")},
        headers=authenticated_headers,
    )
    assert response.status_code == 201, response.text
    source = response.json()
    yield source

    entity_file = (
        db_session.query(EntityFile)
        .filter(EntityFile.id == source["primary_file_id"])
        .first()
    )
    if entity_file and entity_file.file_path and os.path.exists(entity_file.file_path):
        os.remove(entity_file.file_path)


def _candidate_payload():
    return {
        "observed_date": "2026-01-15",
        "test_name": "Synthetic marker alpha",
        "canonical_test_name": "Synthetic Marker Alpha",
        "test_code": "SYN-A",
        "result_type": "quantitative",
        "numeric_value": 12.5,
        "unit": "unit/L",
        "ref_range_min": 10.0,
        "ref_range_max": 15.0,
        "result_status": "normal",
        "category": "chemistry",
        "source_page": 2,
        "source_locator": "table-1-row-2",
    }


def _source_upload_manifest_item(
    *,
    client_item_id: str,
    sequence: int,
    filename: str,
    content: bytes,
    mime_type: str = "application/pdf",
) -> dict:
    return {
        "client_item_id": client_item_id,
        "sequence": sequence,
        "original_filename": filename,
        "mime_type": mime_type,
        "size_bytes": len(content),
        "client_sha256": hashlib.sha256(content).hexdigest(),
    }


def _remove_source_file(db_session: Session, source_document_id: int) -> None:
    source = (
        db_session.query(HealthSourceDocument)
        .filter(HealthSourceDocument.id == source_document_id)
        .first()
    )
    if source is None or source.primary_file_id is None:
        return
    entity_file = (
        db_session.query(EntityFile)
        .filter(EntityFile.id == source.primary_file_id)
        .first()
    )
    if entity_file and entity_file.file_path and os.path.exists(entity_file.file_path):
        os.remove(entity_file.file_path)


def test_local_parse_task_is_idempotent_review_first_and_committable(
    client: TestClient,
    db_session: Session,
    user_with_patient,
    authenticated_headers,
):
    patient_id = user_with_patient["patient"].id
    upload = client.post(
        "/api/v1/health-imports/source-documents",
        data={
            "patient_id": str(patient_id),
            "display_name": "Synthetic core lab report",
            "document_type": "laboratory",
            "report_date": "2026-01-15",
            "facility": "Synthetic clinic",
        },
        files={
            "file": (
                "synthetic-core-lab.pdf",
                _synthetic_core_lab_pdf(),
                "application/pdf",
            )
        },
        headers=authenticated_headers,
    )
    assert upload.status_code == 201, upload.text
    source = upload.json()

    try:
        started = client.post(
            f"/api/v1/health-imports/source-documents/{source['id']}/parse-tasks",
            json={},
            headers=authenticated_headers,
        )
        assert started.status_code == 202, started.text
        task_id = started.json()["id"]

        completed = client.get(
            f"/api/v1/health-imports/parse-tasks/{task_id}",
            headers=authenticated_headers,
        )
        assert completed.status_code == 200, completed.text
        task = completed.json()
        assert task["status"] == "succeeded"
        assert task["summary"]["candidate_count"] == 2
        assert task["summary"]["formal_write_count"] == 0
        assert task["import_batch_id"] is not None
        assert db_session.query(LabTestComponent).count() == 0

        repeated = client.post(
            f"/api/v1/health-imports/source-documents/{source['id']}/parse-tasks",
            json={},
            headers=authenticated_headers,
        )
        assert repeated.status_code == 202, repeated.text
        assert repeated.json()["id"] == task_id
        assert db_session.query(HealthSourceParseTask).count() == 1

        batch_response = client.get(
            f"/api/v1/health-imports/batches/{task['import_batch_id']}",
            headers=authenticated_headers,
        )
        assert batch_response.status_code == 200, batch_response.text
        batch = batch_response.json()
        assert batch["status"] == "pending_review"
        assert all(item["decision"] == "pending" for item in batch["items"])
        assert batch["items"][0]["raw_text"]
        assert batch["items"][0]["confidence"] >= 0.85

        reviewed = client.put(
            f"/api/v1/health-imports/batches/{batch['id']}/review",
            json={
                "items": [
                    {"item_id": item["id"], "decision": "accepted"}
                    for item in batch["items"]
                ]
            },
            headers=authenticated_headers,
        )
        assert reviewed.status_code == 200, reviewed.text
        assert reviewed.json()["status"] == "reviewed"

        committed = client.post(
            f"/api/v1/health-imports/batches/{batch['id']}/commit",
            headers=authenticated_headers,
        )
        assert committed.status_code == 200, committed.text
        assert len(committed.json()["created_component_ids"]) == 2
    finally:
        _remove_source_file(db_session, source["id"])


def test_subject_mismatch_requires_one_exact_batch_confirmation_before_commit(
    client: TestClient,
    db_session: Session,
    user_with_patient,
    authenticated_headers,
):
    patient_id = user_with_patient["patient"].id
    upload = client.post(
        "/api/v1/health-imports/source-documents",
        data={
            "patient_id": str(patient_id),
            "display_name": "Synthetic mismatched-name report",
            "document_type": "laboratory",
            "report_date": "2026-01-15",
            "facility": "Synthetic clinic",
        },
        files={
            "file": (
                "synthetic-mismatched-name.pdf",
                _synthetic_core_lab_pdf("Clearly Different"),
                "application/pdf",
            )
        },
        headers=authenticated_headers,
    )
    assert upload.status_code == 201, upload.text
    source = upload.json()

    try:
        started = client.post(
            f"/api/v1/health-imports/source-documents/{source['id']}/parse-tasks",
            json={},
            headers=authenticated_headers,
        )
        assert started.status_code == 202, started.text
        task_response = client.get(
            f"/api/v1/health-imports/parse-tasks/{started.json()['id']}",
            headers=authenticated_headers,
        )
        assert task_response.status_code == 200, task_response.text
        task = task_response.json()
        assert task["status"] == "succeeded"
        assert task["import_batch_id"] is not None
        batch_response = client.get(
            f"/api/v1/health-imports/batches/{task['import_batch_id']}",
            headers=authenticated_headers,
        )
        assert batch_response.status_code == 200, batch_response.text
        batch = batch_response.json()
        warning = batch["subject_mismatch_warning"]
        assert warning["code"] == "subject_mismatch_suspected"
        assert warning["observed_name"] == "Clearly Different"
        assert warning["assessment_version"] == "subject-identity-assessment@1.0.0"
        assert warning["confirmation_required"] is True

        reviewed = client.put(
            f"/api/v1/health-imports/batches/{batch['id']}/review",
            json={
                "items": [
                    {"item_id": item["id"], "decision": "accepted"}
                    for item in batch["items"]
                ]
            },
            headers=authenticated_headers,
        )
        assert reviewed.status_code == 200, reviewed.text

        other_user = create_random_user(db_session)
        other_patient = patient_crud.create_for_user(
            db_session,
            user_id=other_user["user"].id,
            patient_data=PatientCreate(
                first_name="Other",
                last_name="Archive",
                birth_date=date(1990, 1, 1),
                gender="F",
                address="Synthetic address",
            ),
        )
        other_user["user"].active_patient_id = other_patient.id
        db_session.commit()
        other_headers = create_user_token_headers(other_user["user"].username)
        forbidden = client.post(
            f"/api/v1/health-imports/batches/{batch['id']}/commit",
            json={
                "subject_mismatch_confirmation": {
                    "acknowledged": True,
                    "target_patient_id": patient_id,
                    "observed_name": warning["observed_name"],
                    "assessment_version": warning["assessment_version"],
                }
            },
            headers=other_headers,
        )
        assert forbidden.status_code == 403, forbidden.text

        formal_before = (
            db_session.query(LabResult).count(),
            db_session.query(LabTestComponent).count(),
        )

        blocked = client.post(
            f"/api/v1/health-imports/batches/{batch['id']}/commit",
            headers=authenticated_headers,
        )
        assert blocked.status_code == 409, blocked.text
        assert (
            blocked.headers["X-Error-Code"] == "subject_mismatch_confirmation_required"
        )
        assert (
            db_session.query(LabResult).count(),
            db_session.query(LabTestComponent).count(),
        ) == formal_before

        invalid = client.post(
            f"/api/v1/health-imports/batches/{batch['id']}/commit",
            json={
                "subject_mismatch_confirmation": {
                    "acknowledged": True,
                    "target_patient_id": patient_id + 1,
                    "observed_name": warning["observed_name"],
                    "assessment_version": warning["assessment_version"],
                }
            },
            headers=authenticated_headers,
        )
        assert invalid.status_code == 409, invalid.text
        assert (
            invalid.headers["X-Error-Code"] == "subject_mismatch_confirmation_invalid"
        )
        assert (
            db_session.query(LabResult).count(),
            db_session.query(LabTestComponent).count(),
        ) == formal_before

        committed = client.post(
            f"/api/v1/health-imports/batches/{batch['id']}/commit",
            json={
                "subject_mismatch_confirmation": {
                    "acknowledged": True,
                    "target_patient_id": patient_id,
                    "observed_name": warning["observed_name"],
                    "assessment_version": warning["assessment_version"],
                }
            },
            headers=authenticated_headers,
        )
        assert committed.status_code == 200, committed.text
        committed_batch = committed.json()["batch"]
        assert committed_batch["status"] == "committed"
        assert (
            committed_batch["subject_mismatch_warning"]["confirmation_required"]
            is False
        )
        assert committed_batch["subject_mismatch_warning"]["confirmed_at"]

        repeated = client.post(
            f"/api/v1/health-imports/batches/{batch['id']}/commit",
            headers=authenticated_headers,
        )
        assert repeated.status_code == 200, repeated.text
        assert (
            repeated.json()["created_component_ids"]
            == committed.json()["created_component_ids"]
        )

        confirmation_audit = (
            db_session.query(ActivityLog)
            .filter(
                ActivityLog.entity_type == "health_import_batch",
                ActivityLog.entity_id == batch["id"],
                ActivityLog.action == "confirmed_subject_mismatch",
            )
            .one()
        )
        rendered_audit = json.dumps(
            confirmation_audit.event_metadata, ensure_ascii=False
        )
        assert "Clearly Different" not in rendered_audit
        assert user_with_patient["patient"].first_name not in rendered_audit
        assert user_with_patient["patient"].last_name not in rendered_audit
    finally:
        _remove_source_file(db_session, source["id"])


def test_local_parse_failure_preserves_original_and_creates_no_batch(
    client: TestClient,
    db_session: Session,
    uploaded_source_document,
    authenticated_headers,
):
    source = uploaded_source_document
    started = client.post(
        f"/api/v1/health-imports/source-documents/{source['id']}/parse-tasks",
        json={},
        headers=authenticated_headers,
    )
    assert started.status_code == 202, started.text

    completed = client.get(
        f"/api/v1/health-imports/parse-tasks/{started.json()['id']}",
        headers=authenticated_headers,
    )
    assert completed.status_code == 200, completed.text
    task = completed.json()
    assert task["status"] == "failed"
    assert task["error_code"] in {
        "ocr_unavailable",
        "text_extraction_failed",
        "parse_internal_error",
    }
    assert task["summary"]["formal_write_count"] == 0
    assert db_session.query(HealthImportBatch).count() == 0
    assert db_session.query(LabTestComponent).count() == 0

    entity_file = (
        db_session.query(EntityFile)
        .filter(EntityFile.id == source["primary_file_id"])
        .one()
    )
    assert Path(entity_file.file_path).is_file()


def test_local_parse_retry_rejects_active_work_and_recovers_stale_work(
    client: TestClient,
    db_session: Session,
    user_with_patient,
    uploaded_source_document,
    authenticated_headers,
):
    patient = user_with_patient["patient"]
    user = user_with_patient["user"]
    now = get_utc_now()
    active = HealthSourceParseTask(
        patient_id=patient.id,
        source_document_id=uploaded_source_document["id"],
        created_by_user_id=user.id,
        idempotency_key="active-local-parse-task",
        parser_name="local-core-lab",
        parser_version="1.0.0",
        status="running",
        attempt_count=1,
        summary={},
        started_at=now,
    )
    stale = HealthSourceParseTask(
        patient_id=patient.id,
        source_document_id=uploaded_source_document["id"],
        created_by_user_id=user.id,
        idempotency_key="stale-local-parse-task",
        parser_name="local-core-lab",
        parser_version="1.0.0",
        status="running",
        attempt_count=1,
        summary={},
        started_at=now - timedelta(minutes=31),
    )
    db_session.add_all([active, stale])
    db_session.commit()
    db_session.refresh(active)
    db_session.refresh(stale)

    active_retry = client.post(
        f"/api/v1/health-imports/parse-tasks/{active.id}/retry",
        headers=authenticated_headers,
    )
    assert active_retry.status_code == 409

    stale_retry = client.post(
        f"/api/v1/health-imports/parse-tasks/{stale.id}/retry",
        headers=authenticated_headers,
    )
    assert stale_retry.status_code == 202, stale_retry.text
    # The API background worker uses its own session while this test fixture
    # intentionally reuses one session across requests. Expire the fixture's
    # identity-map cache before reading the worker's committed state.
    db_session.expire_all()
    recovered = client.get(
        f"/api/v1/health-imports/parse-tasks/{stale.id}",
        headers=authenticated_headers,
    )
    assert recovered.status_code == 200
    assert recovered.json()["attempt_count"] == 2, (
        recovered.json()["status"],
        recovered.json()["error_code"],
        recovered.json()["started_at"],
    )
    assert recovered.json()["status"] == "failed"
    assert recovered.json()["summary"]["formal_write_count"] == 0


def test_parser_readiness_is_owner_scoped_and_path_specific(
    client: TestClient,
    user_with_patient,
    authenticated_headers,
    monkeypatch,
):
    monkeypatch.setattr(
        "app.api.v1.endpoints.health_imports.probe_local_parser_readiness",
        lambda: {
            "parser_name": "local-core-lab",
            "parser_version": "1.0.0",
            "status": "partial",
            "capabilities": {
                "digital_pdf": {"status": "ready", "reason_codes": []},
                "image_ocr": {
                    "status": "partial",
                    "reason_codes": ["chi_sim_language_missing"],
                },
                "scanned_pdf_ocr": {
                    "status": "unavailable",
                    "reason_codes": ["pdf2image_missing"],
                },
                "heic_image_ocr": {
                    "status": "unavailable",
                    "reason_codes": ["heic_decoder_missing"],
                },
            },
            "supported_ocr_languages": ["eng"],
            "reason_codes": [
                "chi_sim_language_missing",
                "pdf2image_missing",
                "heic_decoder_missing",
            ],
        },
    )

    response = client.get(
        (
            "/api/v1/health-imports/patients/"
            f"{user_with_patient['patient'].id}/parser-readiness"
        ),
        headers=authenticated_headers,
    )

    assert response.status_code == 200, response.text
    payload = response.json()
    assert payload["status"] == "partial"
    assert payload["capabilities"]["digital_pdf"]["status"] == "ready"
    assert payload["capabilities"]["scanned_pdf_ocr"]["status"] == "unavailable"
    assert payload["worker"]["status"] in {"running", "fallback"}
    assert payload["checked_at"]


def test_source_upload_batch_creation_is_idempotent_and_manifest_bound(
    client: TestClient,
    db_session: Session,
    user_with_patient,
    authenticated_headers,
):
    patient_id = user_with_patient["patient"].id
    payload = {
        "idempotency_key": "synthetic-upload-batch-0001",
        "document_type": "checkup",
        "report_date": "2026-01-15",
        "facility": "Example clinic",
        "documents": [
            _source_upload_manifest_item(
                client_item_id="item-a",
                sequence=1,
                filename="page-a.pdf",
                content=SYNTHETIC_PDF,
            ),
            _source_upload_manifest_item(
                client_item_id="item-b",
                sequence=2,
                filename="page-b.pdf",
                content=SECOND_SYNTHETIC_PDF,
            ),
        ],
    }

    first = client.post(
        f"/api/v1/health-imports/patients/{patient_id}/source-upload-batches",
        json=payload,
        headers=authenticated_headers,
    )
    assert first.status_code == 201, first.text
    first_data = first.json()
    assert first_data["status"] == "open"
    assert first_data["document_type"] == "checkup"
    assert first_data["report_date"] == "2026-01-15"
    assert first_data["facility"] == "Example clinic"
    assert first_data["expected_file_count"] == 2
    assert first_data["expected_total_bytes"] == len(SYNTHETIC_PDF) + len(
        SECOND_SYNTHETIC_PDF
    )
    assert [item["status"] for item in first_data["items"]] == [
        "pending",
        "pending",
    ]

    repeated = client.post(
        f"/api/v1/health-imports/patients/{patient_id}/source-upload-batches",
        json=payload,
        headers=authenticated_headers,
    )
    assert repeated.status_code == 201, repeated.text
    assert repeated.json()["id"] == first_data["id"]

    conflicting = {
        **payload,
        "documents": [
            {
                **payload["documents"][0],
                "original_filename": "changed-page.pdf",
            },
            payload["documents"][1],
        ],
    }
    conflict = client.post(
        f"/api/v1/health-imports/patients/{patient_id}/source-upload-batches",
        json=conflicting,
        headers=authenticated_headers,
    )
    assert conflict.status_code == 409
    assert conflict.headers["X-Error-Code"] == "upload_batch_manifest_conflict"
    assert (
        db_session.query(ActivityLog)
        .filter(
            ActivityLog.entity_type == "health_source_upload_batch",
            ActivityLog.entity_id == first_data["id"],
            ActivityLog.action == "created",
        )
        .count()
        == 1
    )


def test_source_upload_batch_rejects_invalid_manifests_and_pending_completion(
    client: TestClient,
    user_with_patient,
    authenticated_headers,
):
    patient_id = user_with_patient["patient"].id
    oversized_manifest = [
        {
            "client_item_id": f"oversized-{index}",
            "sequence": index,
            "original_filename": f"oversized-{index}.pdf",
            "mime_type": "application/pdf",
            "size_bytes": 50 * 1024 * 1024,
        }
        for index in range(1, 8)
    ]
    invalid_total = client.post(
        f"/api/v1/health-imports/patients/{patient_id}/source-upload-batches",
        json={
            "idempotency_key": "synthetic-invalid-total",
            "documents": oversized_manifest,
        },
        headers=authenticated_headers,
    )
    assert invalid_total.status_code == 422

    invalid_type = client.post(
        f"/api/v1/health-imports/patients/{patient_id}/source-upload-batches",
        json={
            "idempotency_key": "synthetic-invalid-type",
            "documents": [
                {
                    **_source_upload_manifest_item(
                        client_item_id="invalid-type",
                        sequence=1,
                        filename="notes.txt",
                        content=b"synthetic",
                    ),
                    "mime_type": "text/plain",
                }
            ],
        },
        headers=authenticated_headers,
    )
    assert invalid_type.status_code == 422

    valid = client.post(
        f"/api/v1/health-imports/patients/{patient_id}/source-upload-batches",
        json={
            "idempotency_key": "synthetic-pending-completion",
            "document_type": "checkup",
            "documents": [
                _source_upload_manifest_item(
                    client_item_id="pending-item",
                    sequence=1,
                    filename="pending.pdf",
                    content=SYNTHETIC_PDF,
                )
            ],
        },
        headers=authenticated_headers,
    )
    assert valid.status_code == 201, valid.text
    incomplete = client.post(
        f"/api/v1/health-imports/source-upload-batches/{valid.json()['id']}/complete",
        headers=authenticated_headers,
    )
    assert incomplete.status_code == 409
    assert incomplete.headers["X-Error-Code"] == "upload_batch_incomplete"


def test_source_upload_batch_prevents_metadata_drift_on_retry(
    client: TestClient,
    db_session: Session,
    user_with_patient,
    authenticated_headers,
):
    patient_id = user_with_patient["patient"].id
    created = client.post(
        f"/api/v1/health-imports/patients/{patient_id}/source-upload-batches",
        json={
            "idempotency_key": "synthetic-metadata-bound",
            "document_type": "checkup",
            "report_date": "2026-02-03",
            "facility": "Example clinic",
            "documents": [
                _source_upload_manifest_item(
                    client_item_id="metadata-item",
                    sequence=1,
                    filename="metadata-bound.pdf",
                    content=SECOND_SYNTHETIC_PDF,
                )
            ],
        },
        headers=authenticated_headers,
    )
    assert created.status_code == 201, created.text
    batch = created.json()
    item = batch["items"][0]

    mismatched = client.post(
        "/api/v1/health-imports/source-documents",
        data={
            "patient_id": str(patient_id),
            "document_type": "checkup",
            "source_upload_batch_id": str(batch["id"]),
            "source_upload_item_id": str(item["id"]),
        },
        files={
            "file": (
                "metadata-bound.pdf",
                SECOND_SYNTHETIC_PDF,
                "application/pdf",
            )
        },
        headers=authenticated_headers,
    )
    assert mismatched.status_code == 422
    assert mismatched.headers["X-Error-Code"] == "upload_manifest_mismatch"
    assert db_session.query(HealthSourceDocument).count() == 0

    source_id = None
    try:
        matched = client.post(
            "/api/v1/health-imports/source-documents",
            data={
                "patient_id": str(patient_id),
                "document_type": "checkup",
                "report_date": "2026-02-03",
                "facility": "Example clinic",
                "source_upload_batch_id": str(batch["id"]),
                "source_upload_item_id": str(item["id"]),
            },
            files={
                "file": (
                    "metadata-bound.pdf",
                    SECOND_SYNTHETIC_PDF,
                    "application/pdf",
                )
            },
            headers=authenticated_headers,
        )
        assert matched.status_code == 201, matched.text
        source_id = matched.json()["id"]
        assert matched.json()["report_date"] == "2026-02-03"
        assert matched.json()["facility"] == "Example clinic"
    finally:
        if source_id is not None:
            _remove_source_file(db_session, source_id)


def test_source_upload_batch_tracks_uploaded_and_duplicate_items(
    client: TestClient,
    db_session: Session,
    user_with_patient,
    authenticated_headers,
    uploaded_source_document,
):
    patient_id = user_with_patient["patient"].id
    created = client.post(
        f"/api/v1/health-imports/patients/{patient_id}/source-upload-batches",
        json={
            "idempotency_key": "synthetic-upload-batch-0002",
            "document_type": "checkup",
            "documents": [
                _source_upload_manifest_item(
                    client_item_id="new-item",
                    sequence=1,
                    filename="new-report.pdf",
                    content=SECOND_SYNTHETIC_PDF,
                ),
                _source_upload_manifest_item(
                    client_item_id="duplicate-item",
                    sequence=2,
                    filename="duplicate-report.pdf",
                    content=SYNTHETIC_PDF,
                ),
            ],
        },
        headers=authenticated_headers,
    )
    assert created.status_code == 201, created.text
    batch = created.json()
    new_item, duplicate_item = batch["items"]
    new_source_id = None

    try:
        uploaded = client.post(
            "/api/v1/health-imports/source-documents",
            data={
                "patient_id": str(patient_id),
                "document_type": "checkup",
                "source_upload_batch_id": str(batch["id"]),
                "source_upload_item_id": str(new_item["id"]),
            },
            files={
                "file": (
                    "new-report.pdf",
                    SECOND_SYNTHETIC_PDF,
                    "application/pdf",
                )
            },
            headers=authenticated_headers,
        )
        assert uploaded.status_code == 201, uploaded.text
        new_source_id = uploaded.json()["id"]

        repeated_upload = client.post(
            "/api/v1/health-imports/source-documents",
            data={
                "patient_id": str(patient_id),
                "document_type": "checkup",
                "source_upload_batch_id": str(batch["id"]),
                "source_upload_item_id": str(new_item["id"]),
            },
            files={
                "file": (
                    "new-report.pdf",
                    SECOND_SYNTHETIC_PDF,
                    "application/pdf",
                )
            },
            headers=authenticated_headers,
        )
        assert repeated_upload.status_code == 201, repeated_upload.text
        assert repeated_upload.json()["id"] == new_source_id

        duplicate = client.post(
            "/api/v1/health-imports/source-documents",
            data={
                "patient_id": str(patient_id),
                "document_type": "checkup",
                "source_upload_batch_id": str(batch["id"]),
                "source_upload_item_id": str(duplicate_item["id"]),
            },
            files={
                "file": (
                    "duplicate-report.pdf",
                    SYNTHETIC_PDF,
                    "application/pdf",
                )
            },
            headers=authenticated_headers,
        )
        assert duplicate.status_code == 409
        assert duplicate.headers["X-Error-Code"] == "duplicate_source_document"

        refreshed = client.get(
            f"/api/v1/health-imports/source-upload-batches/{batch['id']}",
            headers=authenticated_headers,
        )
        assert refreshed.status_code == 200, refreshed.text
        refreshed_items = refreshed.json()["items"]
        assert refreshed_items[0]["status"] == "uploaded"
        assert refreshed_items[0]["source_document_id"] == new_source_id
        assert refreshed_items[0]["attempt_count"] == 1
        assert refreshed_items[1]["status"] == "duplicate"
        assert (
            refreshed_items[1]["duplicate_source_document_id"]
            == uploaded_source_document["id"]
        )

        completed = client.post(
            f"/api/v1/health-imports/source-upload-batches/{batch['id']}/complete",
            headers=authenticated_headers,
        )
        assert completed.status_code == 200, completed.text
        assert completed.json()["status"] == "completed"
        unfinished = client.get(
            f"/api/v1/health-imports/patients/{patient_id}/source-upload-batches",
            params={"unfinished_only": "true", "limit": 20},
            headers=authenticated_headers,
        )
        assert unfinished.status_code == 200, unfinished.text
        assert unfinished.json() == []
        all_batches = client.get(
            f"/api/v1/health-imports/patients/{patient_id}/source-upload-batches",
            headers=authenticated_headers,
        )
        assert [candidate["id"] for candidate in all_batches.json()] == [batch["id"]]
        assert (
            db_session.query(ActivityLog)
            .filter(
                ActivityLog.entity_type == "health_source_upload_batch",
                ActivityLog.entity_id == batch["id"],
                ActivityLog.action == "completed",
            )
            .count()
            == 1
        )
    finally:
        if new_source_id is not None:
            _remove_source_file(db_session, new_source_id)


def test_source_upload_batch_records_failure_and_allows_retry(
    client: TestClient,
    db_session: Session,
    user_with_patient,
    authenticated_headers,
):
    patient_id = user_with_patient["patient"].id
    created = client.post(
        f"/api/v1/health-imports/patients/{patient_id}/source-upload-batches",
        json={
            "idempotency_key": "synthetic-upload-batch-0003",
            "document_type": "checkup",
            "documents": [
                _source_upload_manifest_item(
                    client_item_id="retry-item",
                    sequence=1,
                    filename="retry-report.pdf",
                    content=SECOND_SYNTHETIC_PDF,
                )
            ],
        },
        headers=authenticated_headers,
    )
    assert created.status_code == 201, created.text
    batch = created.json()
    item = batch["items"][0]

    failed = client.post(
        "/api/v1/health-imports/source-documents",
        data={
            "patient_id": str(patient_id),
            "document_type": "checkup",
            "source_upload_batch_id": str(batch["id"]),
            "source_upload_item_id": str(item["id"]),
        },
        files={
            "file": (
                "retry-report.pdf",
                b"not-a-pdf",
                "application/pdf",
            )
        },
        headers=authenticated_headers,
    )
    assert failed.status_code == 422

    after_failure = client.get(
        f"/api/v1/health-imports/source-upload-batches/{batch['id']}",
        headers=authenticated_headers,
    ).json()
    assert after_failure["items"][0]["status"] == "failed"
    assert after_failure["items"][0]["attempt_count"] == 1
    assert after_failure["items"][0]["last_error_code"] == "signature_mismatch"

    mismatched_manifest = client.post(
        "/api/v1/health-imports/source-documents",
        data={
            "patient_id": str(patient_id),
            "document_type": "checkup",
            "source_upload_batch_id": str(batch["id"]),
            "source_upload_item_id": str(item["id"]),
        },
        files={
            "file": (
                "different-name.pdf",
                SECOND_SYNTHETIC_PDF,
                "application/pdf",
            )
        },
        headers=authenticated_headers,
    )
    assert mismatched_manifest.status_code == 422
    assert mismatched_manifest.headers["X-Error-Code"] == "upload_manifest_mismatch"
    after_mismatch = client.get(
        f"/api/v1/health-imports/source-upload-batches/{batch['id']}",
        headers=authenticated_headers,
    ).json()
    assert after_mismatch["items"][0]["status"] == "failed"
    assert after_mismatch["items"][0]["attempt_count"] == 2
    assert after_mismatch["items"][0]["last_error_code"] == "upload_manifest_mismatch"

    source_id = None
    try:
        retried = client.post(
            "/api/v1/health-imports/source-documents",
            data={
                "patient_id": str(patient_id),
                "document_type": "checkup",
                "source_upload_batch_id": str(batch["id"]),
                "source_upload_item_id": str(item["id"]),
            },
            files={
                "file": (
                    "retry-report.pdf",
                    SECOND_SYNTHETIC_PDF,
                    "application/pdf",
                )
            },
            headers=authenticated_headers,
        )
        assert retried.status_code == 201, retried.text
        source_id = retried.json()["id"]

        completed = client.post(
            f"/api/v1/health-imports/source-upload-batches/{batch['id']}/complete",
            headers=authenticated_headers,
        )
        assert completed.status_code == 200
        assert completed.json()["status"] == "completed"
        assert completed.json()["items"][0]["attempt_count"] == 3
        assert completed.json()["items"][0]["last_error_code"] is None
    finally:
        if source_id is not None:
            _remove_source_file(db_session, source_id)


def test_source_upload_batch_cancel_preserves_saved_originals_and_closes_pending(
    client: TestClient,
    db_session: Session,
    user_with_patient,
    authenticated_headers,
):
    patient_id = user_with_patient["patient"].id
    third_pdf = b"%PDF-1.4\n% third synthetic household health fixture\n%%EOF\n"
    created = client.post(
        f"/api/v1/health-imports/patients/{patient_id}/source-upload-batches",
        json={
            "idempotency_key": "synthetic-upload-batch-0004",
            "document_type": "checkup",
            "documents": [
                _source_upload_manifest_item(
                    client_item_id="saved-item",
                    sequence=1,
                    filename="saved-report.pdf",
                    content=SECOND_SYNTHETIC_PDF,
                ),
                _source_upload_manifest_item(
                    client_item_id="cancelled-item",
                    sequence=2,
                    filename="cancelled-report.pdf",
                    content=third_pdf,
                ),
            ],
        },
        headers=authenticated_headers,
    )
    assert created.status_code == 201, created.text
    batch = created.json()
    saved_item, cancelled_item = batch["items"]
    source_id = None

    try:
        uploaded = client.post(
            "/api/v1/health-imports/source-documents",
            data={
                "patient_id": str(patient_id),
                "document_type": "checkup",
                "source_upload_batch_id": str(batch["id"]),
                "source_upload_item_id": str(saved_item["id"]),
            },
            files={
                "file": (
                    "saved-report.pdf",
                    SECOND_SYNTHETIC_PDF,
                    "application/pdf",
                )
            },
            headers=authenticated_headers,
        )
        assert uploaded.status_code == 201, uploaded.text
        source_id = uploaded.json()["id"]

        cancelled = client.post(
            f"/api/v1/health-imports/source-upload-batches/{batch['id']}/cancel",
            headers=authenticated_headers,
        )
        assert cancelled.status_code == 200, cancelled.text
        cancelled_data = cancelled.json()
        assert cancelled_data["status"] == "cancelled"
        assert cancelled_data["items"][0]["status"] == "uploaded"
        assert cancelled_data["items"][0]["source_document_id"] == source_id
        assert cancelled_data["items"][1]["status"] == "cancelled"
        assert (
            db_session.query(ActivityLog)
            .filter(
                ActivityLog.entity_type == "health_source_upload_batch",
                ActivityLog.entity_id == batch["id"],
                ActivityLog.action == "cancelled",
            )
            .count()
            == 1
        )

        blocked = client.post(
            "/api/v1/health-imports/source-documents",
            data={
                "patient_id": str(patient_id),
                "document_type": "checkup",
                "source_upload_batch_id": str(batch["id"]),
                "source_upload_item_id": str(cancelled_item["id"]),
            },
            files={
                "file": (
                    "cancelled-report.pdf",
                    third_pdf,
                    "application/pdf",
                )
            },
            headers=authenticated_headers,
        )
        assert blocked.status_code == 409
        assert blocked.headers["X-Error-Code"] == "upload_batch_closed"
    finally:
        if source_id is not None:
            _remove_source_file(db_session, source_id)


def test_source_upload_records_hash_and_warns_on_duplicate(
    client: TestClient,
    db_session: Session,
    user_with_patient,
    authenticated_headers,
    uploaded_source_document,
):
    source = uploaded_source_document
    assert len(source["sha256"]) == 64
    assert source["size_bytes"] == len(SYNTHETIC_PDF)
    assert source["storage_backend"] == "local"
    assert source["primary_file_id"] is not None

    duplicate_response = client.post(
        "/api/v1/health-imports/source-documents",
        data={
            "patient_id": str(user_with_patient["patient"].id),
            "document_type": "checkup",
        },
        files={"file": ("copy.pdf", SYNTHETIC_PDF, "application/pdf")},
        headers=authenticated_headers,
    )
    assert duplicate_response.status_code == 409
    assert duplicate_response.headers["X-Error-Code"] == "duplicate_source_document"
    assert duplicate_response.headers["X-Duplicate-Source-Document-ID"] == str(
        source["id"]
    )


@pytest.mark.parametrize(
    ("filename", "mime_type", "content"),
    [
        pytest.param(
            "synthetic.webp",
            "image/webp",
            b"RIFF\x10\x00\x00\x00WEBPVP8 synthetic",
            id="webp",
        ),
        pytest.param(
            "synthetic.heic",
            "image/heic",
            b"\x00\x00\x00\x18ftypheic\x00\x00\x00\x00mif1heic",
            id="heic",
        ),
        pytest.param(
            "synthetic.heif",
            "image/heif",
            b"\x00\x00\x00\x18ftypmif1\x00\x00\x00\x00heifmif1",
            id="heif",
        ),
    ],
)
def test_source_upload_accepts_supported_phone_image_formats(
    client: TestClient,
    db_session: Session,
    user_with_patient,
    authenticated_headers,
    filename: str,
    mime_type: str,
    content: bytes,
):
    response = client.post(
        "/api/v1/health-imports/source-documents",
        data={
            "patient_id": str(user_with_patient["patient"].id),
            "document_type": "checkup",
        },
        files={"file": (filename, content, mime_type)},
        headers=authenticated_headers,
    )

    assert response.status_code == 201, response.text
    source = response.json()
    entity_file = (
        db_session.query(EntityFile)
        .filter(EntityFile.id == source["primary_file_id"])
        .one()
    )
    if entity_file.file_path and os.path.exists(entity_file.file_path):
        os.remove(entity_file.file_path)


def test_source_upload_limits_match_the_confirmed_household_contract():
    from app.api.v1.endpoints.health_imports import (
        MAX_SOURCE_IMAGE_FILE_SIZE,
        MAX_SOURCE_PDF_FILE_SIZE,
    )

    assert MAX_SOURCE_IMAGE_FILE_SIZE == 20 * 1024 * 1024
    assert MAX_SOURCE_PDF_FILE_SIZE == 50 * 1024 * 1024


def test_shared_editor_cannot_read_report_sources_or_write_health_imports(
    client: TestClient,
    db_session: Session,
    user_with_patient,
    authenticated_headers,
    uploaded_source_document,
):
    editor = create_random_user(db_session)["user"]
    share = PatientShare(
        patient_id=user_with_patient["patient"].id,
        shared_by_user_id=user_with_patient["user"].id,
        shared_with_user_id=editor.id,
        permission_level="edit",
        is_active=True,
    )
    db_session.add(share)
    db_session.commit()
    editor_headers = create_user_token_headers(editor.username)
    patient_id = user_with_patient["patient"].id

    owner_source_list = client.get(
        f"/api/v1/health-imports/patients/{patient_id}/source-documents",
        headers=authenticated_headers,
    )
    assert owner_source_list.status_code == 200

    owner_file_details = client.get(
        (
            "/api/v1/entity-files/files/"
            f"{uploaded_source_document['primary_file_id']}"
        ),
        headers=authenticated_headers,
    )
    assert owner_file_details.status_code == 200

    source_list = client.get(
        f"/api/v1/health-imports/patients/{patient_id}/source-documents",
        headers=editor_headers,
    )
    assert source_list.status_code == 403

    dependency_summary = client.get(
        (
            "/api/v1/health-imports/source-documents/"
            f"{uploaded_source_document['id']}/dependencies"
        ),
        headers=editor_headers,
    )
    assert dependency_summary.status_code == 403

    withdrawal = client.post(
        (
            "/api/v1/health-imports/source-documents/"
            f"{uploaded_source_document['id']}/withdraw"
        ),
        json={"reason": "Shared editors must not manage originals"},
        headers=editor_headers,
    )
    assert withdrawal.status_code == 403

    restoration = client.post(
        (
            "/api/v1/health-imports/source-documents/"
            f"{uploaded_source_document['id']}/restore"
        ),
        headers=editor_headers,
    )
    assert restoration.status_code == 403

    source_files = client.get(
        (
            "/api/v1/entity-files/source-document/"
            f"{uploaded_source_document['id']}/files"
        ),
        headers=editor_headers,
    )
    assert source_files.status_code == 200
    assert source_files.json() == []

    file_details = client.get(
        (
            "/api/v1/entity-files/files/"
            f"{uploaded_source_document['primary_file_id']}"
        ),
        headers=editor_headers,
    )
    assert file_details.status_code == 403

    file_download = client.get(
        (
            "/api/v1/entity-files/files/"
            f"{uploaded_source_document['primary_file_id']}/download"
        ),
        headers=editor_headers,
    )
    assert file_download.status_code == 403

    file_view = client.get(
        (
            "/api/v1/entity-files/files/"
            f"{uploaded_source_document['primary_file_id']}/view"
        ),
        headers=editor_headers,
    )
    assert file_view.status_code == 403

    upload = client.post(
        "/api/v1/health-imports/source-documents",
        data={"patient_id": str(patient_id), "document_type": "checkup"},
        files={
            "file": (
                "shared-editor.pdf",
                b"%PDF-1.4\n% shared editor must not store this\n%%EOF\n",
                "application/pdf",
            )
        },
        headers=editor_headers,
    )
    assert upload.status_code == 403

    csv_preview = client.post(
        f"/api/v1/health-imports/patients/{patient_id}/csv-preview",
        files={
            "file": (
                "shared-editor.csv",
                b"test_name,result_type,value\nSynthetic,textual,Example\n",
                "text/csv",
            )
        },
        headers=editor_headers,
    )
    assert csv_preview.status_code == 403

    list_import_batches = client.get(
        f"/api/v1/health-imports/patients/{patient_id}/batches",
        headers=editor_headers,
    )
    assert list_import_batches.status_code == 403

    list_parse_tasks = client.get(
        f"/api/v1/health-imports/patients/{patient_id}/parse-tasks",
        headers=editor_headers,
    )
    assert list_parse_tasks.status_code == 403

    parser_readiness = client.get(
        f"/api/v1/health-imports/patients/{patient_id}/parser-readiness",
        headers=editor_headers,
    )
    assert parser_readiness.status_code == 403

    start_parse_task = client.post(
        (
            "/api/v1/health-imports/source-documents/"
            f"{uploaded_source_document['id']}/parse-tasks"
        ),
        json={},
        headers=editor_headers,
    )
    assert start_parse_task.status_code == 403

    create_batch = client.post(
        f"/api/v1/health-imports/patients/{patient_id}/batches",
        json={
            "source_document_id": uploaded_source_document["id"],
            "parser_name": "shared-editor-fixture",
            "candidates": [_candidate_payload()],
        },
        headers=editor_headers,
    )
    assert create_batch.status_code == 403

    source_upload_batch = client.post(
        f"/api/v1/health-imports/patients/{patient_id}/source-upload-batches",
        json={
            "idempotency_key": "shared-editor-upload-batch",
            "document_type": "checkup",
            "documents": [
                _source_upload_manifest_item(
                    client_item_id="shared-editor-item",
                    sequence=1,
                    filename="shared-editor.pdf",
                    content=SYNTHETIC_PDF,
                )
            ],
        },
        headers=editor_headers,
    )
    assert source_upload_batch.status_code == 403

    list_source_upload_batches = client.get(
        f"/api/v1/health-imports/patients/{patient_id}/source-upload-batches",
        headers=editor_headers,
    )
    assert list_source_upload_batches.status_code == 403


def test_batch_preview_is_idempotent_and_marks_same_batch_duplicates(
    client: TestClient,
    user_with_patient,
    authenticated_headers,
    uploaded_source_document,
):
    candidate = _candidate_payload()
    payload = {
        "source_document_id": uploaded_source_document["id"],
        "parser_name": "synthetic-fixture",
        "parser_version": "1",
        "candidates": [candidate, candidate],
    }
    first = client.post(
        f"/api/v1/health-imports/patients/{user_with_patient['patient'].id}/batches",
        json=payload,
        headers=authenticated_headers,
    )
    assert first.status_code == 201, first.text
    first_data = first.json()
    assert first_data["summary"] == {
        "total": 2,
        "pending": 1,
        "accepted": 0,
        "rejected": 0,
        "duplicate": 1,
        "quality_issue_count": 0,
    }
    assert first_data["items"][1]["decision"] == "duplicate"
    assert first_data["items"][1]["duplicate_reason"] == "same_batch_sequence:1"

    repeated = client.post(
        f"/api/v1/health-imports/patients/{user_with_patient['patient'].id}/batches",
        json=payload,
        headers=authenticated_headers,
    )
    assert repeated.status_code == 201
    assert repeated.json()["id"] == first_data["id"]


def test_source_workspace_metadata_and_review_are_exportable(
    client: TestClient,
    user_with_patient,
    authenticated_headers,
    uploaded_source_document,
):
    patient_id = user_with_patient["patient"].id
    preview = client.post(
        f"/api/v1/health-imports/patients/{patient_id}/batches",
        json={
            "source_document_id": uploaded_source_document["id"],
            "parser_name": "export-portability-fixture",
            "candidates": [_candidate_payload()],
        },
        headers=authenticated_headers,
    )
    assert preview.status_code == 201, preview.text

    exported = client.get(
        "/api/v1/export/data",
        params={"format": "json", "scope": "source_documents"},
        headers=authenticated_headers,
    )
    assert exported.status_code == 200, exported.text
    payload = exported.json()
    assert (
        payload["source_documents"][0]["sha256"] == uploaded_source_document["sha256"]
    )
    assert payload["health_import_batches"][0]["items"][0]["source_page"] == 2
    assert payload["health_import_batches"][0]["items"][0]["numeric_value"] == 12.5
    assert "file_path" not in exported.text


def test_source_document_withdrawal_is_recoverable_and_preserves_dependencies(
    client: TestClient,
    db_session: Session,
    user_with_patient,
    authenticated_headers,
    uploaded_source_document,
):
    patient_id = user_with_patient["patient"].id
    preview = client.post(
        f"/api/v1/health-imports/patients/{patient_id}/batches",
        json={
            "source_document_id": uploaded_source_document["id"],
            "parser_name": "source-lifecycle-fixture",
            "candidates": [_candidate_payload()],
        },
        headers=authenticated_headers,
    )
    assert preview.status_code == 201, preview.text
    batch = preview.json()
    reviewed = client.put(
        f"/api/v1/health-imports/batches/{batch['id']}/review",
        json={"items": [{"item_id": batch["items"][0]["id"], "decision": "accepted"}]},
        headers=authenticated_headers,
    )
    assert reviewed.status_code == 200, reviewed.text
    committed = client.post(
        f"/api/v1/health-imports/batches/{batch['id']}/commit",
        headers=authenticated_headers,
    )
    assert committed.status_code == 200, committed.text
    source_model = (
        db_session.query(HealthSourceDocument)
        .filter(HealthSourceDocument.id == uploaded_source_document["id"])
        .one()
    )
    source_model.status = "verified"
    db_session.commit()

    dependencies = client.get(
        (
            "/api/v1/health-imports/source-documents/"
            f"{uploaded_source_document['id']}/dependencies"
        ),
        headers=authenticated_headers,
    )
    assert dependencies.status_code == 200, dependencies.text
    assert dependencies.json() == {
        "source_document_id": uploaded_source_document["id"],
        "import_batches_total": 1,
        "import_batches_open": 0,
        "import_batches_committed": 1,
        "formal_lab_components": 1,
        "health_background_entries": 0,
        "health_coverage_statements": 0,
        "duplicate_documents": 0,
        "has_derived_data": True,
    }

    withdrawn = client.post(
        (
            "/api/v1/health-imports/source-documents/"
            f"{uploaded_source_document['id']}/withdraw"
        ),
        json={"reason": "Synthetic upload assigned in error"},
        headers=authenticated_headers,
    )
    assert withdrawn.status_code == 200, withdrawn.text
    withdrawn_document = withdrawn.json()["document"]
    assert withdrawn_document["status"] == "archived"
    assert withdrawn_document["withdrawn_at"] is not None
    assert withdrawn_document["withdrawn_by_user_id"] == user_with_patient["user"].id
    assert withdrawn_document["withdrawal_reason"] == (
        "Synthetic upload assigned in error"
    )
    assert withdrawn_document["withdrawal_previous_status"] == "verified"

    active_list = client.get(
        f"/api/v1/health-imports/patients/{patient_id}/source-documents",
        headers=authenticated_headers,
    )
    assert active_list.status_code == 200
    assert active_list.json() == []
    lifecycle_list = client.get(
        f"/api/v1/health-imports/patients/{patient_id}/source-documents",
        params={"include_archived": True},
        headers=authenticated_headers,
    )
    assert lifecycle_list.status_code == 200
    assert lifecycle_list.json()[0]["status"] == "archived"

    source_file = client.get(
        (
            "/api/v1/entity-files/files/"
            f"{uploaded_source_document['primary_file_id']}"
        ),
        headers=authenticated_headers,
    )
    assert source_file.status_code == 200
    protected_delete = client.delete(
        (
            "/api/v1/entity-files/files/"
            f"{uploaded_source_document['primary_file_id']}"
        ),
        headers=authenticated_headers,
    )
    assert protected_delete.status_code == 409
    assert protected_delete.headers["X-Error-Code"] == "retained_source_document"
    assert (
        db_session.query(LabTestComponent)
        .filter(LabTestComponent.source_document_id == uploaded_source_document["id"])
        .count()
        == 1
    )

    blocked_batch = client.post(
        f"/api/v1/health-imports/patients/{patient_id}/batches",
        json={
            "source_document_id": uploaded_source_document["id"],
            "parser_name": "withdrawn-source-fixture",
            "idempotency_key": "withdrawn-source-fixture",
            "candidates": [{**_candidate_payload(), "numeric_value": 13.0}],
        },
        headers=authenticated_headers,
    )
    assert blocked_batch.status_code == 409

    repeated_upload = client.post(
        "/api/v1/health-imports/source-documents",
        data={
            "patient_id": str(patient_id),
            "display_name": "Repeated withdrawn original",
            "document_type": "checkup",
        },
        files={"file": ("synthetic-report.pdf", SYNTHETIC_PDF, "application/pdf")},
        headers=authenticated_headers,
    )
    assert repeated_upload.status_code == 409
    assert repeated_upload.headers["X-Error-Code"] == "withdrawn_source_document"

    restored = client.post(
        (
            "/api/v1/health-imports/source-documents/"
            f"{uploaded_source_document['id']}/restore"
        ),
        headers=authenticated_headers,
    )
    assert restored.status_code == 200, restored.text
    restored_document = restored.json()["document"]
    assert restored_document["status"] == "verified"
    assert restored_document["withdrawn_at"] is None
    assert restored_document["withdrawn_by_user_id"] is None
    assert restored_document["withdrawal_reason"] is None
    assert restored_document["withdrawal_previous_status"] is None

    actions = [
        row.action
        for row in (
            db_session.query(ActivityLog)
            .filter(
                ActivityLog.entity_type == "health_source_document",
                ActivityLog.entity_id == uploaded_source_document["id"],
            )
            .order_by(ActivityLog.id.asc())
            .all()
        )
    ]
    assert "withdrawn" in actions
    assert "restored" in actions


def test_review_commit_and_rollback_are_transactional(
    client: TestClient,
    db_session: Session,
    user_with_patient,
    authenticated_headers,
    uploaded_source_document,
):
    patient_id = user_with_patient["patient"].id
    preview = client.post(
        f"/api/v1/health-imports/patients/{patient_id}/batches",
        json={
            "source_document_id": uploaded_source_document["id"],
            "parser_name": "manual-review",
            "candidates": [_candidate_payload()],
        },
        headers=authenticated_headers,
    )
    assert preview.status_code == 201, preview.text
    batch = preview.json()

    blocked_commit = client.post(
        f"/api/v1/health-imports/batches/{batch['id']}/commit",
        headers=authenticated_headers,
    )
    assert blocked_commit.status_code == 409

    reviewed = client.put(
        f"/api/v1/health-imports/batches/{batch['id']}/review",
        json={"items": [{"item_id": batch["items"][0]["id"], "decision": "accepted"}]},
        headers=authenticated_headers,
    )
    assert reviewed.status_code == 200, reviewed.text
    assert reviewed.json()["status"] == "reviewed"

    committed = client.post(
        f"/api/v1/health-imports/batches/{batch['id']}/commit",
        headers=authenticated_headers,
    )
    assert committed.status_code == 200, committed.text
    committed_data = committed.json()
    assert committed_data["batch"]["status"] == "committed"
    assert len(committed_data["created_lab_result_ids"]) == 1
    assert len(committed_data["created_component_ids"]) == 1

    imported_lab_result = (
        db_session.query(LabResult)
        .filter(LabResult.id == committed_data["created_lab_result_ids"][0])
        .one()
    )
    assert imported_lab_result.test_category == "other"
    assert imported_lab_result.test_type == "screening"
    readable_results = client.get(
        "/api/v1/lab-results/",
        headers=authenticated_headers,
    )
    assert readable_results.status_code == 200, readable_results.text

    component = (
        db_session.query(LabTestComponent)
        .filter(LabTestComponent.id == committed_data["created_component_ids"][0])
        .one()
    )
    assert component.source_document_id == uploaded_source_document["id"]
    assert component.source_page == 2
    assert component.import_batch_id == batch["id"]

    rolled_back = client.post(
        f"/api/v1/health-imports/batches/{batch['id']}/rollback",
        headers=authenticated_headers,
    )
    assert rolled_back.status_code == 200, rolled_back.text
    rollback_data = rolled_back.json()
    assert rollback_data["batch"]["status"] == "rolled_back"
    assert (
        rollback_data["deleted_component_ids"]
        == committed_data["created_component_ids"]
    )
    assert (
        rollback_data["deleted_lab_result_ids"]
        == committed_data["created_lab_result_ids"]
    )
    assert (
        db_session.query(LabTestComponent)
        .filter(LabTestComponent.id == committed_data["created_component_ids"][0])
        .first()
        is None
    )
    assert (
        db_session.query(LabResult)
        .filter(LabResult.id == committed_data["created_lab_result_ids"][0])
        .first()
        is None
    )


def test_rollback_stops_after_imported_metadata_is_changed(
    client: TestClient,
    db_session: Session,
    user_with_patient,
    authenticated_headers,
    uploaded_source_document,
):
    patient_id = user_with_patient["patient"].id
    preview = client.post(
        f"/api/v1/health-imports/patients/{patient_id}/batches",
        json={
            "source_document_id": uploaded_source_document["id"],
            "parser_name": "rollback-safety-fixture",
            "candidates": [_candidate_payload()],
        },
        headers=authenticated_headers,
    )
    assert preview.status_code == 201, preview.text
    batch = preview.json()
    reviewed = client.put(
        f"/api/v1/health-imports/batches/{batch['id']}/review",
        json={"items": [{"item_id": batch["items"][0]["id"], "decision": "accepted"}]},
        headers=authenticated_headers,
    )
    assert reviewed.status_code == 200, reviewed.text
    committed = client.post(
        f"/api/v1/health-imports/batches/{batch['id']}/commit",
        headers=authenticated_headers,
    )
    assert committed.status_code == 200, committed.text

    component_id = committed.json()["created_component_ids"][0]
    component = (
        db_session.query(LabTestComponent)
        .filter(LabTestComponent.id == component_id)
        .one()
    )
    component.category = "hematology"
    db_session.commit()

    blocked = client.post(
        f"/api/v1/health-imports/batches/{batch['id']}/rollback",
        headers=authenticated_headers,
    )
    assert blocked.status_code == 409
    assert db_session.query(LabTestComponent).filter_by(id=component_id).one()


def _commit_single_formal_component(
    client: TestClient,
    *,
    patient_id: int,
    source_document_id: int,
    headers: dict[str, str],
) -> tuple[dict, int]:
    preview = client.post(
        f"/api/v1/health-imports/patients/{patient_id}/batches",
        json={
            "source_document_id": source_document_id,
            "parser_name": "formal-revision-fixture",
            "candidates": [_candidate_payload()],
        },
        headers=headers,
    )
    assert preview.status_code == 201, preview.text
    batch = preview.json()
    reviewed = client.put(
        f"/api/v1/health-imports/batches/{batch['id']}/review",
        json={
            "items": [
                {
                    "item_id": batch["items"][0]["id"],
                    "decision": "accepted",
                }
            ]
        },
        headers=headers,
    )
    assert reviewed.status_code == 200, reviewed.text
    committed = client.post(
        f"/api/v1/health-imports/batches/{batch['id']}/commit",
        headers=headers,
    )
    assert committed.status_code == 200, committed.text
    return committed.json()["batch"], committed.json()["created_component_ids"][0]


def test_formal_import_commit_creates_initial_immutable_revision_and_blocks_legacy_mutation(
    client: TestClient,
    db_session: Session,
    user_with_patient,
    authenticated_headers,
    uploaded_source_document,
):
    patient_id = user_with_patient["patient"].id
    _, component_id = _commit_single_formal_component(
        client,
        patient_id=patient_id,
        source_document_id=uploaded_source_document["id"],
        headers=authenticated_headers,
    )

    history = client.get(
        f"/api/v1/health-imports/components/{component_id}/revisions",
        headers=authenticated_headers,
    )
    assert history.status_code == 200, history.text
    body = history.json()
    assert body["component_id"] == component_id
    assert body["patient_id"] == patient_id
    assert body["current_revision_id"] == body["revisions"][0]["id"]
    assert body["revisions"] == [
        {
            **body["revisions"][0],
            "version": 1,
            "action": "created",
            "reason": None,
            "supersedes_revision_id": None,
            "result_type": "quantitative",
            "numeric_value": 12.5,
            "unit": "unit/L",
            "ref_range_min": 10.0,
            "ref_range_max": 15.0,
            "result_status": "normal",
        }
    ]

    legacy_update = client.put(
        f"/api/v1/lab-test-components/components/{component_id}",
        json={"value": 99.0},
        headers=authenticated_headers,
    )
    assert legacy_update.status_code == 409
    assert legacy_update.headers["X-Error-Code"] == "formal_metric_revision_required"

    legacy_delete = client.delete(
        f"/api/v1/lab-test-components/components/{component_id}",
        headers=authenticated_headers,
    )
    assert legacy_delete.status_code == 409
    assert legacy_delete.headers["X-Error-Code"] == "formal_metric_void_required"
    assert (
        db_session.query(LabTestComponent).filter_by(id=component_id).one().value
        == 12.5
    )


def test_formal_metric_revision_is_append_only_idempotent_and_blocks_stale_or_rollback(
    client: TestClient,
    db_session: Session,
    user_with_patient,
    authenticated_headers,
    uploaded_source_document,
):
    patient_id = user_with_patient["patient"].id
    batch, component_id = _commit_single_formal_component(
        client,
        patient_id=patient_id,
        source_document_id=uploaded_source_document["id"],
        headers=authenticated_headers,
    )
    first = client.get(
        f"/api/v1/health-imports/components/{component_id}/revisions",
        headers=authenticated_headers,
    ).json()["revisions"][0]
    payload = {
        "expected_current_revision_id": first["id"],
        "idempotency_key": "synthetic-revision-request-0001",
        "reason": "修正自动识别时的小数点错误",
        "result": {
            "result_type": "quantitative",
            "numeric_value": 13.2,
            "qualitative_value": None,
            "textual_value": None,
            "unit": "unit/L",
            "ref_range_min": 10.0,
            "ref_range_max": 15.0,
            "ref_range_text": None,
            "result_status": "normal",
        },
    }

    revised = client.post(
        f"/api/v1/health-imports/components/{component_id}/revisions",
        json=payload,
        headers=authenticated_headers,
    )
    assert revised.status_code == 200, revised.text
    body = revised.json()
    assert [item["version"] for item in body["revisions"]] == [2, 1]
    assert body["revisions"][0]["supersedes_revision_id"] == first["id"]
    assert body["revisions"][0]["reason"] == payload["reason"]
    assert body["revisions"][0]["numeric_value"] == 13.2
    assert body["revisions"][1]["numeric_value"] == 12.5
    assert body["current_revision_id"] == body["revisions"][0]["id"]
    second_revision_id = body["current_revision_id"]

    db_session.expire_all()
    projection = db_session.query(LabTestComponent).filter_by(id=component_id).one()
    assert projection.value == 13.2

    replay = client.post(
        f"/api/v1/health-imports/components/{component_id}/revisions",
        json=payload,
        headers=authenticated_headers,
    )
    assert replay.status_code == 200, replay.text
    assert replay.json()["current_revision_id"] == second_revision_id
    assert len(replay.json()["revisions"]) == 2

    stale = client.post(
        f"/api/v1/health-imports/components/{component_id}/revisions",
        json={
            **payload,
            "idempotency_key": "synthetic-revision-request-0002",
            "result": {**payload["result"], "numeric_value": 14.1},
        },
        headers=authenticated_headers,
    )
    assert stale.status_code == 409
    assert stale.headers["X-Error-Code"] == "formal_metric_revision_conflict"

    conflicting_replay = client.post(
        f"/api/v1/health-imports/components/{component_id}/revisions",
        json={
            **payload,
            "result": {**payload["result"], "numeric_value": 14.1},
        },
        headers=authenticated_headers,
    )
    assert conflicting_replay.status_code == 409
    assert (
        conflicting_replay.headers["X-Error-Code"]
        == "formal_metric_revision_idempotency_conflict"
    )

    rollback = client.post(
        f"/api/v1/health-imports/batches/{batch['id']}/rollback",
        headers=authenticated_headers,
    )
    assert rollback.status_code == 409
    assert rollback.headers["X-Error-Code"] == "formal_metric_revision_exists"

    activity = (
        db_session.query(ActivityLog)
        .filter(
            ActivityLog.entity_type == "health_formal_metric",
            ActivityLog.entity_id == component_id,
            ActivityLog.action == "revised",
        )
        .one()
    )
    serialized_metadata = json.dumps(activity.event_metadata, ensure_ascii=False)
    assert activity.event_metadata["revision_id"] == second_revision_id
    assert activity.event_metadata["version"] == 2
    assert activity.event_metadata["changed_fields"] == ["numeric_value"]
    assert "12.5" not in serialized_metadata
    assert "13.2" not in serialized_metadata
    assert payload["reason"] not in serialized_metadata


def test_formal_metric_revision_is_owner_only(
    client: TestClient,
    db_session: Session,
    user_with_patient,
    authenticated_headers,
    uploaded_source_document,
):
    patient_id = user_with_patient["patient"].id
    _, component_id = _commit_single_formal_component(
        client,
        patient_id=patient_id,
        source_document_id=uploaded_source_document["id"],
        headers=authenticated_headers,
    )
    first = client.get(
        f"/api/v1/health-imports/components/{component_id}/revisions",
        headers=authenticated_headers,
    ).json()["revisions"][0]

    other = create_random_user(db_session)
    other_patient = patient_crud.create_for_user(
        db_session,
        user_id=other["user"].id,
        patient_data=PatientCreate(
            first_name="Revision",
            last_name="Other",
            birth_date=date(1990, 1, 1),
            gender="F",
            address="Example address",
        ),
    )
    other["user"].active_patient_id = other_patient.id
    db_session.commit()
    other_headers = create_user_token_headers(other["user"].username)

    listed = client.get(
        f"/api/v1/health-imports/components/{component_id}/revisions",
        headers=other_headers,
    )
    assert listed.status_code == 403
    revised = client.post(
        f"/api/v1/health-imports/components/{component_id}/revisions",
        json={
            "expected_current_revision_id": first["id"],
            "idempotency_key": "synthetic-cross-user-revision",
            "reason": "不应允许跨主体修改",
            "result": {
                "result_type": "quantitative",
                "numeric_value": 11.0,
                "unit": "unit/L",
                "ref_range_min": 10.0,
                "ref_range_max": 15.0,
                "result_status": "normal",
            },
        },
        headers=other_headers,
    )
    assert revised.status_code == 403
    assert (
        db_session.query(LabTestComponent).filter_by(id=component_id).one().value
        == 12.5
    )


def test_patient_access_is_enforced_for_source_documents(
    client: TestClient,
    db_session: Session,
    user_with_patient,
    uploaded_source_document,
):
    other_user = create_random_user(db_session)
    other_patient = patient_crud.create_for_user(
        db_session,
        user_id=other_user["user"].id,
        patient_data=PatientCreate(
            first_name="Other",
            last_name="Household",
            birth_date=date(1995, 1, 1),
            gender="F",
            address="Example address",
        ),
    )
    other_user["user"].active_patient_id = other_patient.id
    db_session.commit()
    other_headers = create_user_token_headers(other_user["user"].username)

    response = client.get(
        f"/api/v1/health-imports/patients/{user_with_patient['patient'].id}/source-documents",
        headers=other_headers,
    )
    assert response.status_code == 403
